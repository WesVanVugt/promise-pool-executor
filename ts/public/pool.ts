import { PromisePoolGroupPrivate } from "../private/group";
import { PersistentBatchTaskPrivate } from "../private/persistent-batch";
import { PromisePoolTaskPrivate } from "../private/task";
import { debug, isNull } from "../private/utils";
import {
    FrequencyLimit,
    PromisePoolGroup,
    PromisePoolGroupOptions,
} from "./group";
import {
    PersistentBatchTask,
    PersistentBatchTaskOptions,
} from "./persistent-batch";
import {
    GenericTaskConvertedOptions,
    GenericTaskOptions,
    InvocationLimit,
    PromisePoolTask,
    TaskOptionsBase,
    TaskState,
} from "./task";

export interface SingleTaskOptions<T, R> extends TaskOptionsBase {
    /**
     * A function used for creating promises to run.
     */
    generator: (this: PromisePoolTask<any>, data: T) => Promise<R>;
    /**
     * Optional data to pass to the generator function as a parameter.
     */
    data?: T;
}

export interface LinearTaskOptions<T, R> extends TaskOptionsBase, Partial<FrequencyLimit>, Partial<InvocationLimit> {
    /**
     * A function used for creating promises to run.
     * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each call.
     */
    generator: (this: PromisePoolTask<any[]>, invocation: number) => Promise<R>;
}

export interface BatchTaskOptions<T, R> extends TaskOptionsBase, PromisePoolGroupOptions, Partial<InvocationLimit> {
    /**
     * A function used for creating promises to run.
     * @param {T[]} values - Elements from {data} batched for this invocation.
     * @param startIndex The original index for the first element in {values}.
     */
    generator: (
        this: PromisePoolTask<any[]>, values: T[], startIndex: number, invocation: number,
    ) => Promise<R> | undefined | void;
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

export interface EachTaskOptions<T, R> extends TaskOptionsBase, PromisePoolGroupOptions, Partial<InvocationLimit> {
    /**
     * A function used for creating promises to run.
     * @param value The value from {data} for this invocation.
     * @param index The original index which {value} was stored at.
     */
    generator: (this: PromisePoolTask<any[]>, value: T, index: number) => Promise<R> | undefined | void;
    /**
     * An array of elements to be individually passed to {generator}.
     */
    data: T[];
}

const DEBUG_PREFIX: string = "[Pool] ";

export class PromisePoolExecutor implements PromisePoolGroup {
    private _nextTriggerTime?: number;
    private _nextTriggerTimeout?: any;
    /**
     * All tasks which are active or waiting.
     */
    private _tasks: Array<PromisePoolTaskPrivate<any>> = [];
    private _globalGroup: PromisePoolGroupPrivate;
    /**
     * Currently in the process of triggering promises. Used to prevent recursion on generator functions.
     */
    private _triggering: boolean;
    /**
     * Gets set when trying to trigger the tasks while they are already being triggerd.
     */
    private _triggerAgain: boolean;

    /**
     * Construct a new PromisePoolExecutor object.
     * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
     */
    constructor(options?: PromisePoolGroupOptions | number) {
        let groupOptions: PromisePoolGroupOptions;

        if (!isNull(options)) {
            if (typeof options === "object") {
                groupOptions = options;
            } else {
                groupOptions = {
                    concurrencyLimit: options,
                };
            }
        } else {
            groupOptions = {};
        }

        this._globalGroup = this.addGroup(groupOptions) as PromisePoolGroupPrivate;
    }

    /**
     * The maximum number of promises which are allowed to run at one time.
     */
    public get concurrencyLimit(): number {
        return this._globalGroup.concurrencyLimit;
    }

    public set concurrencyLimit(val: number) {
        this._globalGroup.concurrencyLimit = val;
    }

    public get frequencyLimit(): number {
        return this._globalGroup.frequencyLimit;
    }

    public set frequencyLimit(val: number) {
        this._globalGroup.frequencyLimit = val;
    }

    public get frequencyWindow(): number {
        return this._globalGroup.frequencyWindow;
    }

    public set frequencyWindow(val: number) {
        this._globalGroup.frequencyWindow = val;
    }

    public get activeTaskCount(): number {
        return this._globalGroup.activeTaskCount;
    }

    public get activePromiseCount(): number {
        return this._globalGroup.activePromiseCount;
    }

    public get freeSlots(): number {
        return this._globalGroup._concurrencyLimit - this._globalGroup._activePromiseCount;
    }
    /**
     * Returns true if the pool is idling (no active or queued promises).
     */
    public get idling(): boolean {
        return this._globalGroup._activeTaskCount === 0 && this._tasks.length === 0;
    }

    public addGroup(options?: PromisePoolGroupOptions): PromisePoolGroup {
        return new PromisePoolGroupPrivate(
            this,
            () => this._triggerNextTick(),
            options,
        );
    }

    /**
     * General-purpose function for adding a task.
     * @param options Options used to define the task.
     * @return A promise which resolves to an array containing the values returned by the task.
     */
    public addGenericTask<I, R>(options: GenericTaskConvertedOptions<I, R>): PromisePoolTask<R>;
    public addGenericTask<R>(options: GenericTaskOptions<R>): PromisePoolTask<R[]>;
    public addGenericTask<R>(
        options: GenericTaskOptions<R> | GenericTaskConvertedOptions<any, R>,
    ): PromisePoolTask<R[]> {
        const task: PromisePoolTaskPrivate<R> = new PromisePoolTaskPrivate(
            {
                detach: () => {
                    this._removeTask(task);
                },
                globalGroup: this._globalGroup,
                pool: this,
                triggerNextCallback: () => this._triggerNextTick(),
                triggerNowCallback: () => this._triggerNow(),
            },
            options,
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
     * @param options Options used to define the task.
     * @return A promise which resolves to the result of the task.
     */
    public addSingleTask<T, R>(options: SingleTaskOptions<T, R>): PromisePoolTask<R> {
        const data: T | undefined = options.data;
        return this.addGenericTask<R, R>({
            generator() {
                return options.generator.call(this, data);
            },
            groups: options.groups,
            invocationLimit: 1,
            paused: options.paused,
            resultConverter: (result) => result[0],
        });
    }

    /**
     * Runs a task with a concurrency limit of 1.
     * @return A promise which resolves to an array containing the results of the task.
     */
    public addLinearTask<T, R>(options: LinearTaskOptions<T, R>): PromisePoolTask<R[]> {
        return this.addGenericTask({
            concurrencyLimit: 1,
            frequencyLimit: options.frequencyLimit,
            frequencyWindow: options.frequencyWindow,
            generator: options.generator,
            groups: options.groups,
            invocationLimit: options.invocationLimit,
            paused: options.paused,
        });
    }

    /**
     * Runs a task for batches of elements in array, specifying the batch size to use per invocation.
     * @param options Parameters used to define the task.
     * @return A promise which resolves to an array containing the results of the task. Each element in the array
     * corresponds to one invocation.
     */
    public addBatchTask<T, R>(options: BatchTaskOptions<T, R>): PromisePoolTask<R[]> {
        let index: number = 0;

        // Unacceptable values: NaN, <=0, type not number/function
        if (!options.batchSize || typeof options.batchSize !== "function"
            && (typeof options.batchSize !== "number" || options.batchSize <= 0)) {

            throw new Error("Invalid batch size: " + options.batchSize);
        }

        return this.addGenericTask({
            concurrencyLimit: options.concurrencyLimit,
            frequencyLimit: options.frequencyLimit,
            frequencyWindow: options.frequencyWindow,
            generator(invocation) {
                if (index >= options.data.length) {
                    return;
                }
                const oldIndex: number = index;
                if (typeof options.batchSize === "function") {
                    const batchSize: number = options.batchSize(
                        options.data.length - oldIndex,
                        this.freeSlots,
                    );
                    // Unacceptable values: NaN, <=0, type not number
                    if (!batchSize || typeof batchSize !== "number" || batchSize <= 0) {
                        return Promise.reject(new Error("Invalid batch size: " + batchSize));
                    }
                    index += batchSize;
                } else {
                    index += options.batchSize;
                }

                return options.generator.call(this, options.data.slice(oldIndex, index), oldIndex, invocation);
            },
            groups: options.groups,
            invocationLimit: options.invocationLimit,
            paused: options.paused,
        });
    }

    /**
     * Runs a task for each element in an array.
     * @param options
     * @return A promise which resolves to an array containing the results of the task.
     */
    public addEachTask<T, R>(options: EachTaskOptions<T, R>): PromisePoolTask<R[]> {
        return this.addGenericTask({
            concurrencyLimit: options.concurrencyLimit,
            frequencyLimit: options.frequencyLimit,
            frequencyWindow: options.frequencyWindow,
            groups: options.groups,
            invocationLimit: options.invocationLimit,
            paused: options.paused,
            generator(index) {
                if (index >= options.data.length) {
                    return;
                }
                const oldIndex: number = index;
                index++;
                return options.generator.call(this, options.data[oldIndex], oldIndex);
            },
        });
    }

    public addPersistentBatchTask<I, O>(options: PersistentBatchTaskOptions<I, O>): PersistentBatchTask<I, O> {
        return new PersistentBatchTaskPrivate(this, options);
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
            this._nextTriggerTimeout = undefined;
        }
        this._nextTriggerTime = undefined;
    }

    private _triggerNextTick(): void {
        if (this._nextTriggerTime === -1) {
            return;
        }
        this._clearTriggerTimeout();
        this._nextTriggerTime = -1;
        process.nextTick(() => {
            if (this._nextTriggerTime === -1) {
                this._nextTriggerTime = undefined;
                this._triggerNow();
            }
        });
    }

    /**
     * Private Method: Triggers promises to start.
     */
    private _triggerNow(): void {
        if (this._triggering) {
            debug(`${DEBUG_PREFIX}Setting triggerAgain flag.`);
            this._triggerAgain = true;
            return;
        }

        this._triggering = true;
        this._triggerAgain = false;
        debug(`${DEBUG_PREFIX}Trigger promises`);
        this._cleanFrequencyStarts();

        this._clearTriggerTimeout();

        let taskIndex: number = 0;
        let task: PromisePoolTaskPrivate<any[]>;
        let soonest: number = Infinity;
        let busyTime: boolean | number;

        while (taskIndex < this._tasks.length) {
            task = this._tasks[taskIndex];
            busyTime = task._busyTime();
            debug(`${DEBUG_PREFIX}BusyTime: ${busyTime}`);

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
        this._triggering = false;
        if (this._triggerAgain) {
            return this._triggerNow();
        }

        let time: number;
        if (soonest !== Infinity) {
            time = Date.now();
            if (time >= soonest) {
                return this._triggerNow();
            }

            this._nextTriggerTime = soonest;
            this._nextTriggerTimeout = setTimeout(() => {
                this._nextTriggerTimeout = undefined;
                this._nextTriggerTime = 0;
                this._triggerNow();
            }, soonest - time);
        }
    }

    private _removeTask(task: PromisePoolTaskPrivate<any>) {
        const i: number = this._tasks.indexOf(task);
        if (i !== -1) {
            debug(`${DEBUG_PREFIX}Task removed`);
            this._tasks.splice(i, 1);
        }
    }
}
