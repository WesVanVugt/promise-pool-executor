"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../private/utils");
const DEBUG_PREFIX = "[Batcher] ";
class Batcher {
    constructor(options) {
        this._maxBatchSize = Infinity;
        this._queuingDelay = 1;
        this._inputQueue = [];
        this._outputPromises = [];
        this._waiting = false;
        this._activePromiseCount = 0;
        const batcher = this;
        this._generator = options.generator;
        this._delayFunction = options.delayFunction;
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
    }
    getResult(input) {
        const index = this._inputQueue.length;
        utils_1.debug(`${DEBUG_PREFIX}Queuing request at index ${index}.`);
        this._inputQueue[index] = input;
        const promise = new utils_1.ResolvablePromise();
        this._outputPromises[index] = promise;
        this._trigger();
        return promise.promise;
    }
    _trigger() {
        if (this._waiting && !this._waitTimeout) {
            return;
        }
        // If the queue has reached the maximum batch size, start it immediately
        if (this._inputQueue.length >= this._maxBatchSize) {
            utils_1.debug(`${DEBUG_PREFIX}Queue reached maxBatchSize, launching immediately.`);
            if (this._waitTimeout) {
                clearTimeout(this._waitTimeout);
            }
            this._waitTimeout = undefined;
            this._waiting = true;
            this._run();
            return;
        }
        if (this._waiting) {
            return;
        }
        const thresholdIndex = Math.min(this._activePromiseCount, this._queuingThresholds.length - 1);
        if (this._inputQueue.length >= this._queuingThresholds[thresholdIndex]) {
            // Run the batch, but with a delay
            this._waiting = true;
            utils_1.debug(`${DEBUG_PREFIX}Running in ${this._queuingDelay}ms (thresholdIndex ${thresholdIndex}).`);
            // Tests showed that nextTick would commonly run before promises could resolve.
            // SetImmediate would run later than setTimeout as well.
            this._waitTimeout = setTimeout(() => {
                this._waitTimeout = undefined;
                this._run();
            }, this._queuingDelay);
        }
    }
    _run() {
        if (this._delayFunction) {
            // TODO: Test error handling here
            let result;
            try {
                result = this._delayFunction();
            }
            catch (err) {
                result = Promise.reject(err);
            }
            if (!utils_1.isNull(result)) {
                const resultPromise = result instanceof Promise ? result : Promise.resolve(result);
                resultPromise.then(() => {
                    this._runImmediately();
                }).catch((err) => {
                    utils_1.debug(DEBUG_PREFIX + "Caught error in delayFunction. Rejecting promises.");
                    this._inputQueue.length = 0;
                    const promises = this._outputPromises.splice(0, this._outputPromises.length);
                    promises.forEach((promise) => {
                        promise.reject(err);
                    });
                    this._waiting = false;
                });
                return;
            }
            utils_1.debug(DEBUG_PREFIX + "Bypassing batch delay.");
        }
        this._runImmediately();
    }
    _runImmediately() {
        const inputs = this._inputQueue.splice(0, this._maxBatchSize);
        const outputPromises = this._outputPromises.splice(0, this._maxBatchSize);
        utils_1.debug(`${DEBUG_PREFIX}Running batch of ${inputs.length}.`);
        let batchPromise;
        try {
            batchPromise = this._generator.call(this, inputs);
            if (!(batchPromise instanceof Promise)) {
                batchPromise = Promise.resolve(batchPromise);
            }
        }
        catch (err) {
            batchPromise = Promise.reject(err);
        }
        this._waiting = false;
        this._activePromiseCount++;
        batchPromise.then((outputs) => {
            if (!Array.isArray(outputs)) {
                throw new Error("Invalid type returned from generator.");
            }
            utils_1.debug(`${DEBUG_PREFIX}Promise resolved.`);
            if (outputs.length !== outputPromises.length) {
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
            this._activePromiseCount--;
            // Since we may be operating at a lower queuing threshold now, we should try run again
            this._trigger();
        });
        this._trigger();
    }
}
exports.Batcher = Batcher;
