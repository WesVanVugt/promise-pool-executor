import pDefer = require("p-defer");
import { debug, isNull, ResolvablePromise } from "../private/utils";

const DEBUG_PREFIX: string = "[Batcher] ";

export interface PersistentBatchTaskOptions<I, O> {
    /**
     * The maximum number of requests that can be combined in a single batch.
     */
    maxBatchSize?: number;
    /**
     * The number of milliseconds to wait before running a batch of requests.
     */
    queuingDelay?: number;
    /**
     * An array containing the number of requests that must be queued in order to trigger a batch request at
     * each level of concurrency
     */
    queuingThresholds?: number[];
    /**
     * A function which is passed an array of request values, returning a promise which resolves to an array of
     * response values.
     */
    generator(this: PersistentBatchTaskOptions<I, O>, input: I[]): Array<O | Error> | PromiseLike<Array<O | Error>>;
    delayFunction?(): PromiseLike<void> | undefined | null | void;
}

export interface PersistentBatchTask<I, O> {
    /**
     * Returns a promise which resolves or rejects with the individual result returned from the task's generator
     * function.
     */
    getResult(input: I): Promise<O>;
}

export class Batcher<I, O> {
    private _maxBatchSize: number = Infinity;
    private _queuingDelay: number = 1;
    private _queuingThresholds: number[];
    private _inputQueue: I[] = [];
    private _outputPromises: Array<ResolvablePromise<O>> = [];
    private _delayFunction?: () => PromiseLike<void> | undefined | null | void;
    private _generator: (input: I[]) => Array<O | Error> | PromiseLike<Array<O | Error>>;
    private _waitTimeout?: any;
    private _waiting: boolean = false;
    private _activePromiseCount: number = 0;

    constructor(options: PersistentBatchTaskOptions<I, O>) {
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
        } else {
            this._queuingThresholds = [1];
        }
        if (!isNull(options.maxBatchSize)) {
            if (options.maxBatchSize < 1) {
                throw new Error("options.batchSize must be greater than 0");
            }
            this._maxBatchSize = options.maxBatchSize;
        }
        if (!isNull(options.queuingDelay)) {
            if (options.queuingDelay < 0) {
                throw new Error("options.queuingDelay must be greater than or equal to 0");
            }
            this._queuingDelay = options.queuingDelay;
        }
    }

    public getResult(input: I): Promise<O> {
        const index = this._inputQueue.length;
        debug(`${DEBUG_PREFIX}Queuing request at index ${index}.`);
        this._inputQueue[index] = input;
        const promise = new ResolvablePromise<O>();
        this._outputPromises[index] = promise;
        this._trigger();
        return promise.promise;
    }

    private _trigger(): void {
        if (this._waiting && !this._waitTimeout) {
            return;
        }

        // If the queue has reached the maximum batch size, start it immediately
        if (this._inputQueue.length >= this._maxBatchSize) {
            debug(`${DEBUG_PREFIX}Queue reached maxBatchSize, launching immediately.`);
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
        const thresholdIndex: number = Math.min(
            this._activePromiseCount, this._queuingThresholds.length - 1,
        );
        if (this._inputQueue.length >= this._queuingThresholds[thresholdIndex]) {
            // Run the batch, but with a delay
            this._waiting = true;
            debug(`${DEBUG_PREFIX}Running in ${this._queuingDelay}ms (thresholdIndex ${thresholdIndex}).`);
            // Tests showed that nextTick would commonly run before promises could resolve.
            // SetImmediate would run later than setTimeout as well.
            this._waitTimeout = setTimeout(() => {
                this._waitTimeout = undefined;
                this._run();
            }, this._queuingDelay);
        }
    }

    private _run(): void {
        if (this._delayFunction) {
            // TODO: Test error handling here
            let result: void | PromiseLike<void> | null | undefined;
            try {
                result = this._delayFunction();
            } catch (err) {
                result = Promise.reject(err);
            }
            if (!isNull(result)) {
                const resultPromise = result instanceof Promise ? result : Promise.resolve(result);
                resultPromise.then(() => {
                    this._runImmediately();
                }).catch((err) => {
                    debug(DEBUG_PREFIX + "Caught error in delayFunction. Rejecting promises.");
                    this._inputQueue.length = 0;
                    const promises = this._outputPromises.splice(0, this._outputPromises.length);
                    promises.forEach((promise) => {
                        promise.reject(err);
                    });
                    this._waiting = false;
                });
                return;
            }
            debug(DEBUG_PREFIX + "Bypassing batch delay.");
        }
        this._runImmediately();
    }

    private _runImmediately(): void {
        const inputs = this._inputQueue.splice(0, this._maxBatchSize);
        const outputPromises = this._outputPromises.splice(0, this._maxBatchSize);

        debug(`${DEBUG_PREFIX}Running batch of ${inputs.length}.`);
        let batchPromise: Promise<Array<O | Error>>;
        try {
            batchPromise = this._generator.call(this, inputs);
            if (!(batchPromise instanceof Promise)) {
                batchPromise = Promise.resolve(batchPromise);
            }
        } catch (err) {
            batchPromise = Promise.reject(err);
        }

        this._waiting = false;
        this._activePromiseCount++;
        batchPromise.then((outputs) => {
            if (!Array.isArray(outputs)) {
                throw new Error("Invalid type returned from generator.");
            }
            debug(`${DEBUG_PREFIX}Promise resolved.`);
            if (outputs.length !== outputPromises.length) {
                throw new Error("Generator function output length does not equal the input length.");
            }
            outputPromises.forEach((promise, index) => {
                const output = outputs[index];
                if (output instanceof Error) {
                    promise.reject(output);
                } else {
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
