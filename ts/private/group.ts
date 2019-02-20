import defer, { DeferredPromise } from "p-defer";
import { PromisePoolGroup, PromisePoolGroupOptions } from "../public/group";
import { PromisePoolExecutor } from "../public/pool";
import { handleErr, isNull } from "./utils";

/** Internal use only */
export class PromisePoolGroupPrivate implements PromisePoolGroup {
    public _pool: PromisePoolExecutor;
    public _concurrencyLimit!: number;
    public _frequencyLimit!: number;
    public _frequencyWindow!: number;
    public _frequencyStarts: number[] = [];
    public _activeTaskCount: number = 0;
    public _activePromiseCount: number = 0;
    private _deferred?: DeferredPromise<void>;
    private _promise?: Promise<void>;
    /**
     * This flag prevents a rejection from being removed before nextTick is called.
     * This way, you can be certain that when calling waitForIdle after adding a task, the error will get handled.
     */
    private _recentRejection: boolean = false;
    /**
     * This flag indicates whether the rejection was handled by this group. This is used to flag subsequent rejections
     * within the group as handled.
     */
    private _locallyHandled: boolean = false;
    /**
     * Contains any additional rejections so they can be flagged as handled before the nextTick fires if applicable
     */
    private _secondaryRejections: Array<Promise<never>> = [];
    private _triggerNextCallback: () => void;

    constructor(pool: PromisePoolExecutor, triggerNextCallback: () => void, options?: PromisePoolGroupOptions) {
        this._pool = pool;
        if (!options) {
            options = {};
        }
        // Throw errors if applicable
        this.concurrencyLimit = options.concurrencyLimit as number;
        this.frequencyLimit = options.frequencyLimit as number;
        this.frequencyWindow = options.frequencyWindow as number;

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

    public set concurrencyLimit(val: number) {
        if (isNull(val)) {
            this._concurrencyLimit = Infinity;
        } else if (val && typeof val === "number" && val > 0) {
            this._concurrencyLimit = val;
        } else {
            throw new Error("Invalid concurrency limit: " + val);
        }
        if (this._triggerNextCallback) {
            this._triggerNextCallback();
        }
    }

    public get frequencyLimit(): number {
        return this._frequencyLimit;
    }

    public set frequencyLimit(val: number) {
        if (isNull(val)) {
            this._frequencyLimit = Infinity;
        } else if (val && typeof val === "number" && val > 0) {
            this._frequencyLimit = val;
        } else {
            throw new Error("Invalid frequency limit: " + val);
        }
        if (this._triggerNextCallback) {
            this._triggerNextCallback();
        }
    }

    public get frequencyWindow(): number {
        return this._frequencyWindow;
    }

    public set frequencyWindow(val: number) {
        if (isNull(val)) {
            this._frequencyWindow = 1000;
        } else if (val && typeof val === "number" && val > 0) {
            this._frequencyWindow = val;
        } else {
            throw new Error("Invalid frequency window: " + val);
        }
        if (this._triggerNextCallback) {
            this._triggerNextCallback();
        }
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
            const time: number = now - this._frequencyWindow;
            let i: number = 0;
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
    public _reject(err: Promise<never>): void {
        if (this._deferred) {
            this._deferred.resolve(err);
            this._locallyHandled = true;
            this._deferred = undefined;
        } else if (!this._promise) {
            this._promise = err;
        } else {
            if (this._locallyHandled) {
                handleErr(err);
            } else {
                this._secondaryRejections.push(err);
            }
            return;
        }

        this._recentRejection = true;
        // The group error state should reset on the next tick
        process.nextTick(() => {
            this._recentRejection = false;
            if (this._activeTaskCount < 1) {
                this._deferred = undefined;
                this._promise = undefined;
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
        if (this._promise) {
            this._locallyHandled = true;
            if (this._secondaryRejections.length) {
                this._secondaryRejections.forEach((rejection) => {
                    handleErr(rejection);
                });
                this._secondaryRejections.length = 0;
            }
            return this._promise;
        }
        if (this._activeTaskCount <= 0) {
            return Promise.resolve();
        }

        this._deferred = defer();
        this._promise = this._deferred.promise;
        return this._promise;
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
        if (this._deferred) {
            this._deferred.resolve();
            this._deferred = undefined;
        }
        if (!this._recentRejection) {
            this._locallyHandled = false;
            this._promise = undefined;
        }
    }
}
