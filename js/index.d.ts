export interface TaskGeneral {
    /**
     * A unique value used to identify the task. This can be later used to reference the task while it runs.
     * Symbols are a good option to use since they are always unique.
     */
    id?: any;
    /**
     * An array of values, each of which identifies a group the task belongs to. These groups can be used to respond
     * to the completion of a larger task.
     */
    groupIds?: any[];
    /**
     * If this is set to true, no promise will be returned.
     */
    noPromise?: boolean;
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
export interface GenericTaskParams<R> extends TaskGeneral, ConcurrencyLimit, InvocationLimit {
    /**
     * Function used for creating promises to run.
     * This function will be run repeatedly until it returns null or the concurrency or invocation limit is reached.
     * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each call.
     */
    generator: (invocation?: number) => Promise<R> | null;
}
export interface SingleTaskParams<T, R> extends TaskGeneral {
    /**
     * A function used for creating promises to run.
     */
    generator: (data?: T) => Promise<R>;
    /**
     * Optional data to pass to the generator function as a parameter.
    */
    data?: T;
}
export interface LinearTaskParams<T, R> extends TaskGeneral, InvocationLimit {
    /**
     * A function used for creating promises to run.
     * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each call.
     */
    generator: (invocation?: number) => Promise<R>;
}
export interface BatchTaskParams<T, R> extends TaskGeneral, ConcurrencyLimit, InvocationLimit {
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
export interface EachTaskParams<T, R> extends TaskGeneral, ConcurrencyLimit, InvocationLimit {
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
     * A unique value used for identifying a task (such as a Symbol).
     */
    id: any;
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
     * or the pool or task concurrency limit.
     */
    freeSlots: number;
}
export declare class PromisePoolExecutor {
    private _concurrencyLimit;
    private _activePromiseCount;
    /**
     * All tasks which are active or waiting.
     */
    private _tasks;
    /**
     * A map containing all tasks which are active or waiting, indexed by their ids.
     */
    private _taskMap;
    private _groupMap;
    /**
     * Construct a new PromisePoolExecutor object.
     *
     * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
     */
    constructor(concurrencyLimit?: number);
    /**
     * The maximum number of promises which are allowed to run at one time.
     */
    concurrencyLimit: number;
    /**
     * The number of promises which are active.
     */
    readonly activePromiseCount: number;
    /**
     * The number of promises which can be invoked before the concurrency limit is reached.
     */
    readonly freeSlots: number;
    /**
     * Returns true if the pool is idling (no active or queued promises).
     */
    readonly idling: boolean;
    /**
     * Private Method: Starts a promise. *
     * @param task The task to start.
     */
    private _startPromise(task);
    /**
     * Private Method: Registers an error for a task.
     */
    private _errorTask(task, err);
    private _errorGroups(err, groupsIds);
    private _errorGroup(err, groupId);
    /**
     * Private Method: Triggers promises to start.
     */
    private _triggerPromises();
    /**
     * Private Method: Continues execution to the next task.
     * Resolves and removes the specified task if it is exhausted and has no active invocations.
     */
    private _nextPromise(task);
    /**
     * Instantly resolves a promise, while respecting the parameters passed.
     */
    private _instantResolve<T>(params, data);
    /**
     * Instantly rejects a promise with the specified error, while respecting the parameters passed.
     */
    private _instantReject(params, err);
    /**
     * Gets the current status of a task.
     * @param id Unique value used to identify the task.
     */
    getTaskStatus(id: any): TaskStatus;
    /**
     * Stops a running task.
     * @param taskId
     */
    stopTask(id: any): boolean;
    /**
     * General-purpose function for adding a task.
     *
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the values returned by the task.
     */
    addGenericTask<R>(params: GenericTaskParams<R>): Promise<R[]>;
    /**
     * Runs a task once while obeying the concurrency limit set for the pool.
     *
     * @param params Parameters used to define the task.
     * @return A promise which resolves to the result of the task.
     */
    addSingleTask<T, R>(params: SingleTaskParams<T, R>): Promise<R>;
    /**
     * Runs a task with a concurrency limit of 1.
     *
     * @param params
     * @return A promise which resolves to an array containing the results of the task.
     */
    addLinearTask<T, R>(params: LinearTaskParams<T, R>): Promise<R[]>;
    /**
     * Runs a task for batches of elements in array, specifying the batch size to use per invocation.
     *
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the results of the task. Each element in the array corresponds to one invocation.
     */
    addBatchTask<T, R>(params: BatchTaskParams<T, R>): Promise<R[]>;
    /**
     * Runs a task for each element in an array.
     *
     * @param params
     * @return A promise which resolves to an array containing the results of the task.
     */
    addEachTask<T, R>(params: EachTaskParams<T, R>): Promise<R[]>;
    /**
     * Returns a promise which resolves when there are no more tasks queued to run.
     */
    waitForIdle(): Promise<void>;
    /**
     * Returns a promise which resolves when there are no more tasks in a group queued to run.
     */
    waitForGroupIdle(id: any): Promise<void>;
}
