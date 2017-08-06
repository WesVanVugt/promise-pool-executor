import { PromisePoolGroupOptions } from "../public/group";
import { PersistentBatcherTask, PersistentBatcherTaskParams } from "../public/persistent-batch";
import { PromisePoolExecutor } from "../public/pool";
import { PromisePoolTask } from "../public/task";
import { isNull, ResolvablePromise } from "./utils";

export class PersistentBatchTaskPrivate<I, O> implements PersistentBatcherTask<I, O> {
    private _task: PromisePoolTask<any>;
    private _maxBatchSize: number = Infinity;
    private _queuingDelay: number = 1;
    private _queuingThresholds: number[];
    private _activePromiseCount: number = 0;
    private _inputQueue: I[] = [];
    private _outputPromises: Array<ResolvablePromise<O>> = [];
    private _generator: (input: I[]) => Promise<Array<O | Error>>;
    private _runTimeout: NodeJS.Timer;
    private _running: boolean = false;

    constructor(pool: PromisePoolExecutor, params: PersistentBatcherTaskParams<I, O>) {
        const batcher = this;
        this._generator = params.generator;
        if (Array.isArray(params.queuingThresholds)) {
            if (!params.queuingThresholds.length) {
                throw new Error("params.batchThresholds must contain at least one number");
            }
            params.queuingThresholds.forEach((n) => {
                if (n < 1) {
                    throw new Error("params.batchThresholds must not contain numbers less than 1");
                }
            });
            this._queuingThresholds = [...params.queuingThresholds];
        } else {
            this._queuingThresholds = [1];
        }
        if (!isNull(params.maxBatchSize)) {
            if (params.maxBatchSize < 1) {
                throw new Error("params.batchSize must be greater than 0");
            }
            this._maxBatchSize = params.maxBatchSize;
        }
        if (!isNull(params.queuingDelay)) {
            this._queuingDelay = params.queuingDelay;
        }

        this._task = pool.addGenericTask({
            concurrencyLimit: params.concurrencyLimit,
            frequencyLimit: params.frequencyLimit,
            frequencyWindow: params.frequencyWindow,
            paused: true,
            generator() {
                batcher._running = false;
                batcher._activePromiseCount++;
                const inputs = batcher._inputQueue.splice(0, batcher._maxBatchSize);
                const outputPromises = batcher._outputPromises.splice(0, batcher._maxBatchSize);

                // Prepare for the next iteration, pausing the task if needed
                batcher._run();
                if (!batcher._running || batcher._runTimeout) {
                    batcher._task.pause();
                }

                let batchPromise;
                try {
                    batchPromise = batcher._generator(inputs);
                    if (!(batchPromise instanceof Promise)) {
                        batchPromise = Promise.resolve(batchPromise);
                    }
                } catch (err) {
                    batchPromise = Promise.reject(err);
                }

                return batchPromise.then((outputs) => {
                    if (outputs.length !== outputPromises.length) {
                        // TODO: Add a test for this
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
                    batcher._activePromiseCount--;
                    // Since we may be operating at a lower queuing threshold now, we should try run again
                    batcher._run();
                });
            },
        });
    }

    public getResult(input: I): Promise<O> {
        const index = this._inputQueue.length;
        this._inputQueue[index] = input;
        const promise = new ResolvablePromise<O>();
        this._outputPromises[index] = promise;
        this._run();
        return promise.promise;
    }

    public end(): void {
        this._task.end();
    }

    private _run(): void {
        // If the queue has reached the maximum batch size, start it immediately
        if (this._inputQueue.length >= this._maxBatchSize) {
            if (this._runTimeout) {
                clearTimeout(this._runTimeout);
                this._runTimeout = null;
            }
            this._running = true;
            this._task.resume();
            return;
        }
        if (this._running) {
            return;
        }
        const thresholdIndex: number = Math.min(this._activePromiseCount, this._queuingThresholds.length - 1);
        if (this._inputQueue.length >= this._queuingThresholds[thresholdIndex]) {
            // Run the batch, but with a delay
            this._running = true;
            this._runTimeout = setTimeout(() => {
                this._runTimeout = null;
                this._task.resume();
            }, this._queuingDelay);
        }
    }
}
