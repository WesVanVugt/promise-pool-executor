"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function createResolvablePromise(resolver) {
    return new Promise((resolve, reject) => {
        resolver.resolveInstance = resolve;
        resolver.rejectInstance = reject;
    });
}
/**
 * Internal symbol used to represent the entire pool as a group
 */
const globalGroupId = Symbol();
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
        this._groupMap = new Map();
        this._concurrencyLimit = concurrencyLimit !== undefined
            && concurrencyLimit !== null ? concurrencyLimit : Infinity;
        if (!this._concurrencyLimit || typeof this._concurrencyLimit !== "number" || this._concurrencyLimit <= 0) {
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
     * Returns true if the pool is idling (no active or queued promises).
     */
    get idling() {
        return this._activePromiseCount === 0 && this._tasks.length === 0;
    }
    /**
     * Private Method: Starts a promise. *
     * @param task The task to start.
     */
    _startPromise(task) {
        let promise;
        try {
            promise = task.generator(task.invocations);
        }
        catch (err) {
            this._errorTask(task, err);
        }
        if (!promise) {
            task.exhausted = true;
            // Remove the task if needed and start the next task
            this._nextPromise(task);
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
                this._errorTask(task, err);
                // Resolve
            }).then((result) => {
                this._activePromiseCount--;
                task.activeCount--;
                task.result[resultIndex] = result;
                // Remove the task if needed and start the next task
                this._nextPromise(task);
            });
        }
    }
    /**
     * Private Method: Registers an error for a task.
     */
    _errorTask(task, err) {
        if (task.errored) {
            // Perform an unhandled promise rejection, like the behavior of multiple rejections with Promise.all
            Promise.reject(err);
        }
        else {
            task.errored = true;
            task.exhausted = true;
            if (task.promise) {
                if (!task.init) {
                    task.promise.rejectInstance(err);
                }
                else {
                    // If the error is thrown immediately after task generation,
                    // a delay must be added for the promise rejection to work.
                    process.nextTick(() => {
                        task.promise.rejectInstance(err);
                    });
                }
            }
            this._errorGroups({
                error: err,
                handled: !!task.promise,
            }, task.groupIds);
        }
    }
    _errorGroups(err, groupsIds) {
        let groupId;
        for (groupId of groupsIds) {
            this._errorGroup(err, groupId);
        }
        if (!err.handled) {
            process.nextTick(() => {
                if (!err.handled) {
                    // Unhandled promise rejection
                    Promise.reject(err.error);
                }
            });
        }
    }
    _errorGroup(err, groupId) {
        let status = this._groupMap.get(groupId);
        if (!status) {
            status = {
                activeCount: 0,
                promises: [],
            };
            this._groupMap.set(groupId, status);
        }
        if (!status.rejection) {
            status.rejection = err;
            let promises = status.promises;
            status.promises = [];
            let promise;
            if (promises.length > 0) {
                err.handled = true;
            }
            for (promise of promises) {
                promise.rejectInstance(err.error);
            }
            if (status.activeCount < 1) {
                process.nextTick(() => {
                    status = this._groupMap.get(groupId);
                    if (status && status.activeCount < 1) {
                        this._groupMap.delete(groupId);
                    }
                });
            }
        }
    }
    /**
     * Private Method: Triggers promises to start.
     */
    _triggerPromises() {
        let taskIndex = 0;
        let task;
        while (this._activePromiseCount < this._concurrencyLimit && taskIndex < this._tasks.length) {
            task = this._tasks[taskIndex];
            if (!task.exhausted && task.activeCount < task.concurrencyLimit) {
                this._startPromise(task);
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
    _nextPromise(task) {
        if (task.exhausted && task.activeCount <= 0) {
            this._tasks.splice(this._tasks.indexOf(task), 1);
            this._taskMap.delete(task.id);
            if (!task.errored && task.promise) {
                if (task.init) {
                    task.promise.resolveInstance(task.result);
                }
                else {
                    // Although a resolution this fast should be impossible, the time restriction
                    // for rejected promises likely applies to resolved ones too.
                    process.nextTick(() => {
                        task.promise.resolveInstance(task.result);
                    });
                }
            }
            let groupId;
            for (groupId of task.groupIds) {
                let status = this._groupMap.get(groupId);
                console.assert(status, "Task must have group status");
                status.activeCount--;
                if (status.activeCount < 1) {
                    if (!task.errored) {
                        this._groupMap.delete(groupId);
                        let promise;
                        for (promise of status.promises) {
                            promise.resolveInstance();
                        }
                    }
                    else {
                        process.nextTick(() => {
                            status = this._groupMap.get(groupId);
                            if (status && status.activeCount < 1) {
                                this._groupMap.delete(groupId);
                            }
                        });
                    }
                }
            }
        }
        this._triggerPromises();
    }
    /**
     * Instantly resolves a promise, while respecting the parameters passed.
     */
    _instantResolve(params, data) {
        if (!params.noPromise) {
            return Promise.resolve(data);
        }
    }
    /**
     * Instantly rejects a promise with the specified error, while respecting the parameters passed.
     */
    _instantReject(params, err) {
        this._errorGroups({
            error: err,
            handled: !params.noPromise,
        }, params.groupIds ? [globalGroupId, ...params.groupIds] : [globalGroupId]);
        if (!params.noPromise) {
            return Promise.reject(err);
        }
    }
    /**
     * Gets the current status of a task.
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
            groupIds: params.groupIds ? [globalGroupId, ...params.groupIds] : [globalGroupId],
            generator: params.generator,
            activeCount: 0,
            invocations: 0,
            result: [],
            concurrencyLimit: params.concurrencyLimit !== undefined
                && params.concurrencyLimit !== null ? params.concurrencyLimit : Infinity,
            invocationLimit: params.invocationLimit !== undefined
                && params.invocationLimit !== null ? params.invocationLimit : Infinity,
            init: true,
            promise: params.noPromise ? null : {},
        };
        if (this._taskMap.has(task.id)) {
            return this._instantReject(params, new Error("The id used for this task already exists."));
        }
        if (typeof task.invocationLimit !== "number") {
            return this._instantReject(params, new Error("Invalid invocation limit: " + task.invocationLimit));
        }
        if (task.invocationLimit <= 0) {
            return this._instantResolve(params, task.result);
        }
        if (!task.concurrencyLimit || typeof task.concurrencyLimit !== "number" || task.concurrencyLimit <= 0) {
            return this._instantReject(params, new Error("Invalid concurrency limit: " + params.concurrencyLimit));
        }
        let promise = null;
        if (!params.noPromise) {
            task.promise = {};
            promise = createResolvablePromise(task.promise);
        }
        let groupId;
        let status;
        for (groupId of task.groupIds) {
            status = this._groupMap.get(groupId);
            if (!status) {
                status = {
                    activeCount: 0,
                    promises: [],
                };
                this._groupMap.set(groupId, status);
            }
            status.activeCount++;
        }
        this._tasks.push(task);
        this._taskMap.set(task.id, task);
        this._triggerPromises();
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
            groupIds: params.groupIds,
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
            id: params.id,
            groupIds: params.groupIds,
            generator: params.generator,
            invocationLimit: params.invocationLimit,
            concurrencyLimit: 1,
            noPromise: params.noPromise,
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
            return this._instantReject(params, new Error("Invalid batch size: " + params.batchSize));
        }
        let id = params.id || Symbol();
        let promise = this.addGenericTask({
            id: id,
            groupIds: params.groupIds,
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
            concurrencyLimit: params.concurrencyLimit,
            invocationLimit: params.invocationLimit,
            noPromise: params.noPromise,
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
            id: params.id,
            groupIds: params.groupIds,
            generator: (index) => {
                if (index >= params.data.length) {
                    return null;
                }
                let oldIndex = index;
                index++;
                return params.generator(params.data[oldIndex], oldIndex);
            },
            concurrencyLimit: params.concurrencyLimit,
            invocationLimit: params.invocationLimit,
            noPromise: params.noPromise,
        });
    }
    /**
     * Returns a promise which resolves when there are no more tasks queued to run.
     */
    waitForIdle() {
        return this.waitForGroupIdle(globalGroupId);
    }
    /**
     * Returns a promise which resolves when there are no more tasks in a group queued to run.
     */
    waitForGroupIdle(id) {
        let status = this._groupMap.get(id);
        if (!status) {
            return Promise.resolve();
        }
        if (status.rejection) {
            status.rejection.handled = true;
            return Promise.reject(status.rejection.error);
        }
        if (status.activeCount <= 0) {
            return Promise.resolve();
        }
        let resolver = {};
        status.promises.push(resolver);
        return createResolvablePromise(resolver);
    }
}
exports.PromisePoolExecutor = PromisePoolExecutor;
//# sourceMappingURL=index.js.map