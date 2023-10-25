import defer, { DeferredPromise } from "p-defer";
import { PromisePoolGroup, PromisePoolGroupOptions } from "../public/group";
import { PromisePoolExecutor } from "../public/pool";
import { handleRejection, isNull } from "./utils";

/** Internal use only */
export class PromisePoolGroupPrivate implements PromisePoolGroup {
	public _pool: PromisePoolExecutor;
	public _concurrencyLimit!: number;
	public _frequencyLimit!: number;
	public _frequencyWindow!: number;
	public _frequencyStarts: number[] = [];
	public _activeTaskCount = 0;
	public _activePromiseCount = 0;
	private readonly _deferreds: Array<DeferredPromise<void>> = [];
	/**
	 * This flag prevents a rejection from being removed before nextTick is called.
	 * This way, you can be certain that when calling waitForIdle after adding a task, the error will get handled.
	 */
	private _recentRejection = false;
	/**
	 * The error that the pool was rejected with.
	 * Clears when activePromiseCount reaches 0 and recentRejection is false.
	 */
	private _rejection?: Promise<never>;
	/**
	 * This flag indicates whether the rejection was handled by this group. This is used to flag subsequent rejections
	 * within the group as handled.
	 */
	private _locallyHandled = false;
	/**
	 * Contains any additional rejections so they can be flagged as handled before the nextTick fires if applicable
	 */
	private readonly _secondaryRejections: Array<Promise<never>> = [];
	private readonly _triggerNextCallback: () => void;

	constructor(pool: PromisePoolExecutor, triggerNextCallback: () => void, options?: PromisePoolGroupOptions) {
		this._pool = pool;
		if (!options) {
			options = {};
		}
		// Throw errors if applicable
		this.concurrencyLimit = isNull(options.concurrencyLimit) ? Infinity : options.concurrencyLimit;
		this.frequencyLimit = isNull(options.frequencyLimit) ? Infinity : options.frequencyLimit;
		this.frequencyWindow = isNull(options.frequencyWindow) ? 1000 : options.frequencyWindow;

		// Set the callback afterwards so it does not get triggered during creation
		this._triggerNextCallback = triggerNextCallback;
	}

	public get activeTaskCount(): number {
		return this._activeTaskCount;
	}

	public get activePromiseCount(): number {
		return this._activePromiseCount;
	}

	public get concurrencyLimit(): number {
		return this._concurrencyLimit;
	}

	public set concurrencyLimit(v: number) {
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error(`Invalid concurrencyLimit: ${v}`);
		}
		this._concurrencyLimit = v;
		this._triggerNextCallback?.();
	}

	public get frequencyLimit(): number {
		return this._frequencyLimit;
	}

	public set frequencyLimit(v: number) {
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error(`Invalid frequencyLimit: ${v}`);
		}
		this._frequencyLimit = v;
		this._triggerNextCallback?.();
	}

	public get frequencyWindow(): number {
		return this._frequencyWindow;
	}

	public set frequencyWindow(v: number) {
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error(`Invalid frequencyWindow: ${v}`);
		}
		this._frequencyWindow = v;
		this._triggerNextCallback?.();
	}

	public get freeSlots(): number {
		if (this._frequencyLimit !== Infinity) {
			this._cleanFrequencyStarts(Date.now());
		}
		return this._getFreeSlots();
	}

	public _getFreeSlots() {
		return Math.min(
			this._concurrencyLimit - this._activePromiseCount,
			this._frequencyLimit - this._frequencyStarts.length,
		);
	}

	/**
	 * Cleans out old entries from the frequencyStarts array. Uses a passed timestamp to ensure consistency between
	 * groups.
	 */
	public _cleanFrequencyStarts(now: number): void {
		// Remove the frequencyStarts entries which are outside of the window
		if (this._frequencyStarts.length > 0) {
			const time = now - this._frequencyWindow;
			let i = 0;
			while (i < this._frequencyStarts.length && this._frequencyStarts[i] <= time) {
				i++;
			}
			if (i > 0) {
				this._frequencyStarts.splice(0, i);
			}
		}
	}

	/**
	 * Returns 0 if the group is available, Infinity if the group is busy for an indeterminate time, or the timestamp
	 * of when the group will become available.
	 */
	public _busyTime(): number {
		if (this._activePromiseCount >= this._concurrencyLimit) {
			return Infinity;
		} else if (this._frequencyLimit && this._frequencyStarts.length >= this._frequencyLimit) {
			return this._frequencyStarts[0] + this._frequencyWindow;
		}
		return 0;
	}

	/**
	 * Resolves all pending waitForIdle promises.
	 */
	public _resolve() {
		if (!this._rejection && this._deferreds.length) {
			for (const deferred of this._deferreds) {
				deferred.resolve();
			}
			this._deferreds.length = 0;
		}
	}

	/**
	 * Rejects all pending waitForIdle promises using the provided error.
	 */
	public _reject(promise: Promise<never>): void {
		if (this._rejection) {
			if (this._locallyHandled) {
				handleRejection(promise);
			}
			this._secondaryRejections.push(promise);
			return;
		}

		this._rejection = promise;
		if (this._deferreds.length) {
			this._locallyHandled = true;
			for (const deferred of this._deferreds) {
				deferred.resolve(promise);
			}
			this._deferreds.length = 0;
		}

		this._recentRejection = true;
		// The group error state should reset on the next tick
		process.nextTick(() => {
			this._recentRejection = false;
			if (this._activeTaskCount < 1) {
				this._rejection = undefined;
				this._locallyHandled = false;
				if (this._secondaryRejections.length) {
					this._secondaryRejections.length = 0;
				}
			}
		});
	}

	/**
	 * Returns a promise which resolves when the group becomes idle.
	 */
	public waitForIdle(): Promise<void> {
		if (this._rejection) {
			this._locallyHandled = true;
			if (this._secondaryRejections.length) {
				for (const rejection of this._secondaryRejections) {
					handleRejection(rejection);
				}
				this._secondaryRejections.length = 0;
			}
			return this._rejection;
		}
		if (this._activeTaskCount <= 0) {
			return Promise.resolve();
		}

		const deferred = defer<void>();
		this._deferreds.push(deferred);
		return deferred.promise;
	}

	public _incrementTasks(): void {
		this._activeTaskCount++;
	}

	/**
	 * Decrements the active tasks, resolving promises if applicable.
	 */
	public _decrementTasks(): void {
		this._activeTaskCount--;
		if (this._activeTaskCount > 0) {
			return;
		}
		if (this._rejection && !this._recentRejection) {
			this._rejection = undefined;
			this._locallyHandled = false;
		} else {
			this._resolve();
		}
	}
}
