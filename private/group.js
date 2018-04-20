"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const defer = require("p-defer");
const utils_1 = require("./utils");
/** Internal use only */
class PromisePoolGroupPrivate {
    constructor(pool, triggerNextCallback, options) {
        this._frequencyStarts = [];
        this._activeTaskCount = 0;
        this._activePromiseCount = 0;
        this._deferreds = [];
        /**
         * This flag prevents a rejection from being removed before nextTick is called.
         * This way, you can be certain that when calling waitForIdle after adding a task, the error will get handled.
         */
        this._recentRejection = false;
        /**
         * This flag indicates whether the rejection was handled by this group. This is used to flag subsequent rejections
         * within the group as handled.
         */
        this._locallyHandled = false;
        /**
         * Contains any additional rejections so they can be flagged as handled before the nextTick fires if applicable
         */
        this._secondaryRejections = [];
        this._pool = pool;
        if (!options) {
            options = {};
        }
        // Throw errors if applicable
        this.concurrencyLimit = options.concurrencyLimit;
        this.frequencyLimit = options.frequencyLimit;
        this.frequencyWindow = options.frequencyWindow;
        // Set the callback afterwards so it does not get triggered during creation
        this._triggerNextCallback = triggerNextCallback;
    }
    get activeTaskCount() {
        return this._activeTaskCount;
    }
    get activePromiseCount() {
        return this._activePromiseCount;
    }
    get concurrencyLimit() {
        return this._concurrencyLimit;
    }
    set concurrencyLimit(val) {
        if (utils_1.isNull(val)) {
            this._concurrencyLimit = Infinity;
        }
        else if (val && typeof val === "number" && val > 0) {
            this._concurrencyLimit = val;
        }
        else {
            throw new Error("Invalid concurrency limit: " + val);
        }
        if (this._triggerNextCallback) {
            this._triggerNextCallback();
        }
    }
    get frequencyLimit() {
        return this._frequencyLimit;
    }
    set frequencyLimit(val) {
        if (utils_1.isNull(val)) {
            this._frequencyLimit = Infinity;
        }
        else if (val && typeof val === "number" && val > 0) {
            this._frequencyLimit = val;
        }
        else {
            throw new Error("Invalid frequency limit: " + val);
        }
        if (this._triggerNextCallback) {
            this._triggerNextCallback();
        }
    }
    get frequencyWindow() {
        return this._frequencyWindow;
    }
    set frequencyWindow(val) {
        if (utils_1.isNull(val)) {
            this._frequencyWindow = 1000;
        }
        else if (val && typeof val === "number" && val > 0) {
            this._frequencyWindow = val;
        }
        else {
            throw new Error("Invalid frequency window: " + val);
        }
        if (this._triggerNextCallback) {
            this._triggerNextCallback();
        }
    }
    get freeSlots() {
        if (this._frequencyLimit !== Infinity) {
            this._cleanFrequencyStarts(Date.now());
        }
        return this._getFreeSlots();
    }
    _getFreeSlots() {
        return Math.min(this._concurrencyLimit - this._activePromiseCount, this._frequencyLimit - this._frequencyStarts.length);
    }
    /**
     * Cleans out old entries from the frequencyStarts array. Uses a passed timestamp to ensure consistency between
     * groups.
     */
    _cleanFrequencyStarts(now) {
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
    _busyTime() {
        if (this._activePromiseCount >= this._concurrencyLimit) {
            return Infinity;
        }
        else if (this._frequencyLimit && this._frequencyStarts.length >= this._frequencyLimit) {
            return this._frequencyStarts[0] + this._frequencyWindow;
        }
        return 0;
    }
    /**
     * Resolves all pending waitForIdle promises.
     */
    _resolve() {
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
    _reject(err) {
        if (this._rejection) {
            if (this._locallyHandled) {
                return true;
            }
            this._secondaryRejections.push(err);
            return false;
        }
        let handled = false;
        this._rejection = err;
        if (this._deferreds.length) {
            handled = true;
            this._locallyHandled = true;
            this._deferreds.forEach((deferred) => {
                deferred.reject(err.error);
            });
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
        return handled;
    }
    /**
     * Returns a promise which resolves when the group becomes idle.
     */
    waitForIdle() {
        if (this._rejection) {
            this._locallyHandled = true;
            if (this._secondaryRejections.length) {
                this._secondaryRejections.forEach((rejection) => {
                    if (rejection.promise) {
                        rejection.promise.catch(() => {
                            // handle the rejection
                        });
                        rejection.promise = undefined;
                    }
                });
                this._secondaryRejections.length = 0;
            }
            if (this._rejection.promise) {
                const promise = this._rejection.promise;
                this._rejection.promise = undefined;
                return promise;
            }
            return Promise.reject(this._rejection.error);
        }
        if (this._activeTaskCount <= 0) {
            return Promise.resolve();
        }
        const deferred = defer();
        this._deferreds.push(deferred);
        return deferred.promise;
    }
    _incrementTasks() {
        this._activeTaskCount++;
    }
    /**
     * Decrements the active tasks, resolving promises if applicable.
     */
    _decrementTasks() {
        this._activeTaskCount--;
        if (this._activeTaskCount > 0) {
            return;
        }
        if (this._rejection && !this._recentRejection) {
            this._rejection = undefined;
            this._locallyHandled = false;
        }
        else {
            this._resolve();
        }
    }
}
exports.PromisePoolGroupPrivate = PromisePoolGroupPrivate;
