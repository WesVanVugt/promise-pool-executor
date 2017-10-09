"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Debug = require("debug");
const nextTick = require("next-tick");
const group_1 = require("../private/group");
const persistent_batch_1 = require("../private/persistent-batch");
const task_1 = require("../private/task");
const utils_1 = require("../private/utils");
const task_2 = require("./task");
const debug = Debug("promise-pool-executor:pool");
debug("booting %o", "promise-pool-executor");
class PromisePoolExecutor {
    /**
     * Construct a new PromisePoolExecutor object.
     * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
     */
    constructor(options) {
        /**
         * All tasks which are active or waiting.
         */
        this._tasks = [];
        let groupOptions;
        if (!utils_1.isNull(options)) {
            if (typeof options === "object") {
                groupOptions = options;
            }
            else {
                groupOptions = {
                    concurrencyLimit: options,
                };
            }
        }
        else {
            groupOptions = {};
        }
        this._globalGroup = this.addGroup(groupOptions);
    }
    /**
     * The maximum number of promises allowed to be active simultaneously in the pool.
     */
    get concurrencyLimit() {
        return this._globalGroup.concurrencyLimit;
    }
    set concurrencyLimit(val) {
        this._globalGroup.concurrencyLimit = val;
    }
    /**
     * The maximum number promises allowed to be generated within the time window specified by {frequencyWindow}.
     */
    get frequencyLimit() {
        return this._globalGroup.frequencyLimit;
    }
    set frequencyLimit(val) {
        this._globalGroup.frequencyLimit = val;
    }
    /**
     * The time window in milliseconds to use for {frequencyLimit}.
     */
    get frequencyWindow() {
        return this._globalGroup.frequencyWindow;
    }
    set frequencyWindow(val) {
        this._globalGroup.frequencyWindow = val;
    }
    /**
     * The number of tasks active in the pool.
     */
    get activeTaskCount() {
        return this._globalGroup.activeTaskCount;
    }
    /**
     * The number of promises active in the pool.
     */
    get activePromiseCount() {
        return this._globalGroup.activePromiseCount;
    }
    /**
     * The number of promises which can be created before reaching the pool's configured limits.
     */
    get freeSlots() {
        return this._globalGroup._concurrencyLimit - this._globalGroup._activePromiseCount;
    }
    /**
     * Adds a group to the pool.
     */
    addGroup(options) {
        return new group_1.PromisePoolGroupPrivate(this, () => this._triggerNextTick(), options);
    }
    addGenericTask(options) {
        const task = new task_1.PromisePoolTaskPrivate({
            detach: () => {
                this._removeTask(task);
            },
            globalGroup: this._globalGroup,
            pool: this,
            triggerNowCallback: () => this._triggerNow(),
        }, options);
        if (task.state <= task_2.TaskState.Paused) {
            // Attach the task
            this._tasks.push(task);
        }
        this._triggerNow();
        return task;
    }
    /**
     * Adds a task with a single promise. The resulting task can be resolved to the result of this promise.
     */
    addSingleTask(options) {
        const data = options.data;
        const generator = options.generator;
        return this.addGenericTask({
            generator() {
                return generator.call(this, data);
            },
            groups: options.groups,
            invocationLimit: 1,
            paused: options.paused,
            resultConverter: (result) => result[0],
        });
    }
    /**
     * Adds a task with a concurrency limit of 1. The resulting task can be resolved to an array containing the
     * results of the task.
     */
    addLinearTask(options) {
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
     * Adds a task which generates a promise for batches of elements from an array. The resulting task can be
     * resolved to an array containing the results of the task.
     */
    addBatchTask(options) {
        let index = 0;
        // Unacceptable values: NaN, <=0, type not number/function
        if (!options.batchSize || typeof options.batchSize !== "function"
            && (typeof options.batchSize !== "number" || options.batchSize <= 0)) {
            throw new Error("Invalid batch size: " + options.batchSize);
        }
        const data = options.data;
        const generator = options.generator;
        const batchSizeOption = options.batchSize;
        return this.addGenericTask({
            concurrencyLimit: options.concurrencyLimit,
            frequencyLimit: options.frequencyLimit,
            frequencyWindow: options.frequencyWindow,
            generator(invocation) {
                if (index >= data.length) {
                    return; // No data to process
                }
                const oldIndex = index;
                if (typeof batchSizeOption === "function") {
                    const batchSize = batchSizeOption(data.length - oldIndex, this.freeSlots);
                    // Unacceptable values: NaN, <=0, type not number
                    if (!batchSize || typeof batchSize !== "number" || batchSize <= 0) {
                        return Promise.reject(new Error("Invalid batch size: " + batchSize));
                    }
                    index += batchSize;
                }
                else {
                    index += batchSizeOption;
                }
                if (index >= data.length) {
                    this.end(); // last batch
                }
                return generator.call(this, data.slice(oldIndex, index), oldIndex, invocation);
            },
            groups: options.groups,
            invocationLimit: options.invocationLimit,
            paused: options.paused,
        });
    }
    /**
     * Adds a task which generates a promise for each element in an array. The resulting task can be resolved to
     * an array containing the results of the task.
     */
    addEachTask(options) {
        const data = options.data;
        return this.addGenericTask({
            concurrencyLimit: options.concurrencyLimit,
            frequencyLimit: options.frequencyLimit,
            frequencyWindow: options.frequencyWindow,
            groups: options.groups,
            paused: options.paused,
            generator(index) {
                if (index >= data.length - 1) {
                    if (index >= data.length) {
                        return; // No element to process
                    }
                    // Last element
                    this.end();
                }
                return options.generator.call(this, data[index], index);
            },
        });
    }
    /**
     * Adds a task which can be used to combine multiple requests into batches to improve efficiency.
     */
    addPersistentBatchTask(options) {
        return new persistent_batch_1.PersistentBatchTaskPrivate(this, options);
    }
    /**
     * Returns a promise which resolves when there are no more tasks queued to run.
     */
    waitForIdle() {
        return this._globalGroup.waitForIdle();
    }
    _cleanFrequencyStarts() {
        // Remove the frequencyStarts entries which are outside of the window
        const now = Date.now();
        this._globalGroup._cleanFrequencyStarts(now);
        this._tasks.forEach((task) => {
            task._cleanFrequencyStarts(now);
        });
    }
    _clearTriggerTimeout() {
        if (this._nextTriggerTimeout) {
            clearTimeout(this._nextTriggerTimeout);
            this._nextTriggerTimeout = undefined;
        }
        this._nextTriggerTime = undefined;
    }
    _triggerNextTick() {
        if (this._nextTriggerTime === -1) {
            return;
        }
        this._clearTriggerTimeout();
        this._nextTriggerTime = -1;
        nextTick(() => {
            if (this._nextTriggerTime === -1) {
                this._nextTriggerTime = undefined;
                this._triggerNow();
            }
        });
    }
    /**
     * Private Method: Triggers promises to start.
     */
    _triggerNow() {
        if (this._triggering) {
            debug("Setting triggerAgain flag.");
            this._triggerAgain = true;
            return;
        }
        this._triggering = true;
        this._triggerAgain = false;
        debug("Trigger promises");
        this._cleanFrequencyStarts();
        this._clearTriggerTimeout();
        let taskIndex = 0;
        let task;
        let soonest = Infinity;
        let busyTime;
        while (taskIndex < this._tasks.length) {
            task = this._tasks[taskIndex];
            busyTime = task._busyTime();
            debug("BusyTime: %o", busyTime);
            if (!busyTime) {
                task._run();
            }
            else {
                taskIndex++;
                if (busyTime < soonest) {
                    soonest = busyTime;
                }
            }
        }
        this._triggering = false;
        if (this._triggerAgain) {
            return this._triggerNow();
        }
        let time;
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
    _removeTask(task) {
        const i = this._tasks.indexOf(task);
        if (i !== -1) {
            debug("Task removed");
            this._tasks.splice(i, 1);
        }
    }
}
exports.PromisePoolExecutor = PromisePoolExecutor;
