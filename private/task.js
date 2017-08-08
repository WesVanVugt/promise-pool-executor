"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const nextTick = require("next-tick");
const task_1 = require("../public/task");
const utils_1 = require("./utils");
const GLOBAL_GROUP_INDEX = 0;
const DEBUG_PREFIX = "[Task] ";
class PromisePoolTaskPrivate {
    constructor(privateOptions, options) {
        this._invocations = 0;
        this._invocationLimit = Infinity;
        this._result = [];
        this._promises = [];
        utils_1.debug(`${DEBUG_PREFIX}Creating task`);
        this._pool = privateOptions.pool;
        this._triggerCallback = privateOptions.triggerNowCallback;
        this._detachCallback = privateOptions.detach;
        this._resultConverter = options.resultConverter;
        this._state = options.paused ? task_1.TaskState.Paused : task_1.TaskState.Active;
        if (!utils_1.isNull(options.invocationLimit)) {
            if (typeof options.invocationLimit !== "number") {
                throw new Error("Invalid invocation limit: " + options.invocationLimit);
            }
            this._invocationLimit = options.invocationLimit;
        }
        // Create a group exclusively for this task. This may throw errors.
        this._taskGroup = privateOptions.pool.addGroup(options);
        this._groups = [privateOptions.globalGroup, this._taskGroup];
        if (options.groups) {
            const groups = options.groups;
            groups.forEach((group) => {
                if (group._pool !== this._pool) {
                    throw new Error("options.groups contains a group belonging to a different pool");
                }
            });
            this._groups.push(...groups);
        }
        this._generator = options.generator;
        // Resolve the promise only after all options have been validated
        if (!utils_1.isNull(options.invocationLimit) && options.invocationLimit <= 0) {
            this.end();
            return;
        }
        this._groups.forEach((group) => {
            group._incrementTasks();
        });
        // The creator will trigger the promises to run
    }
    get activePromiseCount() {
        return this._taskGroup._activePromiseCount;
    }
    get invocations() {
        return this._invocations;
    }
    get invocationLimit() {
        return this._invocationLimit;
    }
    set invocationLimit(val) {
        if (utils_1.isNull(val)) {
            this._invocationLimit = Infinity;
        }
        else if (!isNaN(val) && typeof val === "number" && val >= 0) {
            this._invocationLimit = val;
            if (this._invocations >= this._invocationLimit) {
                this.end();
            }
        }
        else {
            throw new Error("Invalid invocation limit: " + val);
        }
        if (this._triggerCallback) {
            this._triggerCallback();
        }
    }
    get concurrencyLimit() {
        return this._taskGroup.concurrencyLimit;
    }
    set concurrencyLimit(val) {
        this._taskGroup.concurrencyLimit = val;
    }
    get frequencyLimit() {
        return this._taskGroup.frequencyLimit;
    }
    set frequencyLimit(val) {
        this._taskGroup.frequencyLimit = val;
    }
    get frequencyWindow() {
        return this._taskGroup.frequencyWindow;
    }
    set frequencyWindow(val) {
        this._taskGroup.frequencyWindow = val;
    }
    get freeSlots() {
        let freeSlots = this._invocationLimit - this._invocations;
        this._groups.forEach((group) => {
            const slots = group.freeSlots;
            if (slots < freeSlots) {
                freeSlots = slots;
            }
        });
        return freeSlots;
    }
    get state() {
        return this._state;
    }
    /**
     * Returns a promise which resolves when the task completes.
     */
    promise() {
        if (this._rejection) {
            this._rejection.handled = true;
            return Promise.reject(this._rejection.error);
        }
        else if (this._state === task_1.TaskState.Terminated) {
            return Promise.resolve(this._returnResult);
        }
        const promise = new utils_1.ResolvablePromise();
        this._promises.push(promise);
        return promise.promise;
    }
    /**
     * Pauses an active task, preventing any additional promises from being generated.
     */
    pause() {
        if (this._state === task_1.TaskState.Active) {
            utils_1.debug(`${DEBUG_PREFIX}State: Paused`);
            this._state = task_1.TaskState.Paused;
        }
    }
    /**
     * Resumes a paused task, allowing for the generation of additional promises.
     */
    resume() {
        if (this._state === task_1.TaskState.Paused) {
            utils_1.debug(`${DEBUG_PREFIX}State: Active`);
            this._state = task_1.TaskState.Active;
            this._triggerCallback();
        }
    }
    /**
     * Ends the task. Any promises created by the promise() method will be resolved when all outstanding promises
     * have ended.
     */
    end() {
        // Note that this does not trigger more tasks to run. It can resolve a task though.
        utils_1.debug(`${DEBUG_PREFIX}Ending`);
        if (this._state < task_1.TaskState.Exhausted) {
            utils_1.debug(`${DEBUG_PREFIX}State: Exhausted`);
            this._state = task_1.TaskState.Exhausted;
            if (this._taskGroup._activeTaskCount > 0) {
                this._detachCallback();
            }
        }
        if (!this._generating && this._state < task_1.TaskState.Terminated && this._taskGroup._activePromiseCount <= 0) {
            utils_1.debug(`${DEBUG_PREFIX}State: Terminated`);
            this._state = task_1.TaskState.Terminated;
            if (this._taskGroup._activeTaskCount > 0) {
                this._groups.forEach((group) => {
                    group._decrementTasks();
                });
            }
            this._resolve();
        }
    }
    /**
     * Private. Returns 0 if the task is ready, Infinity if the task is busy with an indeterminate ready time, or the
     * timestamp for when the task will be ready.
     */
    _busyTime() {
        if (this._state !== task_1.TaskState.Active) {
            return Infinity;
        }
        let time = 0;
        for (const group of this._groups) {
            const busyTime = group._busyTime();
            if (busyTime > time) {
                time = busyTime;
            }
        }
        return time;
    }
    _cleanFrequencyStarts(now) {
        this._groups.forEach((group, index) => {
            if (index > GLOBAL_GROUP_INDEX) {
                group._cleanFrequencyStarts(now);
            }
        });
    }
    /**
     * Private. Invokes the task.
     */
    _run() {
        if (this._generating) {
            // This should never happen
            throw new Error("Internal Error: Task is already being run");
        }
        if (this._invocations >= this._invocationLimit) {
            // TODO: Make a test for this
            // This may detach / resolve the task if no promises are active
            this.end();
            return;
        }
        utils_1.debug(`${DEBUG_PREFIX}Running generator`);
        let promise;
        this._generating = true; // prevent task termination
        try {
            promise = this._generator.call(this, this._invocations);
        }
        catch (err) {
            this._generating = false;
            this._reject(err);
            return;
        }
        this._generating = false;
        if (utils_1.isNull(promise)) {
            if (this._state !== task_1.TaskState.Paused) {
                this.end();
            }
            // Remove the task if needed and start the next task
            return;
        }
        if (!(promise instanceof Promise)) {
            // In case what is returned is not a promise, make it one
            promise = Promise.resolve(promise);
        }
        this._groups.forEach((group) => {
            group._activePromiseCount++;
            if (group._frequencyLimit !== Infinity) {
                group._frequencyStarts.push(Date.now());
            }
        });
        const resultIndex = this._invocations;
        this._invocations++;
        if (this._invocations >= this._invocationLimit) {
            // this will not detach the task since there are active promises
            this.end();
        }
        promise.catch((err) => {
            this._reject(err);
            // Resolve
        }).then((result) => {
            utils_1.debug(`${DEBUG_PREFIX}Promise ended.`);
            this._groups.forEach((group) => {
                group._activePromiseCount--;
            });
            utils_1.debug(`${DEBUG_PREFIX}Promise Count: ${this._taskGroup._activePromiseCount}`);
            // Avoid storing the result if it is undefined.
            // Some tasks may have countless iterations and never return anything, so this could eat memory.
            if (result !== undefined && this._result) {
                this._result[resultIndex] = result;
            }
            if (this._state >= task_1.TaskState.Exhausted && this._taskGroup._activePromiseCount <= 0) {
                this.end();
            }
            // Remove the task if needed and start the next task
            this._triggerCallback();
        });
    }
    /**
     * Private. Resolves the task if possible. Should only be called by end()
     */
    _resolve() {
        if (this._rejection || !this._result) {
            return;
        }
        // Set the length of the resulting array in case some undefined results affected this
        this._result.length = this._invocations;
        this._state = task_1.TaskState.Terminated;
        if (this._resultConverter) {
            try {
                this._returnResult = this._resultConverter(this._result);
            }
            catch (err) {
                this._reject(err);
                return;
            }
        }
        else {
            this._returnResult = this._result;
        }
        // discard the original array to free memory
        this._result = undefined;
        if (this._promises.length) {
            this._promises.forEach((promise) => {
                promise.resolve(this._returnResult);
            });
            this._promises.length = 0;
        }
    }
    _reject(err) {
        // Check if the task has already failed
        if (this._rejection) {
            utils_1.debug(`${DEBUG_PREFIX}This task already failed!`);
            // Unhandled promise rejection
            Promise.reject(err);
            return;
        }
        const taskError = {
            error: err,
            handled: false,
        };
        this._rejection = taskError;
        // This may detach the task
        this.end();
        if (this._promises.length) {
            taskError.handled = true;
            this._promises.forEach((promise) => {
                promise.reject(taskError.error);
            });
            this._promises.length = 0;
        }
        this._groups.forEach((group) => {
            group._reject(taskError);
        });
        if (!taskError.handled) {
            // Wait a tick to see if the error gets handled
            nextTick(() => {
                if (!taskError.handled) {
                    // Unhandled promise rejection
                    utils_1.debug(`${DEBUG_PREFIX}Unhandled promise rejection!`);
                    Promise.reject(taskError.error);
                }
            });
        }
    }
}
exports.PromisePoolTaskPrivate = PromisePoolTaskPrivate;
