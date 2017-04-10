export interface Identifier {
    /**
     * A symbol used to identify the task. This can be later used to check the status of a task.
     */
    identifier?: Symbol;
}
export interface ConcurrencyLimit {
    /**
     * Limits the number of instances of a promise which can be run in parallel.
     */
    concurrencyLimit?: number;
}
export interface InvocationLimit {
    /**
     * Limits the number of times a promise will be invoked.
     */
    invocationLimit?: number;
}
export interface GenericTaskParameters<R> extends Identifier, ConcurrencyLimit, InvocationLimit {
    /**
     * Function used for creating promises to run.
     * This function will be run repeatedly until it returns null or the concurrency or invocation limit is reached.
     * @param invocation The invocation number for this call, starting at 0 and incrementing once for each call.
     */
    generator: (invocation?: number) => Promise<R> | null;
}
export interface SingleTaskParameters<T, R> {
    /**
     * A function used for creating promises to run.
     */
    generator: (data?: T) => Promise<R>;
    /**
     * Optional data to pass to the generator function as a parameter.
     */
    data?: T;
}
export interface BatchTaskParameters<T, R> extends Identifier, ConcurrencyLimit, InvocationLimit {
    /**
     * A function used for creating promises to run.
     *
     * @param {T[]} values - Elements from {data} batched for this invocation.
     * @param startIndex The original index for the first element in {values}.
     */
    generator: (values: T[], startIndex?: number, invocation?: number) => Promise<R> | null;
    /**
     * An array to be divided up and passed to {generator}.
     */
    data: T[];
    /**
     * The number of elements from {data} to be passed to {generator} for each batch.
     * If a function is used here, the value returned by the function determines the size of the batch.
     *
     * @param elements The number of unprocessed elements remaining in {data}.
     * @param freeSlots The number of unused promise slots available in the promise pool.
     */
    batchSize: number | ((elements: number, freeSlots: number) => number);
}
export interface EachTaskParams<T, R> extends Identifier, ConcurrencyLimit, InvocationLimit {
    /**
     * A function used for creating promises to run.
     *
     * @param value The value from {data} for this invocation.
     * @param index The original index which {value} was stored at.
     */
    generator: (value: T, index?: number) => Promise<R> | null;
    /**
     * An array of elements to be individually passed to {generator}.
     */
    data: T[];
}
export interface TaskStatus {
    /**
     * A symbol used for identifying a task.
     */
    identifier: Symbol;
    /**
     * The current number of active invocations for the task.
     */
    activeCount: number;
    /**
     * The concurrency limit for the task.
     */
    concurrencyLimit: number;
    /**
     * The number of times the task has been invoked.
     */
    invocations: number;
    /**
     * The maximum number of times the task can be invoked.
     */
    invocationLimit: number;
    /**
     * The number of times the task can be invoked before reaching the invocation limit,
     * or the local or global concurrency limit.
     */
    freeSlots: number;
}
export declare class PromisePoolExecutor {
    /**
     * The maximum number of promises which are allowed to run at one time.
     */
    private concurrencyLimit;
    /**
     * The number of promises which are active.
     */
    private activePromiseCount;
    /**
     * All tasks which are active or waiting.
     */
    private tasks;
    /**
     * A map containing all tasks which are active or waiting, indexed by their identifier symbol.
     */
    private taskMap;
    /**
     * Construct a new PromisePoolExecutor object.
     *
     * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
     */
    constructor(concurrencyLimit?: number);
    /**
     * The number of promises which can be invoked before the concurrency limit is reached.
     */
    readonly freeSlots: number;
    /**
     * Triggers promises to start.
     */
    private triggerPromises();
    /**
     * Starts a promise.
     *
     * @param task The task to start.
     */
    private startPromise(task);
    /**
     * Continues execution to the next task.
     * Resolves and removes the specified task if it is exhausted and has no active invocations.
     */
    private nextPromise(task);
    /**
     * Gets the current status of a task.
     *
     * @param taskIdentifier Symbol used to identify the task.
     */
    getTaskStatus(taskIdentifier: Symbol): TaskStatus;
    /**
     * General-purpose function for adding a task.
     *
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the values returned by the task.
     */
    addGenericTask<R>(params: GenericTaskParameters<R>): Promise<R[]>;
    /**
     * Runs a task once while obeying the concurrency limit set for the pool.
     *
     * @param params Parameters used to define the task.
     * @return A promise which resolves to the result of the task.
     */
    addSingleTask<T, R>(params: SingleTaskParameters<T, R>): Promise<R>;
    /**
     * Runs a task for batches of elements in array, specifying the batch size to use per invocation.
     *
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the results of the task. Each element in the array corresponds to one invocation.
     */
    addBatchTask<T, R>(params: BatchTaskParameters<T, R>): Promise<R[]>;
    /**
     * Runs a task for each element in an array.
     *
     * @param params
     * @return A promise which resolves to an array containing the results of the task.
     */
    addEachTask<T, R>(params: EachTaskParams<T, R>): Promise<R[]>;
}
