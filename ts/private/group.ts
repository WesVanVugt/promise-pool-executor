import { PromisePoolGroup, PromisePoolGroupOptions } from "../public/group";
import { PromisePoolExecutor } from "../public/pool";
import { OptionalDeferredPromise } from "./optional-defer";
import { isNull } from "./utils";

/** Internal use only */
export class PromisePoolGroupPrivate implements PromisePoolGroup {
	public _pool: PromisePoolExecutor;
	public _concurrencyLimit!: number;
	public _frequencyLimit!: number;
	public _frequencyWindow!: number;
	public _frequencyStarts: number[] = [];
	public _activeTaskCount = 0;
	public _activePromiseCount = 0;
	private _deferred?: OptionalDeferredPromise<void>;
	/**
	 * This flag prevents a rejection from being removed before setImmediate is called.
	 * This way, you can be certain that when calling waitForIdle after adding a task, the error will get handled.
	 */
	private _recentRejection = false;
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
	 * Rejects all pending waitForIdle promises using the provided error.
	 */
	public _reject(promise: Promise<never>): void {
		if (!this._deferred) {
			if (this._activeTaskCount <= 0) {
				return;
			}
			this._deferred = new OptionalDeferredPromise<void>();
		}
		this._deferred.resolve(promise);

		if (this._recentRejection) {
			return;
		}
		this._recentRejection = true;
		// The group error state should reset after expired timers are handled
		setImmediate(() => {
			this._recentRejection = false;
			if (this._activeTaskCount <= 0) {
				this._deferred = undefined;
			}
		});
	}

	/**
	 * Returns a promise which resolves when the group becomes idle.
	 */
	public waitForIdle(): Promise<void> {
		if (!this._deferred) {
			if (this._activeTaskCount <= 0) {
				return Promise.resolve();
			}
			this._deferred = new OptionalDeferredPromise();
		}
		return this._deferred.promise();
	}

	public _incrementTasks(): void {
		this._activeTaskCount++;
	}

	/**
	 * Decrements the active tasks, resolving promises if applicable.
	 */
	public _decrementTasks(): void {
		this._activeTaskCount--;
		if (this._activeTaskCount <= 0 && this._deferred && !this._recentRejection) {
			this._deferred.resolve(undefined);
			this._deferred = undefined;
		}
	}
}
