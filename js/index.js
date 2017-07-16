"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const nextTick = require("next-tick");
function createResolvablePromise(resolver) {
    return new Promise((resolve, reject) => {
        resolver.resolveInstance = resolve;
        resolver.rejectInstance = reject;
    });
}
function newGroupStatus(groupId) {
    return {
        groupId: groupId,
        activeTaskCount: 0,
        activePromiseCount: 0,
        concurrencyLimit: Infinity,
        frequencyLimit: Infinity,
        frequencyWindow: Infinity,
        frequencyStarts: [],
        promises: [],
    };
}
/**
 * Internal symbol used to represent the entire pool as a group
 */
const globalGroupId = Symbol();
class PromisePoolExecutor {
    constructor(params) {
        /**
         * All tasks which are active or waiting.
         */
        this._tasks = [];
        /**
         * A map containing all tasks which are active or waiting, indexed by their ids.
         */
        this._taskMap = new Map();
        this._groupMap = new Map();
        let groupParams = {
            groupId: globalGroupId,
        };
        if (params !== undefined && params !== null) {
            if (typeof params === "object") {
                groupParams.concurrencyLimit = params.concurrencyLimit;
                groupParams.frequencyLimit = params.frequencyLimit;
                groupParams.frequencyWindow = params.frequencyWindow;
            }
            else {
                groupParams.concurrencyLimit = params;
            }
        }
        this.configureGroup(groupParams);
        this._globalGroup = this._groupMap.get(globalGroupId);
    }
    /**
     * The maximum number of promises which are allowed to run at one time.
     */
    get concurrencyLimit() {
        return this._globalGroup.concurrencyLimit;
    }
    set concurrencyLimit(value) {
        if (!value || typeof value !== "number" || value <= 0) {
            throw new Error("Invalid concurrency limit: " + value);
        }
        this._globalGroup.concurrencyLimit = value;
    }
    /**
     * The number of promises which are active.
     */
    get activePromiseCount() {
        return this._globalGroup.activeTaskCount;
    }
    /**
     * The number of promises which can be invoked before the concurrency limit is reached.
     */
    get freeSlots() {
        return this._globalGroup.concurrencyLimit - this._globalGroup.activePromiseCount;
    }
    /**
     * Returns true if the pool is idling (no active or queued promises).
     */
    get idling() {
        return this._globalGroup.activeTaskCount === 0 && this._tasks.length === 0;
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
            task.groups.forEach((group) => {
                group.activePromiseCount++;
                if (group.frequencyLimit) {
                    group.frequencyStarts.push(Date.now());
                }
            });
            let resultIndex = task.invocations;
            task.invocations++;
            if (task.invocations >= task.invocationLimit) {
                task.exhausted = true;
            }
            promise.catch((err) => {
                this._errorTask(task, err);
                // Resolve
            }).then((result) => {
                task.groups.forEach((group) => {
                    group.activePromiseCount--;
                });
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
                    nextTick(() => {
                        task.promise.rejectInstance(err);
                    });
                }
            }
            this._errorGroups({
                error: err,
                handled: !!task.promise,
            }, task.groups);
        }
    }
    _errorGroups(err, groups) {
        groups.forEach((group) => {
            this._errorGroup(err, group, group.groupId);
        });
        if (!err.handled) {
            nextTick(() => {
                if (!err.handled) {
                    // Unhandled promise rejection
                    Promise.reject(err.error);
                }
            });
        }
    }
    _errorGroup(err, group, groupId) {
        if (!group.rejection) {
            group.rejection = err;
            let promises = group.promises;
            if (promises.length > 0) {
                group.promises = [];
                err.handled = true;
                promises.forEach((promise) => {
                    promise.rejectInstance(err.error);
                });
            }
            if (group.activeTaskCount < 1) {
                nextTick(() => {
                    group = this._groupMap.get(groupId);
                    if (group && group.activeTaskCount < 1) {
                        if (group.save) {
                            delete group.rejection;
                        }
                        else {
                            this._groupMap.delete(groupId);
                        }
                    }
                });
            }
        }
    }
    /**
     * Private Method: Triggers promises to start.
     */
    _triggerPromises() {
        // Remove the frequencyStarts entries which are outside of the window
        this._groupMap.forEach((group) => {
            if (group.frequencyStarts.length > 0) {
                let time = Date.now() - group.frequencyWindow;
                let i = 0;
                for (; i < group.frequencyStarts.length; i++) {
                    if (group.frequencyStarts[i] > time) {
                        break;
                    }
                }
                if (i > 0) {
                    group.frequencyStarts.splice(0, i);
                }
            }
        });
        let taskIndex = 0;
        let task;
        let soonest = Infinity;
        let time;
        let taskTime;
        let blocked;
        while (taskIndex < this._tasks.length) {
            task = this._tasks[taskIndex];
            // this._activePromiseCount < this._concurrencyLimit
            taskTime = 0;
            blocked = false;
            task.groups.forEach((group) => {
                if (group.activePromiseCount >= group.concurrencyLimit) {
                    blocked = true;
                }
                else if (group.frequencyLimit && group.frequencyStarts.length >= group.frequencyLimit) {
                    time = group.frequencyStarts[0] + group.frequencyWindow;
                    if (time > taskTime) {
                        taskTime = time;
                    }
                }
            });
            if (blocked) {
                taskIndex++;
            }
            else if (taskTime) {
                if (taskTime < soonest) {
                    soonest = taskTime;
                }
                taskIndex++;
            }
            else if (!task.exhausted) {
                this._startPromise(task);
            }
            else {
                taskIndex++;
            }
        }
        if (soonest !== Infinity) {
            time = Date.now();
            if (time >= soonest) {
                return this._triggerPromises();
            }
            if (!this._nextTriggerTime || soonest < this._nextTriggerTime) {
                if (this._nextTriggerTime) {
                    clearTimeout(this._nextTriggerTimeout);
                }
                this._nextTriggerTime = soonest;
                this._nextTriggerTimeout = setTimeout(() => {
                    this._nextTriggerTime = 0;
                    this._triggerPromises();
                }, soonest - time);
            }
        }
    }
    /**
     * Private Method: Continues execution to the next task.
     * Resolves and removes the specified task if it is exhausted and has no active invocations.
     */
    _nextPromise(task) {
        if (task.exhausted && task.taskGroup.activePromiseCount <= 0) {
            this._tasks.splice(this._tasks.indexOf(task), 1);
            this._taskMap.delete(task.id);
            if (!task.errored && task.promise) {
                if (task.init) {
                    task.promise.resolveInstance(task.result);
                }
                else {
                    // Although a resolution this fast should be impossible, the time restriction
                    // for rejected promises likely applies to resolved ones too.
                    nextTick(() => {
                        task.promise.resolveInstance(task.result);
                    });
                }
            }
            task.groups.forEach((group) => {
                group.activeTaskCount--;
                if (group.activeTaskCount <= 0) {
                    if (!task.errored) {
                        if (!group.save) {
                            this._groupMap.delete(group.groupId);
                        }
                        if (group.promises.length) {
                            let promises = group.promises;
                            group.promises = [];
                            promises.forEach((promise) => {
                                promise.resolveInstance();
                            });
                        }
                    }
                    else {
                        nextTick(() => {
                            group = this._groupMap.get(group.groupId);
                            if (group && group.activeTaskCount < 1) {
                                if (group.save) {
                                    delete group.rejection;
                                }
                                else {
                                    this._groupMap.delete(group.groupId);
                                }
                            }
                        });
                    }
                }
            });
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
        let groups = [this._globalGroup];
        let group;
        if (params.groupIds) {
            params.groupIds.forEach((groupId) => {
                group = this._groupMap.get(groupId);
                if (!group) {
                    group = newGroupStatus(groupId);
                    this._groupMap.set(groupId, group);
                }
                groups.push(group);
            });
        }
        this._errorGroups({
            error: err,
            handled: !params.noPromise,
        }, groups);
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
            return null;
        }
        let freeSlots = task.invocationLimit - task.invocations;
        task.groups.forEach((group) => {
            let slots = group.concurrencyLimit - group.activePromiseCount;
            if (slots < freeSlots) {
                freeSlots = slots;
            }
        });
        return {
            id: task.id,
            activeCount: task.taskGroup.activePromiseCount,
            concurrencyLimit: task.taskGroup.concurrencyLimit,
            invocations: task.invocations,
            invocationLimit: task.invocationLimit,
            freeSlots: freeSlots,
        };
    }
    configureGroup(params) {
        let group = this._groupMap.get(params.groupId);
        if (!group) {
            group = newGroupStatus(params.groupId);
            this._groupMap.set(params.groupId, group);
        }
        group.save = true;
        if (params.concurrencyLimit !== undefined && params.concurrencyLimit !== null) {
            if (!params.concurrencyLimit || typeof params.concurrencyLimit !== "number" || params.concurrencyLimit <= 0) {
                throw new Error("Invalid concurrency limit: " + params.concurrencyLimit);
            }
            group.concurrencyLimit = params.concurrencyLimit;
        }
        else {
            group.concurrencyLimit = Infinity;
        }
        if (params.frequencyLimit !== undefined || params.frequencyWindow !== undefined) {
            if (params.frequencyLimit === undefined || params.frequencyWindow === undefined) {
                throw new Error("Both frequencyLimit and frequencyWindow must be set at the same time.");
            }
            if (!params.frequencyLimit || typeof params.frequencyLimit !== "number" || params.frequencyLimit <= 0) {
                throw new Error("Invalid frequency limit: " + params.frequencyLimit);
            }
            if (!params.frequencyWindow || typeof params.frequencyWindow !== "number" || params.frequencyWindow <= 0) {
                throw new Error("Invalid frequency window: " + params.frequencyWindow);
            }
            group.frequencyLimit = params.frequencyLimit;
            group.frequencyWindow = params.frequencyWindow;
        }
        else {
            group.frequencyLimit = Infinity;
            group.frequencyWindow = Infinity;
        }
        if (group.activeTaskCount > 0) {
            this._triggerPromises();
        }
    }
    deleteGroupConfiguration(groupId) {
        let group = this._groupMap.get(groupId);
        if (!group || !group.save) {
            return false;
        }
        if (group.activeTaskCount <= 0 && !group.rejection) {
            this._groupMap.delete(groupId);
        }
        else {
            group.concurrencyLimit = Infinity;
            group.frequencyLimit = Infinity;
            group.frequencyWindow = Infinity;
            delete group.save;
            this._triggerPromises();
        }
        return true;
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
            groups: [this._globalGroup],
            generator: params.generator,
            invocations: 0,
            result: [],
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
        let groupId = Symbol();
        try {
            this.configureGroup({
                groupId: groupId,
                concurrencyLimit: params.concurrencyLimit,
                frequencyLimit: params.frequencyLimit,
                frequencyWindow: params.frequencyWindow,
            });
        }
        catch (err) {
            return this._instantReject(params, err);
        }
        task.taskGroup = this._groupMap.get(groupId);
        task.taskGroup.save = false;
        task.groups.push(task.taskGroup);
        let promise = null;
        if (!params.noPromise) {
            task.promise = {};
            promise = createResolvablePromise(task.promise);
        }
        this._globalGroup.activeTaskCount++;
        if (params.groupIds) {
            let group;
            params.groupIds.forEach((groupId) => {
                group = this._groupMap.get(groupId);
                if (!group) {
                    group = newGroupStatus(groupId);
                    this._groupMap.set(groupId, group);
                }
                group.activeTaskCount++;
                task.groups.push(group);
            });
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
        if (status.activeTaskCount <= 0) {
            return Promise.resolve();
        }
        let resolver = {};
        status.promises.push(resolver);
        return createResolvablePromise(resolver);
    }
}
exports.PromisePoolExecutor = PromisePoolExecutor;
//# sourceMappingURL=index.js.map