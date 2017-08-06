import { PromisePoolGroupInternal } from "../private/group";
import { PersistentBatchTaskInternal } from "../private/persistent-batch";
import { PromisePoolTaskInternal } from "../private/task";
import { debug, isNull } from "../private/utils";
import { PromisePoolGroup, PromisePoolGroupConfig } from "./group";
import {
    PersistentBatcherTask,
    PersistentBatcherTaskParams,
} from "./persistent-batch";
import {
    GenericTaskParams,
    GenericTaskParamsConverted,
    InvocationLimit,
    PromisePoolTask,
    TaskGeneral,
    TaskState,
} from "./task";

export interface SingleTaskParams<T, R> extends TaskGeneral {
    /**
     * A function used for creating promises to run.
     */
    generator: (this: PromisePoolTask<any>, data: T) => Promise<R>;
    /**
     * Optional data to pass to the generator function as a parameter.
     */
    data?: T;
}

export interface LinearTaskParams<T, R> extends TaskGeneral, PromisePoolGroupConfig, InvocationLimit {
    /**
     * A function used for creating promises to run.
     * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each call.
     */
    generator: (this: PromisePoolTask<any[]>, invocation: number) => Promise<R>;
}

export interface BatchTaskParams<T, R> extends TaskGeneral, PromisePoolGroupConfig, InvocationLimit {
    /**
     * A function used for creating promises to run.
     * @param {T[]} values - Elements from {data} batched for this invocation.
     * @param startIndex The original index for the first element in {values}.
     */
    generator: (this: PromisePoolTask<any[]>, values: T[], startIndex: number, invocation: number) => Promise<R> | null;
    /**
     * An array to be divided up and passed to {generator}.
     */
    data: T[];
    /**
     * The number of elements from {data} to be passed to {generator} for each batch.
     * If a function is used here, the value returned by the function determines the size of the batch.
     * @param elements The number of unprocessed elements remaining in {data}.
     * @param freeSlots The number of unused promise slots available in the promise pool.
     */
    batchSize: number | ((elements: number, freeSlots: number) => number);
}

export interface EachTaskParams<T, R> extends TaskGeneral, PromisePoolGroupConfig, InvocationLimit {
    /**
     * A function used for creating promises to run.
     * @param value The value from {data} for this invocation.
     * @param index The original index which {value} was stored at.
     */
    generator: (this: PromisePoolTask<any[]>, value: T, index: number) => Promise<R> | null;
    /**
     * An array of elements to be individually passed to {generator}.
     */
    data: T[];
}

export class PromisePoolExecutor {
    private _nextTriggerTime: number;
    private _nextTriggerTimeout: any;
    /**
     * All tasks which are active or waiting.
     */
    private _tasks: Array<PromisePoolTaskInternal<any>> = [];
    private _globalGroup: PromisePoolGroupInternal;
    private _groupSet: Set<PromisePoolGroupInternal> = new Set();

    /**
     * Construct a new PromisePoolExecutor object.
     * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
     */
    constructor(params?: PromisePoolGroupConfig | number) {
        let groupParams: PromisePoolGroupConfig;

        if (!isNull(params)) {
            if (typeof params === "object") {
                groupParams = params;
            } else {
                groupParams = {
                    concurrencyLimit: params,
                };
            }
        }

        this._globalGroup = this.addGroup(groupParams) as PromisePoolGroupInternal;
        this._groupSet.add(this._globalGroup);
    }

    /**
     * The maximum number of promises which are allowed to run at one time.
     */
    public get concurrencyLimit(): number {
        return this._globalGroup._concurrencyLimit;
    }

    public set concurrencyLimit(val: number) {
        this._globalGroup._concurrencyLimit = val;
    }

    /**
     * The number of promises which are active.
     */
    public get activePromiseCount(): number {
        return this._globalGroup._activeTaskCount;
    }
    /**
     * The number of promises which can be invoked before the concurrency limit is reached.
     */
    public get freeSlots(): number {
        return this._globalGroup._concurrencyLimit - this._globalGroup._activePromiseCount;
    }
    /**
     * Returns true if the pool is idling (no active or queued promises).
     */
    public get idling(): boolean {
        return this._globalGroup._activeTaskCount === 0 && this._tasks.length === 0;
    }

    public addGroup(params: PromisePoolGroupConfig): PromisePoolGroup {
        return new PromisePoolGroupInternal(
            this,
            () => this._triggerNextTick(),
            params,
        );
    }

    /**
     * General-purpose function for adding a task.
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the values returned by the task.
     */
    public addGenericTask<I, R>(params: GenericTaskParamsConverted<I, R>): PromisePoolTask<R>;
    public addGenericTask<R>(params: GenericTaskParams<R>): PromisePoolTask<R[]>;
    public addGenericTask<R>(params: GenericTaskParams<R> | GenericTaskParamsConverted<any, R>): PromisePoolTask<R[]> {
        const task: PromisePoolTaskInternal<R> = new PromisePoolTaskInternal(
            {
                detach: () => {
                    this._removeTask(task);
                },
                globalGroup: this._globalGroup,
                pool: this,
                triggerNextCallback: () => this._triggerNextTick(),
                triggerNowCallback: () => this._triggerNow(),
            },
            params,
        );
        if (task.state <= TaskState.Paused) {
            // Attach the task
            this._tasks.push(task);
        }
        this._triggerNow();
        return task;
    }

    /**
     * Runs a task once while obeying the concurrency limit set for the pool.
     * @param params Parameters used to define the task.
     * @return A promise which resolves to the result of the task.
     */
    public addSingleTask<T, R>(params: SingleTaskParams<T, R>): PromisePoolTask<R> {
        const data: T = params.data;
        return this.addGenericTask<R, R>({
            generator() {
                return params.generator.call(this, data);
            },
            groups: params.groups,
            invocationLimit: 1,
            paused: params.paused,
            resultConverter: (result) => result[0],
        });
    }

    /**
     * Runs a task with a concurrency limit of 1.
     * @return A promise which resolves to an array containing the results of the task.
     */
    public addLinearTask<T, R>(params: LinearTaskParams<T, R>): PromisePoolTask<R[]> {
        return this.addGenericTask({
            concurrencyLimit: 1,
            frequencyLimit: params.frequencyLimit,
            frequencyWindow: params.frequencyWindow,
            generator: params.generator,
            groups: params.groups,
            invocationLimit: params.invocationLimit,
            paused: params.paused,
        });
    }

    /**
     * Runs a task for batches of elements in array, specifying the batch size to use per invocation.
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the results of the task. Each element in the array
     * corresponds to one invocation.
     */
    public addBatchTask<T, R>(params: BatchTaskParams<T, R>): PromisePoolTask<R[]> {
        let index: number = 0;

        // Unacceptable values: NaN, <=0, type not number/function
        if (!params.batchSize || typeof params.batchSize !== "function"
            && (typeof params.batchSize !== "number" || params.batchSize <= 0)) {

            throw new Error("Invalid batch size: " + params.batchSize);
        }

        return this.addGenericTask({
            concurrencyLimit: params.concurrencyLimit,
            frequencyLimit: params.frequencyLimit,
            frequencyWindow: params.frequencyWindow,
            generator(invocation) {
                if (index >= params.data.length) {
                    return null;
                }
                const oldIndex: number = index;
                if (typeof params.batchSize === "function") {
                    const batchSize: number = params.batchSize(
                        params.data.length - oldIndex,
                        this.freeSlots,
                    );
                    // Unacceptable values: NaN, <=0, type not number
                    if (!batchSize || typeof batchSize !== "number" || batchSize <= 0) {
                        return Promise.reject(new Error("Invalid batch size: " + batchSize));
                    }
                    index += batchSize;
                } else {
                    index += params.batchSize;
                }

                return params.generator.call(this, params.data.slice(oldIndex, index), oldIndex, invocation);
            },
            groups: params.groups,
            invocationLimit: params.invocationLimit,
            paused: params.paused,
        });
    }

    /**
     * Runs a task for each element in an array.
     * @param params
     * @return A promise which resolves to an array containing the results of the task.
     */
    public addEachTask<T, R>(params: EachTaskParams<T, R>): PromisePoolTask<R[]> {
        return this.addGenericTask({
            concurrencyLimit: params.concurrencyLimit,
            frequencyLimit: params.frequencyLimit,
            frequencyWindow: params.frequencyWindow,
            groups: params.groups,
            invocationLimit: params.invocationLimit,
            paused: params.paused,
            generator(index) {
                if (index >= params.data.length) {
                    return null;
                }
                const oldIndex: number = index;
                index++;
                return params.generator.call(this, params.data[oldIndex], oldIndex);
            },
        });
    }

    public addPersistentBatchTask<I, O>(params: PersistentBatcherTaskParams<I, O>): PersistentBatcherTask<I, O> {
        return new PersistentBatchTaskInternal(this, params);
    }

    /**
     * Returns a promise which resolves when there are no more tasks queued to run.
     */
    public waitForIdle(): Promise<void> {
        return this._globalGroup.waitForIdle();
    }

    private _cleanFrequencyStarts(): void {
        // Remove the frequencyStarts entries which are outside of the window
        const now = Date.now();
        this._globalGroup._cleanFrequencyStarts(now);
        this._tasks.forEach((task) => {
            task._cleanFrequencyStarts(now);
        });
    }

    private _clearTriggerTimeout(): void {
        if (this._nextTriggerTimeout) {
            clearTimeout(this._nextTriggerTimeout);
            this._nextTriggerTimeout = null;
        }
        this._nextTriggerTime = null;
    }

    private _triggerNextTick(): void {
        if (this._nextTriggerTime === -1) {
            return;
        }
        this._clearTriggerTimeout();
        this._nextTriggerTime = -1;
        process.nextTick(() => {
            if (this._nextTriggerTime === -1) {
                this._nextTriggerTime = null;
                this._triggerNow();
            }
        });
    }

    /**
     * Private Method: Triggers promises to start.
     */
    private _triggerNow(): void {
        debug("Trigger promises");
        this._cleanFrequencyStarts();

        this._clearTriggerTimeout();

        let taskIndex: number = 0;
        let task: PromisePoolTaskInternal<any[]>;
        let soonest: number = Infinity;
        let busyTime: boolean | number;

        while (taskIndex < this._tasks.length) {
            task = this._tasks[taskIndex];
            busyTime = task._busyTime();
            debug(`BusyTime: ${busyTime}`);

            if (busyTime === true) {
                taskIndex++;
            } else if (busyTime) {
                if (busyTime < soonest) {
                    soonest = busyTime;
                }
                taskIndex++;
            } else {
                task._run();
            }
        }

        let time: number;
        if (soonest !== Infinity) {
            time = Date.now();
            if (time >= soonest) {
                return this._triggerNow();
            }

            this._nextTriggerTime = soonest;
            this._nextTriggerTimeout = setTimeout(() => {
                this._nextTriggerTimeout = null;
                this._nextTriggerTime = 0;
                this._triggerNow();
            }, soonest - time);
        }
    }

    private _removeTask(task: PromisePoolTaskInternal<any>) {
        const i: number = this._tasks.indexOf(task);
        if (i !== -1) {
            debug("Task removed");
            this._tasks.splice(i, 1);
        }
    }
}
