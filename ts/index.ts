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
     */
    generator: () => Promise<R> | null,
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
    generator: (values: T[], startIndex?: number) => Promise<R> | null;
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
    identifier: Symbol,
    generator: () => Promise<R> | null;
    activeCount: number;
    concurrencyLimit: number;
    invocations: number;
    invocationLimit: number;
    result: R[];
    exhausted?: boolean;
    errored?: boolean;
    resolve?: (result: R[]) => void;
    reject?: (reason?: any) => void;
}

export interface TaskStatus {
    /**
     * A symbol used for identifying a task.
     */
    identifier: Symbol,
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
}

export class PromisePoolExecutor {
    /**
     * The maximum number of promises which are allowed to run at one time.
     */
    private concurrencyLimit: number;
    /**
     * The number of promises which are active.
     */
    private activePromiseCount: number = 0;
    /**
     * All tasks which are active or waiting.
     */
    private tasks: InternalTaskDefinition<any>[] = [];
    /**
     * A map containing all tasks which are active or waiting, indexed by their identifier symbol.
     */
    private taskMap: Map<Symbol, InternalTaskDefinition<any>> = new Map();

    /**
     * Construct a new PromisePoolExecutor object.
     * 
     * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
     */
    constructor(concurrencyLimit?: number) {
        this.concurrencyLimit = concurrencyLimit || Infinity;

        if (typeof this.concurrencyLimit !== "number" || this.concurrencyLimit <= 0) {
            throw new Error("Invalid concurrency limit: " + this.concurrencyLimit);
        }
    }

    /**
     * The number of promises which can be invoked before the concurrency limit is reached.
     */
    get freeSlots(): number {
        return this.concurrencyLimit - this.activePromiseCount;
    }

    /**
     * Triggers promises to start.
     */
    private triggerPromises() {
        let taskIndex: number = 0;
        let task: InternalTaskDefinition<any>;
        while (this.activePromiseCount < this.concurrencyLimit && taskIndex < this.tasks.length) {
            task = this.tasks[taskIndex];
            if (!task.exhausted && task.activeCount < task.concurrencyLimit) {
                this.startPromise(task);
            } else {
                taskIndex++;
            }
        }
    }

    /**
     * Starts a promise.
     * 
     * @param task The task to start.
     */
    private startPromise(task: InternalTaskDefinition<any>): void {
        let promise: Promise<any> = task.generator();
        if (!promise) {
            task.exhausted = true;
            // Remove the task if needed and start the next task
            this.nextPromise(task);
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
                if (!task.errored) {
                    task.errored = true;
                    task.exhausted = true;
                    task.reject(err);
                }
                // Resolve
            }).then((result: any) => {
                this.activePromiseCount--;
                task.activeCount--;
                task.result[resultIndex] = result;
                // Remove the task if needed and start the next task
                this.nextPromise(task);
            });
        }
    }

    /**
     * Continues execution to the next task.
     * Resolves and removes the specified task if it is exhausted and has no active invocations.
     */
    private nextPromise(task: InternalTaskDefinition<any>): void {
        if (task.exhausted && task.activeCount <= 0) {
            if (!task.errored) {
                task.resolve(task.result);
            }
            this.tasks.splice(this.tasks.indexOf(task), 1);
            this.taskMap.delete(task.identifier);
        }
        this.triggerPromises();
    }

    /**
     * Gets the current status of a task.
     * 
     * @param taskIdentifier Symbol used to identify the task.
     */
    public getTaskStatus(taskIdentifier: Symbol): TaskStatus {
        let task: InternalTaskDefinition<any> = this.taskMap.get(taskIdentifier);
        if (!task) {
            return;
        }
        return {
            identifier: task.identifier,
            activeCount: task.activeCount,
            concurrencyLimit: task.concurrencyLimit,
            invocations: task.invocations,
            invocationLimit: task.invocationLimit,
        };
    }

    /**
     * General-purpose function for adding a task.
     * 
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the values returned by the task.
     */
    public addGenericTask<R>(params: GenericTaskParameters<R>): Promise<R[]> {
        let task: InternalTaskDefinition<R> = {
            identifier: params.identifier || Symbol(),
            generator: params.generator,
            activeCount: 0,
            invocations: 0,
            result: [],
            concurrencyLimit: params.concurrencyLimit || Infinity,
            invocationLimit: params.invocationLimit || Infinity,
        }
        if (this.taskMap.has(task.identifier)) {
            return Promise.reject("The identifier used for this task already exists.");
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

        this.tasks.push(task);
        this.taskMap.set(task.identifier, task);
        this.triggerPromises();
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
            generator: () => {
                return params.generator(params.data);
            },
            invocationLimit: 1,
        }).then((result) => {
            return result[0];
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

        let identifier: Symbol = params.identifier || Symbol();

        let promise: Promise<R[]> = this.addGenericTask({
            generator: () => {
                if (index >= params.data.length) {
                    return null;
                }
                let oldIndex: number = index;
                if (typeof params.batchSize === "function") {
                    let status: TaskStatus = this.getTaskStatus(identifier);
                    let batchSize: number = params.batchSize(
                        params.data.length - oldIndex,
                        Math.min(this.freeSlots, status.concurrencyLimit - status.activeCount)
                    );
                    // Unacceptable values: NaN, <=0, type not number
                    if (!batchSize || typeof batchSize !== "number" || batchSize <= 0) {
                        return Promise.reject(new Error("Invalid batch size: " + batchSize));
                    }
                    index += batchSize;
                } else {
                    index += params.batchSize;
                }

                return params.generator(params.data.slice(oldIndex, index), oldIndex);
            },
            identifier: identifier,
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
        let index: number = 0;

        return this.addGenericTask({
            generator: () => {
                if (index >= params.data.length) {
                    return null;
                }
                let oldIndex: number = index;
                index++;
                return params.generator(params.data[oldIndex], oldIndex);
            },
            identifier: params.identifier,
            concurrencyLimit: params.concurrencyLimit,
            invocationLimit: params.invocationLimit,
        });
    }
}
