import defer, { DeferredPromise } from "p-defer";
import { Batcher } from "promise-batcher";
import { BatchingResult } from "promise-batcher";
import { PersistentBatchTask, PersistentBatchTaskOptions } from "../public/persistent-batch";
import { PromisePoolExecutor } from "../public/pool";
import { PromisePoolTask, TaskState } from "../public/task";

export class PersistentBatchTaskPrivate<I, O> implements PersistentBatchTask<I, O> {
    private _batcher: Batcher<I, O>;
    private _generator: (
        input: readonly I[],
    ) => ReadonlyArray<BatchingResult<O>> | PromiseLike<ReadonlyArray<BatchingResult<O>>>;
    private _task: PromisePoolTask<any>;

    constructor(pool: PromisePoolExecutor, options: PersistentBatchTaskOptions<I, O>) {
        let immediate: boolean | Error;
        let delayDeferred: DeferredPromise<void> | undefined;
        let taskDeferred: DeferredPromise<void> | undefined;

        this._generator = options.generator;
        this._batcher = new Batcher<I, O>({
            batchingFunction: (inputs) => {
                if (!taskDeferred) {
                    throw new Error("Expected taskPromise to be set (internal error).");
                }
                const localTaskDeferred = taskDeferred;
                taskDeferred = undefined;
                let promise: Promise<Array<BatchingResult<O>>>;
                try {
                    const result = this._generator(inputs);
                    promise = result instanceof Promise ? result : Promise.resolve(result);
                } catch (err) {
                    promise = Promise.reject(err);
                }
                return promise
                    .catch((err) => {
                        // Do not send errors to the task, since they will be received via the getResult promises
                        localTaskDeferred.resolve();
                        throw err;
                    })
                    .then((outputs) => {
                        localTaskDeferred.resolve();
                        return outputs;
                    });
            },
            delayFunction: () => {
                if (delayDeferred) {
                    throw new Error("Expected delayDeferred not to be set (internal error).");
                }
                if (this._task.state >= TaskState.Exhausted) {
                    throw new Error("This task has ended and cannot process more items");
                }
                immediate = false;
                this._task.resume();
                if (immediate) {
                    if (immediate !== true) {
                        throw immediate;
                    }
                    return;
                }
                delayDeferred = defer();
                return delayDeferred.promise;
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
                if (taskDeferred) {
                    immediate = new Error("Expected taskDeferred not to be set (internal error).");
                    return;
                }
                taskDeferred = defer();
                if (delayDeferred) {
                    const localDelayDefered: DeferredPromise<void> = delayDeferred;
                    delayDeferred = undefined;
                    localDelayDefered.resolve();
                } else {
                    immediate = true;
                }
                return taskDeferred.promise;
            },
            paused: true,
        });
    }

    public get activePromiseCount(): number {
        return this._task.activePromiseCount;
    }

    public get concurrencyLimit(): number {
        return this._task.concurrencyLimit;
    }

    public set concurrencyLimit(val: number) {
        this._task.concurrencyLimit = val;
    }

    public get frequencyLimit(): number {
        return this._task.frequencyLimit;
    }

    public set frequencyLimit(val: number) {
        this._task.frequencyLimit = val;
    }

    public get frequencyWindow(): number {
        return this._task.frequencyWindow;
    }

    public set frequencyWindow(val: number) {
        this._task.frequencyWindow = val;
    }

    public get freeSlots(): number {
        return this._task.freeSlots;
    }

    public get state(): TaskState {
        return this._task.state;
    }

    public getResult(input: I): Promise<O> {
        if (this._task.state >= TaskState.Exhausted) {
            return Promise.reject(new Error("This task has ended and cannot process more items"));
        }
        return this._batcher.getResult(input);
    }

    public send(): void {
        this._batcher.send();
    }

    public end(): void {
        this._task.end();
    }
}
