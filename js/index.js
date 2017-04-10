"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Private Method: Starts a promise. *
 * @param task The task to start.
 */
function startPromise(task) {
    let promise = task.generator(task.invocations);
    if (!promise) {
        task.exhausted = true;
        // Remove the task if needed and start the next task
        nextPromise.call(this, task);
    }
    else {
        if (!(promise instanceof Promise)) {
            // In case what is returned is not a promise, make it one
            promise = Promise.resolve(promise);
        }
        this.activePromiseCount++;
        task.activeCount++;
        let resultIndex = task.invocations;
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
        }).then((result) => {
            this.activePromiseCount--;
            task.activeCount--;
            task.result[resultIndex] = result;
            // Remove the task if needed and start the next task
            nextPromise.call(this, task);
        });
    }
}
/**
 * Private Method: Triggers promises to start.
 */
function triggerPromises() {
    let taskIndex = 0;
    let task;
    while (this.activePromiseCount < this.concurrencyLimit && taskIndex < this.tasks.length) {
        task = this.tasks[taskIndex];
        if (!task.exhausted && task.activeCount < task.concurrencyLimit) {
            startPromise.call(this, task);
        }
        else {
            taskIndex++;
        }
    }
}
/**
 * Private Method: Continues execution to the next task.
 * Resolves and removes the specified task if it is exhausted and has no active invocations.
 */
function nextPromise(task) {
    if (task.exhausted && task.activeCount <= 0) {
        if (!task.errored) {
            task.resolve(task.result);
        }
        this.tasks.splice(this.tasks.indexOf(task), 1);
        this.taskMap.delete(task.identifier);
    }
    triggerPromises.call(this);
}
class PromisePoolExecutor {
    /**
     * Construct a new PromisePoolExecutor object.
     *
     * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
     */
    constructor(concurrencyLimit) {
        /**
         * The number of promises which are active.
         */
        this.activePromiseCount = 0;
        /**
         * All tasks which are active or waiting.
         */
        this.tasks = [];
        /**
         * A map containing all tasks which are active or waiting, indexed by their identifier symbol.
         */
        this.taskMap = new Map();
        this.concurrencyLimit = concurrencyLimit || Infinity;
        if (typeof this.concurrencyLimit !== "number" || this.concurrencyLimit <= 0) {
            throw new Error("Invalid concurrency limit: " + this.concurrencyLimit);
        }
    }
    /**
     * The number of promises which can be invoked before the concurrency limit is reached.
     */
    get freeSlots() {
        return this.concurrencyLimit - this.activePromiseCount;
    }
    /**
     * Gets the current status of a task.
     *
     * @param taskIdentifier Symbol used to identify the task.
     */
    getTaskStatus(taskIdentifier) {
        let task = this.taskMap.get(taskIdentifier);
        if (!task) {
            return;
        }
        return {
            identifier: task.identifier,
            activeCount: task.activeCount,
            concurrencyLimit: task.concurrencyLimit,
            invocations: task.invocations,
            invocationLimit: task.invocationLimit,
            freeSlots: Math.min(this.freeSlots, task.concurrencyLimit - task.activeCount, task.invocationLimit - task.invocations)
        };
    }
    /**
     * General-purpose function for adding a task.
     *
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the values returned by the task.
     */
    addGenericTask(params) {
        let task = {
            identifier: params.identifier || Symbol(),
            generator: params.generator,
            activeCount: 0,
            invocations: 0,
            result: [],
            concurrencyLimit: params.concurrencyLimit || Infinity,
            invocationLimit: params.invocationLimit || Infinity,
        };
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
        let promise = new Promise((resolve, reject) => {
            task.resolve = resolve;
            task.reject = reject;
        });
        this.tasks.push(task);
        this.taskMap.set(task.identifier, task);
        triggerPromises.call(this);
        return promise;
    }
    /**
     * Runs a task once while obeying the concurrency limit set for the pool.
     *
     * @param params Parameters used to define the task.
     * @return A promise which resolves to the result of the task.
     */
    addSingleTask(params) {
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
     * Runs a task with a concurrency limit of 1.
     *
     * @param params
     * @return A promise which resolves to an array containing the results of the task.
     */
    addLinearTask(params) {
        return this.addGenericTask({
            generator: params.generator,
            identifier: params.identifier,
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
    addBatchTask(params) {
        let index = 0;
        // Unacceptable values: NaN, <=0, type not number/function
        if (!params.batchSize || typeof params.batchSize !== "function"
            && (typeof params.batchSize !== "number" || params.batchSize <= 0)) {
            return Promise.reject(new Error("Invalid batch size: " + params.batchSize));
        }
        let identifier = params.identifier || Symbol();
        let promise = this.addGenericTask({
            generator: (invocation) => {
                if (index >= params.data.length) {
                    return null;
                }
                let oldIndex = index;
                if (typeof params.batchSize === "function") {
                    let status = this.getTaskStatus(identifier);
                    let batchSize = params.batchSize(params.data.length - oldIndex, status.freeSlots);
                    // Unacceptable values: NaN, <=0, type not number
                    if (!batchSize || typeof batchSize !== "number" || batchSize <= 0) {
                        return Promise.reject(new Error("Invalid batch size: " + batchSize));
                    }
                    index += batchSize;
                }
                else {
                    index += params.batchSize;
                }
                return params.generator(params.data.slice(oldIndex, index), oldIndex, invocation);
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
    addEachTask(params) {
        return this.addGenericTask({
            generator: (index) => {
                if (index >= params.data.length) {
                    return null;
                }
                let oldIndex = index;
                index++;
                return params.generator(params.data[oldIndex], oldIndex);
            },
            identifier: params.identifier,
            concurrencyLimit: params.concurrencyLimit,
            invocationLimit: params.invocationLimit,
        });
    }
}
exports.PromisePoolExecutor = PromisePoolExecutor;
//# sourceMappingURL=index.js.map