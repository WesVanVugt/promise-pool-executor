import { Batcher } from "promise-batcher";
import { PromisePoolGroupOptions } from "../public/group";
import { PersistentBatchTask, PersistentBatchTaskOptions } from "../public/persistent-batch";
import { PromisePoolExecutor } from "../public/pool";
import { PromisePoolTask, TaskState } from "../public/task";
import { debug, isNull, ResolvablePromise } from "./utils";

const DEBUG_PREFIX: string = "[PersistentBatchTask] ";

export class PersistentBatchTaskPrivate<I, O> implements PersistentBatchTask<I, O> {
    private _batcher: Batcher<I, O>;
    private _generator: (input: I[]) => Array<O | Error> | PromiseLike<Array<O | Error>>;
    private _task: PromisePoolTask<any>;
    private _ended: boolean = false;

    constructor(pool: PromisePoolExecutor, options: PersistentBatchTaskOptions<I, O>) {
        let immediate: boolean;
        let delayPromise: ResolvablePromise<any> | undefined;
        let taskPromise: ResolvablePromise<any> | undefined;

        this._generator = options.generator;
        this._batcher = new Batcher<I, O>({
            // TODO: Make the promises local
            batchingFunction: (inputs) => {
                if (!taskPromise) {
                    throw new Error(DEBUG_PREFIX + "Expected taskPromise to be set (internal error).");
                }
                const localTaskPromise = taskPromise;
                taskPromise = undefined;
                let promise: Promise<Array<O | Error>>;
                try {
                    const result = this._generator(inputs);
                    promise = result instanceof Promise ? result : Promise.resolve(result);
                } catch (err) {
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
                delayPromise = new ResolvablePromise<any>();
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
                taskPromise = new ResolvablePromise();
                if (delayPromise) {
                    const localDelayPromise: ResolvablePromise<any> = delayPromise;
                    delayPromise.resolve();
                    delayPromise = undefined;
                } else {
                    immediate = true;
                }
                return taskPromise.promise;
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

    public end(): void {
        this._task.end();
        this._ended = true;
    }
}
