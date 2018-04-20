import { FrequencyLimit, PromisePoolGroup, PromisePoolGroupOptions } from "./group";
import { PersistentBatchTask, PersistentBatchTaskOptions } from "./persistent-batch";
import { GenericTaskConvertedOptions, GenericTaskOptions, InvocationLimit, PromisePoolTask, TaskOptionsBase } from "./task";
export interface SingleTaskOptions<T, R> extends TaskOptionsBase {
    /**
     * Optional data to pass to the generator function as a parameter.
     */
    data?: T;
    /**
     * A function used for creating promises to run.
     */
    generator(this: PromisePoolTask<any>, data: T): R | PromiseLike<R> | undefined | null | void;
}
export interface LinearTaskOptions<R> extends TaskOptionsBase, Partial<FrequencyLimit>, Partial<InvocationLimit> {
    /**
     * A function used for creating promises to run.
     * If the function returns undefined, the task will be flagged as completed unless it is in a paused state.
     * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each
     * promise returned.
     */
    generator: (this: PromisePoolTask<any[]>, invocation: number) => R | PromiseLike<R> | undefined | null | void;
}
export interface BatchTaskOptions<T, R> extends TaskOptionsBase, PromisePoolGroupOptions, Partial<InvocationLimit> {
    /**
     * A function used for creating promises to run.
     * If the function returns undefined, the task will be flagged as completed unless it is in a paused state.
     * @param {T[]} values - Elements from {data} batched for this invocation.
     * @param startIndex The original index for the first element in {values}.
     */
    generator: (this: PromisePoolTask<any[]>, values: T[], startIndex: number, invocation: number) => R | PromiseLike<R> | undefined | null | void;
    /**
     * An array containing data to be divided into batches and passed to {generator}.
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
export interface EachTaskOptions<T, R> extends TaskOptionsBase, PromisePoolGroupOptions {
    /**
     * An array of elements to be individually passed to {generator}.
     */
    data: T[];
    /**
     * A function used for creating promises to run.
     * If the function returns undefined, the task will be flagged as completed unless it is in a paused state.
     * @param value The value from {data} for this invocation.
     * @param index The original index which {value} was stored at.
     */
    generator(this: PromisePoolTask<any[]>, value: T, index: number): R | PromiseLike<R> | undefined | null | void;
}
export declare class PromisePoolExecutor implements PromisePoolGroup {
    private _nextTriggerTime?;
    private _nextTriggerTimeout?;
    /**
     * All tasks which are active or waiting.
     */
    private _tasks;
    private _globalGroup;
    /**
     * Currently in the process of triggering promises. Used to prevent recursion on generator functions.
     */
    private _triggering?;
    /**
     * Gets set when trying to trigger the tasks while they are already being triggerd.
     */
    private _triggerAgain?;
    /**
     * Construct a new PromisePoolExecutor object.
     * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
     */
    constructor(options?: PromisePoolGroupOptions | number);
    /**
     * The maximum number of promises allowed to be active simultaneously in the pool.
     */
    concurrencyLimit: number;
    /**
     * The maximum number promises allowed to be generated within the time window specified by {frequencyWindow}.
     */
    frequencyLimit: number;
    /**
     * The time window in milliseconds to use for {frequencyLimit}.
     */
    frequencyWindow: number;
    /**
     * The number of tasks active in the pool.
     */
    readonly activeTaskCount: number;
    /**
     * The number of promises active in the pool.
     */
    readonly activePromiseCount: number;
    /**
     * The number of promises which can be created before reaching the pool's configured limits.
     */
    readonly freeSlots: number;
    /**
     * Adds a group to the pool.
     */
    addGroup(options?: PromisePoolGroupOptions): PromisePoolGroup;
    /**
     * Adds a general-purpose task to the pool. The resulting task can be resolved to an array containing the results
     * of the task, or a modified result using the resultConverter option.
     */
    addGenericTask<I, R>(options: GenericTaskConvertedOptions<I, R>): PromisePoolTask<R>;
    /**
     * Adds a general-purpose task to the pool. The resulting task can be resolved to an array containing the results
     * of the task, or a modified result using the resultConverter option.
     */
    addGenericTask<R>(options: GenericTaskOptions<R>): PromisePoolTask<R[]>;
    /**
     * Adds a task with a single promise. The resulting task can be resolved to the result of this promise.
     */
    addSingleTask<T, R>(options: SingleTaskOptions<T, R>): PromisePoolTask<R>;
    /**
     * Adds a task with a concurrency limit of 1. The resulting task can be resolved to an array containing the
     * results of the task.
     */
    addLinearTask<R>(options: LinearTaskOptions<R>): PromisePoolTask<R[]>;
    /**
     * Adds a task which generates a promise for batches of elements from an array. The resulting task can be
     * resolved to an array containing the results of the task.
     */
    addBatchTask<T, R>(options: BatchTaskOptions<T, R>): PromisePoolTask<R[]>;
    /**
     * Adds a task which generates a promise for each element in an array. The resulting task can be resolved to
     * an array containing the results of the task.
     */
    addEachTask<T, R>(options: EachTaskOptions<T, R>): PromisePoolTask<R[]>;
    /**
     * Adds a task which can be used to combine multiple requests into batches to improve efficiency.
     */
    addPersistentBatchTask<I, O>(options: PersistentBatchTaskOptions<I, O>): PersistentBatchTask<I, O>;
    /**
     * Returns a promise which resolves when there are no more tasks queued to run.
     */
    waitForIdle(): Promise<void>;
    private _cleanFrequencyStarts();
    private _clearTriggerTimeout();
    private _triggerNextTick();
    /**
     * Private Method: Triggers promises to start.
     */
    private _triggerNow();
    private _removeTask(task);
}
