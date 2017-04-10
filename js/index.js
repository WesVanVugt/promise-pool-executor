"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Private Method: Starts a promise. *
 * @param task The task to start.
 */
function startPromise(task) {
    let promise;
    try {
        promise = task.generator(task.invocations);
    }
    catch (err) {
        errorTask(task, err);
        return;
    }
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
        this._activePromiseCount++;
        task.activeCount++;
        let resultIndex = task.invocations;
        task.invocations++;
        if (task.invocations >= task.invocationLimit) {
            task.exhausted = true;
        }
        promise.catch((err) => {
            errorTask(task, err);
            // Resolve
        }).then((result) => {
            this._activePromiseCount--;
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
function errorTask(task, err) {
    if (!task.errored) {
        task.errored = true;
        task.exhausted = true;
        if (task.returnReady) {
            task.promise.rejectInstance(err);
        }
        else {
            // If the error is thrown immediately after task generation,
            // a delay must be added for the promise rejection to work.
            setTimeout(() => {
                task.promise.rejectInstance(err);
            }, 1);
        }
    }
}
/**
 * Private Method: Triggers promises to start.
 */
function triggerPromises() {
    let taskIndex = 0;
    let task;
    while (this._activePromiseCount < this._concurrencyLimit && taskIndex < this._tasks.length) {
        task = this._tasks[taskIndex];
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
            if (task.returnReady) {
                task.promise.resolveInstance(task.result);
            }
            else {
                // Although a resolution this fast should be impossible, the time restriction
                // for rejected promises likely applies to resolved ones too.
                setTimeout(() => {
                    task.promise.resolveInstance(task.result);
                }, 1);
            }
        }
        this._tasks.splice(this._tasks.indexOf(task), 1);
        this._taskMap.delete(task.id);
    }
    triggerPromises.call(this);
    if (this._activePromiseCount === 0 && this._tasks.length === 0) {
        this._idlePromises.forEach((resolver) => {
            resolver.resolveInstance();
        });
        this._idlePromises.length = 0;
    }
}
function createResolvablePromise(resolver) {
    return new Promise((resolve, reject) => {
        resolver.resolveInstance = resolve;
        resolver.rejectInstance = reject;
    });
}
class PromisePoolExecutor {
    /**
     * Construct a new PromisePoolExecutor object.
     *
     * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
     */
    constructor(concurrencyLimit) {
        this._activePromiseCount = 0;
        /**
         * All tasks which are active or waiting.
         */
        this._tasks = [];
        /**
         * A map containing all tasks which are active or waiting, indexed by their ids.
         */
        this._taskMap = new Map();
        this._idlePromises = [];
        this._concurrencyLimit = concurrencyLimit || Infinity;
        if (typeof this._concurrencyLimit !== "number" || this._concurrencyLimit <= 0) {
            throw new Error("Invalid concurrency limit: " + this._concurrencyLimit);
        }
    }
    /**
     * The maximum number of promises which are allowed to run at one time.
     */
    get concurrencyLimit() {
        return this._concurrencyLimit;
    }
    /**
     * The number of promises which are active.
     */
    get activePromiseCount() {
        return this._activePromiseCount;
    }
    /**
     * The number of promises which can be invoked before the concurrency limit is reached.
     */
    get freeSlots() {
        return this._concurrencyLimit - this._activePromiseCount;
    }
    /**
     * Gets the current status of a task.
     *
     * @param id Unique value used to identify the task.
     */
    getTaskStatus(id) {
        let task = this._taskMap.get(id);
        if (!task) {
            return;
        }
        return {
            id: task.id,
            activeCount: task.activeCount,
            concurrencyLimit: task.concurrencyLimit,
            invocations: task.invocations,
            invocationLimit: task.invocationLimit,
            freeSlots: Math.min(this.freeSlots, task.concurrencyLimit - task.activeCount, task.invocationLimit - task.invocations)
        };
    }
    /**
     * Stops a running task.
     * @param taskId
     */
    stopTask(id) {
        let task = this._taskMap.get(id);
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
    addGenericTask(params) {
        let task = {
            id: params.id || Symbol(),
            generator: params.generator,
            activeCount: 0,
            invocations: 0,
            result: [],
            concurrencyLimit: params.concurrencyLimit || Infinity,
            invocationLimit: params.invocationLimit || Infinity,
            returnReady: false,
        };
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
        task.promise = {};
        let promise = createResolvablePromise(task.promise);
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
    addSingleTask(params) {
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
    addLinearTask(params) {
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
    addBatchTask(params) {
        let index = 0;
        // Unacceptable values: NaN, <=0, type not number/function
        if (!params.batchSize || typeof params.batchSize !== "function"
            && (typeof params.batchSize !== "number" || params.batchSize <= 0)) {
            return Promise.reject(new Error("Invalid batch size: " + params.batchSize));
        }
        let id = params.id || Symbol();
        let promise = this.addGenericTask({
            generator: (invocation) => {
                if (index >= params.data.length) {
                    return null;
                }
                let oldIndex = index;
                if (typeof params.batchSize === "function") {
                    let status = this.getTaskStatus(id);
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
            id: params.id,
            concurrencyLimit: params.concurrencyLimit,
            invocationLimit: params.invocationLimit,
        });
    }
    /**
     * Returns a promise which resolves when there are no more tasks queued to run.
     */
    waitForIdle() {
        let resolver = {};
        this._idlePromises.push(resolver);
        return createResolvablePromise(resolver);
    }
}
exports.PromisePoolExecutor = PromisePoolExecutor;
//# sourceMappingURL=index.js.map