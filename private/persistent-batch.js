"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const task_1 = require("../public/task");
const utils_1 = require("./utils");
const DEBUG_PREFIX = "[PersistentBatchTask] ";
class PersistentBatchTaskPrivate {
    constructor(pool, options) {
        this._maxBatchSize = Infinity;
        this._queuingDelay = 1;
        this._inputQueue = [];
        this._outputPromises = [];
        this._waiting = false;
        const batcher = this;
        this._generator = options.generator;
        if (Array.isArray(options.queuingThresholds)) {
            if (!options.queuingThresholds.length) {
                throw new Error("options.batchThresholds must contain at least one number");
            }
            options.queuingThresholds.forEach((n) => {
                if (n < 1) {
                    throw new Error("options.batchThresholds must only contain numbers greater than 0");
                }
            });
            this._queuingThresholds = [...options.queuingThresholds];
        }
        else {
            this._queuingThresholds = [1];
        }
        if (!utils_1.isNull(options.maxBatchSize)) {
            if (options.maxBatchSize < 1) {
                throw new Error("options.batchSize must be greater than 0");
            }
            this._maxBatchSize = options.maxBatchSize;
        }
        if (!utils_1.isNull(options.queuingDelay)) {
            if (options.queuingDelay < 0) {
                throw new Error("options.queuingDelay must be greater than or equal to 0");
            }
            this._queuingDelay = options.queuingDelay;
        }
        this._task = pool.addGenericTask({
            concurrencyLimit: options.concurrencyLimit,
            frequencyLimit: options.frequencyLimit,
            frequencyWindow: options.frequencyWindow,
            paused: true,
            generator() {
                if (!batcher._waiting) {
                    utils_1.debug(`${DEBUG_PREFIX}Persistent batch task limit passed.`);
                    batcher._run();
                    // If the batch is not ready to launch, or is launching on a delay, then pause and return
                    if (!batcher._waiting || batcher._waitTimeout) {
                        batcher._task.pause();
                        return;
                    }
                }
                batcher._waiting = false;
                const inputs = batcher._inputQueue.splice(0, batcher._maxBatchSize);
                const outputPromises = batcher._outputPromises.splice(0, batcher._maxBatchSize);
                // Prepare for the next iteration, pausing the task if needed
                batcher._run();
                if (!batcher._waiting || batcher._waitTimeout) {
                    batcher._task.pause();
                }
                utils_1.debug(`${DEBUG_PREFIX}Running batch of ${inputs.length}.`);
                let batchPromise;
                try {
                    batchPromise = batcher._generator.call(this, inputs);
                    if (!(batchPromise instanceof Promise)) {
                        batchPromise = Promise.resolve(batchPromise);
                    }
                }
                catch (err) {
                    batchPromise = Promise.reject(err);
                }
                return batchPromise.then((outputs) => {
                    utils_1.debug(`${DEBUG_PREFIX}Promise resolved.`);
                    if (outputs.length !== outputPromises.length) {
                        // TODO: Add a test for this
                        throw new Error("Generator function output length does not equal the input length.");
                    }
                    outputPromises.forEach((promise, index) => {
                        const output = outputs[index];
                        if (output instanceof Error) {
                            promise.reject(output);
                        }
                        else {
                            promise.resolve(output);
                        }
                    });
                }).catch((err) => {
                    outputPromises.forEach((promise) => {
                        promise.reject(err);
                    });
                }).then(() => {
                    // Since we may be operating at a lower queuing threshold now, we should try run again
                    batcher._run(true);
                });
            },
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
        const index = this._inputQueue.length;
        utils_1.debug(`${DEBUG_PREFIX}Queuing request at index ${index}.`);
        this._inputQueue[index] = input;
        const promise = new utils_1.ResolvablePromise();
        this._outputPromises[index] = promise;
        this._run();
        return promise.promise;
    }
    end() {
        this._task.end();
        this._outputPromises.forEach((promise) => {
            promise.reject(new Error("This task has ended and cannot process more items"));
        });
        this._outputPromises.length = 0;
        this._inputQueue.length = 0;
    }
    _run(promiseEnding = false) {
        // If the queue has reached the maximum batch size, start it immediately
        if (this._inputQueue.length >= this._maxBatchSize) {
            utils_1.debug(`${DEBUG_PREFIX}Queue reached maxBatchSize, launching immediately.`);
            if (this._waitTimeout) {
                clearTimeout(this._waitTimeout);
            }
            this._waitTimeout = undefined;
            this._waiting = true;
            this._task.resume();
            return;
        }
        if (this._waiting) {
            return;
        }
        const activePromiseCount = this._task.activePromiseCount + (promiseEnding ? -1 : 0);
        const thresholdIndex = Math.min(activePromiseCount, this._queuingThresholds.length - 1);
        if (this._inputQueue.length >= this._queuingThresholds[thresholdIndex]) {
            if (activePromiseCount >= this._task.concurrencyLimit) {
                utils_1.debug(`${DEBUG_PREFIX}Hit concurrency limit.`);
                return;
            }
            // Run the batch, but with a delay
            this._waiting = true;
            utils_1.debug(`${DEBUG_PREFIX}Running in ${this._queuingDelay}ms (thresholdIndex ${thresholdIndex}).`);
            // Tests showed that nextTick would commonly run before promises could resolve.
            // SetImmediate would run later than setTimeout as well.
            this._waitTimeout = setTimeout(() => {
                this._waitTimeout = undefined;
                this._task.resume();
            }, this._queuingDelay);
        }
    }
}
exports.PersistentBatchTaskPrivate = PersistentBatchTaskPrivate;
