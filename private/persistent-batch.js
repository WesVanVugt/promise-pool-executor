"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const promise_batcher_1 = require("promise-batcher");
const task_1 = require("../public/task");
const utils_1 = require("./utils");
const DEBUG_PREFIX = "[PersistentBatchTask] ";
class PersistentBatchTaskPrivate {
    constructor(pool, options) {
        this._ended = false;
        let immediate;
        let delayPromise;
        let taskPromise;
        this._generator = options.generator;
        this._batcher = new promise_batcher_1.Batcher({
            // TODO: Make the promises local
            batchingFunction: (inputs) => {
                if (!taskPromise) {
                    throw new Error(DEBUG_PREFIX + "Expected taskPromise to be set (internal error).");
                }
                const localTaskPromise = taskPromise;
                taskPromise = undefined;
                let promise;
                try {
                    const result = this._generator(inputs);
                    promise = result instanceof Promise ? result : Promise.resolve(result);
                }
                catch (err) {
                    promise = Promise.reject(err);
                }
                return promise.catch((err) => {
                    // Do not send errors to the task, since they will be received via the getResult promises
                    localTaskPromise.resolve();
                    throw err;
                }).then((outputs) => {
                    localTaskPromise.resolve();
                    return outputs;
                });
            },
            delayFunction: () => {
                if (delayPromise) {
                    throw new Error(DEBUG_PREFIX + "Expected delayPromise not to be set (internal error).");
                }
                if (this._ended) {
                    throw new Error("This task has ended and cannot process more items");
                }
                immediate = false;
                this._task.resume();
                if (immediate) {
                    return;
                }
                delayPromise = new utils_1.ResolvablePromise();
                return delayPromise.promise;
            },
            maxBatchSize: options.maxBatchSize,
            queuingDelay: options.queuingDelay,
            queuingThresholds: options.queuingThresholds,
        });
        this._task = pool.addGenericTask({
            concurrencyLimit: options.concurrencyLimit,
            frequencyLimit: options.frequencyLimit,
            frequencyWindow: options.frequencyWindow,
            generator: () => {
                this._task.pause();
                // TODO: Error handling
                if (taskPromise) {
                    throw new Error(DEBUG_PREFIX + "Expected completePromise not to be set (internal error).");
                }
                taskPromise = new utils_1.ResolvablePromise();
                if (delayPromise) {
                    const localDelayPromise = delayPromise;
                    delayPromise.resolve();
                    delayPromise = undefined;
                }
                else {
                    immediate = true;
                }
                return taskPromise.promise;
            },
            paused: true,
        });
    }
    get activePromiseCount() {
        return this._task.activePromiseCount;
    }
    get concurrencyLimit() {
        return this._task.concurrencyLimit;
    }
    set concurrencyLimit(val) {
        this._task.concurrencyLimit = val;
    }
    get frequencyLimit() {
        return this._task.frequencyLimit;
    }
    set frequencyLimit(val) {
        this._task.frequencyLimit = val;
    }
    get frequencyWindow() {
        return this._task.frequencyWindow;
    }
    set frequencyWindow(val) {
        this._task.frequencyWindow = val;
    }
    get freeSlots() {
        return this._task.freeSlots;
    }
    get state() {
        return this._task.state;
    }
    getResult(input) {
        if (this._task.state >= task_1.TaskState.Exhausted) {
            return Promise.reject(new Error("This task has ended and cannot process more items"));
        }
        return this._batcher.getResult(input);
    }
    end() {
        this._task.end();
        this._ended = true;
    }
}
exports.PersistentBatchTaskPrivate = PersistentBatchTaskPrivate;
