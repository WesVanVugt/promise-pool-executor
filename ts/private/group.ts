import defer = require("defer-promise");
import { PromisePoolGroup, PromisePoolGroupOptions } from "../public/group";
import { PromisePoolExecutor } from "../public/pool";
import { debug, isNull, TaskError } from "./utils";

/** Internal use only */
export class PromisePoolGroupPrivate implements PromisePoolGroup {
    public _pool: PromisePoolExecutor;
    public _concurrencyLimit: number;
    public _frequencyLimit: number;
    public _frequencyWindow: number;
    public _frequencyStarts: number[] = [];
    public _activeTaskCount: number = 0;
    public _activePromiseCount: number = 0;
    private _deferreds: Array<Deferred<void>> = [];
    private _rejection?: TaskError;
    private _triggerNextCallback: () => void;

    constructor(
        pool: PromisePoolExecutor,
        triggerNextCallback: () => void,
        options?: PromisePoolGroupOptions,
    ) {
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
     * Resolves all pending waitForIdle promises.
     */
    public _resolve() {
        if (!this._rejection && this._deferreds.length) {
            this._deferreds.forEach((deferred) => {
                deferred.resolve();
            });
            this._deferreds.length = 0;
        }
    }

    /**
     * Rejects all pending waitForIdle promises using the provided error.
     */
    public _reject(err: TaskError): void {
        if (this._rejection) {
            return;
        }
        this._rejection = err;
        if (this._deferreds.length) {
            err.handled = true;
            this._deferreds.forEach((deferred) => {
                deferred.reject(err.error);
            });
            this._deferreds.length = 0;
        }
        // The group error state should reset on the next tick
        process.nextTick(() => {
            delete this._rejection;
        });
    }

    /**
     * Returns a promise which resolves when the group becomes idle.
     */
    public waitForIdle(): Promise<void> {
        if (this._rejection) {
            this._rejection.handled = true;
            return Promise.reject(this._rejection.error);
        }
        if (this._activeTaskCount <= 0) {
            return Promise.resolve();
        }

        const deferred: Deferred<void> = defer();
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
        if (this._activeTaskCount < 1) {
            this._resolve();
        }
    }
}
