export interface Identifier {
    /**
     * A unique value used to identify the task. This can be later used to reference the task while it runs.
     * Symbols are a good option to use since they are always unique.
     */
    id?: any;
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
     * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each call.
     */
    generator: (invocation?: number) => Promise<R> | null,
}

export interface SingleTaskParameters<T, R> extends Identifier {
    /**
     * A function used for creating promises to run.
     */
    generator: (data?: T) => Promise<R>;
    /**
     * Optional data to pass to the generator function as a parameter.
     */
    data?: T;
}

export interface LinearTaskParameters<T, R> extends Identifier, InvocationLimit {
    /**
     * A function used for creating promises to run.
     * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each call.
     */
    generator: (invocation?: number) => Promise<R>;
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

interface InternalTaskDefinition<R> {
    id: any,
    generator: (invocation?: number) => Promise<R> | null;
    activeCount: number;
    concurrencyLimit: number;
    invocations: number;
    invocationLimit: number;
    result: R[];
    exhausted?: boolean;
    errored?: boolean;
    returnReady: boolean;
    resolve?: (result: R[]) => void;
    reject?: (reason?: any) => void;
}

export interface TaskStatus {
    /**
     * A unique value used for identifying a task (such as a Symbol).
     */
    id: any,
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

/**
 * Private Method: Starts a promise. * 
 * @param task The task to start.
 */
function startPromise(task: InternalTaskDefinition<any>): void {
    let promise: Promise<any>;
    try {
        promise = task.generator(task.invocations);
    } catch (err) {
        errorTask(task, err);
        return;
    }
    if (!promise) {
        task.exhausted = true;
        // Remove the task if needed and start the next task
        nextPromise.call(this, task);
    } else {
        if (!(promise instanceof Promise)) {
            // In case what is returned is not a promise, make it one
            promise = Promise.resolve(promise);
        }

        this.activePromiseCount++;
        task.activeCount++;
        let resultIndex: number = task.invocations;
        task.invocations++;
        if (task.invocations >= task.invocationLimit) {
            task.exhausted = true;
        }

        promise.catch((err) => {
            errorTask(task, err);
            // Resolve
        }).then((result: any) => {
            this.activePromiseCount--;
            task.activeCount--;
            task.result[resultIndex] = result;
            // Remove the task if needed and start the next task
            nextPromise.call(this, task);
        });
    }
}

/**
 * Private Method: Registers an error for a task.
 */
function errorTask(task: InternalTaskDefinition<any>, err: any) {
    if (!task.errored) {
        task.errored = true;
        task.exhausted = true;
        if (task.returnReady) {
            task.reject(err);
        } else {
            // If the error is thrown immediately after task generation,
            // a delay must be added for the promise rejection to work.
            setTimeout(() => {
                task.reject(err);
            }, 1);
        }
    }
}

/**
 * Private Method: Triggers promises to start.
 */
function triggerPromises() {
    let taskIndex: number = 0;
    let task: InternalTaskDefinition<any>;
    while (this.activePromiseCount < this.concurrencyLimit && taskIndex < this.tasks.length) {
        task = this.tasks[taskIndex];
        if (!task.exhausted && task.activeCount < task.concurrencyLimit) {
            startPromise.call(this, task);
        } else {
            taskIndex++;
        }
    }
}

/**
 * Private Method: Continues execution to the next task.
 * Resolves and removes the specified task if it is exhausted and has no active invocations.
 */
function nextPromise(task: InternalTaskDefinition<any>): void {
    if (task.exhausted && task.activeCount <= 0) {
        if (!task.errored) {
            if (task.returnReady) {
                task.resolve(task.result);
            } else {
                // Although a resolution this fast should be impossible, the time restriction
                // for rejected promises likely applies to resolved ones too.
                setTimeout(() => {
                    task.resolve(task.result);
                }, 1);
            }
        }
        this.tasks.splice(this.tasks.indexOf(task), 1);
        this.taskMap.delete(task.id);
    }
    triggerPromises.call(this);
}

export class PromisePoolExecutor {
    private _concurrencyLimit: number;
    private _activePromiseCount: number = 0;
    /**
     * All tasks which are active or waiting.
     */
    private _tasks: InternalTaskDefinition<any>[] = [];
    /**
     * A map containing all tasks which are active or waiting, indexed by their ids.
     */
    private _taskMap: Map<any, InternalTaskDefinition<any>> = new Map();

    /**
     * Construct a new PromisePoolExecutor object.
     * 
     * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
     */
    constructor(concurrencyLimit?: number) {
        this._concurrencyLimit = concurrencyLimit || Infinity;

        if (typeof this._concurrencyLimit !== "number" || this._concurrencyLimit <= 0) {
            throw new Error("Invalid concurrency limit: " + this._concurrencyLimit);
        }
    }

    /**
     * The maximum number of promises which are allowed to run at one time.
     */
    public get concurrencyLimit(): number {
        return this._concurrencyLimit;
    }
    /**
     * The number of promises which are active.
     */
    public get activePromiseCount(): number {
        return this._activePromiseCount;
    }
    /**
     * The number of promises which can be invoked before the concurrency limit is reached.
     */
    public get freeSlots(): number {
        return this._concurrencyLimit - this._activePromiseCount;
    }

    /**
     * Gets the current status of a task.
     * 
     * @param id Unique value used to identify the task.
     */
    public getTaskStatus(id: any): TaskStatus {
        let task: InternalTaskDefinition<any> = this._taskMap.get(id);
        if (!task) {
            return;
        }
        return {
            id: task.id,
            activeCount: task.activeCount,
            concurrencyLimit: task.concurrencyLimit,
            invocations: task.invocations,
            invocationLimit: task.invocationLimit,
            freeSlots: Math.min(
                this.freeSlots,
                task.concurrencyLimit - task.activeCount,
                task.invocationLimit - task.invocations
            )
        };
    }

    /**
     * Stops a running task.
     * @param taskId 
     */
    public stopTask(id: any): boolean {
        let task: InternalTaskDefinition<any> = this._taskMap.get(id);
        if (!task) {
            return false;
        }
        task.exhausted = true;
        return true;
    }

    /**
     * General-purpose function for adding a task.
     * 
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the values returned by the task.
     */
    public addGenericTask<R>(params: GenericTaskParameters<R>): Promise<R[]> {
        let task: InternalTaskDefinition<R> = {
            id: params.id || Symbol(),
            generator: params.generator,
            activeCount: 0,
            invocations: 0,
            result: [],
            concurrencyLimit: params.concurrencyLimit || Infinity,
            invocationLimit: params.invocationLimit || Infinity,
            returnReady: false,
        }
        if (this._taskMap.has(task.id)) {
            return Promise.reject("The id used for this task already exists.");
        }
        if (typeof task.invocationLimit !== "number") {
            return Promise.reject("Invalid invocation limit: " + task.invocationLimit);
        }
        if (task.invocationLimit <= 0) {
            return Promise.resolve(task.result);
        }
        if (typeof task.concurrencyLimit !== "number" || task.concurrencyLimit <= 0) {
            return Promise.reject(new Error("Invalid concurrency limit: " + params.concurrencyLimit));
        }

        let promise: Promise<R[]> = new Promise<R[]>((resolve, reject) => {
            task.resolve = resolve;
            task.reject = reject;
        });

        setTimeout(() => {
            task.returnReady = true;
        }, 1);

        this._tasks.push(task);
        this._taskMap.set(task.id, task);
        triggerPromises.call(this);
        return promise;
    }

    /**
     * Runs a task once while obeying the concurrency limit set for the pool.
     * 
     * @param params Parameters used to define the task.
     * @return A promise which resolves to the result of the task.
     */
    public addSingleTask<T, R>(params: SingleTaskParameters<T, R>): Promise<R> {
        return this.addGenericTask({
            id: params.id,
            generator: () => {
                return params.generator(params.data);
            },
            invocationLimit: 1,
        }).then((result) => {
            return result[0];
        });
    }

    /**
     * Runs a task with a concurrency limit of 1.
     * 
     * @param params 
     * @return A promise which resolves to an array containing the results of the task.
     */
    public addLinearTask<T, R>(params: LinearTaskParameters<T, R>): Promise<R[]> {
        return this.addGenericTask({
            generator: params.generator,
            id: params.id,
            invocationLimit: params.invocationLimit,
            concurrencyLimit: 1,
        });
    }

    /**
     * Runs a task for batches of elements in array, specifying the batch size to use per invocation.
     * 
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the results of the task. Each element in the array corresponds to one invocation.
     */
    public addBatchTask<T, R>(params: BatchTaskParameters<T, R>): Promise<R[]> {
        let index: number = 0;

        // Unacceptable values: NaN, <=0, type not number/function
        if (!params.batchSize || typeof params.batchSize !== "function"
            && (typeof params.batchSize !== "number" || params.batchSize <= 0)) {

            return Promise.reject(new Error("Invalid batch size: " + params.batchSize));
        }

        let id: any = params.id || Symbol();

        let promise: Promise<R[]> = this.addGenericTask({
            generator: (invocation) => {
                if (index >= params.data.length) {
                    return null;
                }
                let oldIndex: number = index;
                if (typeof params.batchSize === "function") {
                    let status: TaskStatus = this.getTaskStatus(id);
                    let batchSize: number = params.batchSize(
                        params.data.length - oldIndex,
                        status.freeSlots
                    );
                    // Unacceptable values: NaN, <=0, type not number
                    if (!batchSize || typeof batchSize !== "number" || batchSize <= 0) {
                        return Promise.reject(new Error("Invalid batch size: " + batchSize));
                    }
                    index += batchSize;
                } else {
                    index += params.batchSize;
                }

                return params.generator(params.data.slice(oldIndex, index), oldIndex, invocation);
            },
            id: id,
            concurrencyLimit: params.concurrencyLimit,
            invocationLimit: params.invocationLimit,
        });

        return promise;
    }

    /**
     * Runs a task for each element in an array.
     * 
     * @param params 
     * @return A promise which resolves to an array containing the results of the task.
     */
    public addEachTask<T, R>(params: EachTaskParams<T, R>): Promise<R[]> {
        return this.addGenericTask({
            generator: (index) => {
                if (index >= params.data.length) {
                    return null;
                }
                let oldIndex: number = index;
                index++;
                return params.generator(params.data[oldIndex], oldIndex);
            },
            id: params.id,
            concurrencyLimit: params.concurrencyLimit,
            invocationLimit: params.invocationLimit,
        });
    }
}
