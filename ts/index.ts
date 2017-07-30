const nextTick = require("next-tick");

const TASK_GROUP_INDEX = 1;

export interface TaskGeneral {
    /**
     * An array of values, each of which identifies a group the task belongs to. These groups can be used to respond
     * to the completion of a larger task.
     */
    groups?: PromisePoolGroup[];
    /**
     * Starts the task in a paused state if set to true.
     */
    paused?: boolean;
}

export interface PromiseLimits {
    /**
     * Limits the number of instances of a promise which can be run in parallel.
     */
    concurrencyLimit: number;
    /**
     * The number of times a promise can be invoked within the time specified by {frequencyWindow}.
     */
    frequencyLimit: number;
    /**
     * The time window in milliseconds to use for {frequencyLimit}.
     */
    frequencyWindow: number;
}

export interface InvocationLimit {
    /**
     * Limits the number of times a promise will be invoked.
     */
    invocationLimit?: number;
}

export interface PromisePoolGroupConfig extends Partial<PromiseLimits> { }

export interface TaskLimits extends PromisePoolGroupConfig, InvocationLimit { }

export interface GenericTaskParamsBase extends TaskGeneral, TaskLimits { }

export interface GenericTaskParams<R> extends GenericTaskParamsBase {
    /**
     * Function used for creating promises to run.
     * This function will be run repeatedly until it returns null or the concurrency or invocation limit is reached.
     * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each call.
     */
    generator: (this: PromisePoolTask<any[]>, invocation: number) => Promise<R> | null,
}

export interface GenericTaskParamsConverted<I, R> extends GenericTaskParamsBase {
    generator: (this: PromisePoolTask<any>, invocation: number) => Promise<I> | null,
    resultConverter: (result: I[]) => R;
}

interface PromisePoolTaskParams<R> extends GenericTaskParams<R> {
    pool: PromisePoolExecutor;
    globalGroup: PromisePoolGroupInternal;
    triggerPromises: () => void;
    attach: (task: PromisePoolTaskInternal<R>, groups: PromisePoolGroupInternal[]) => void;
    detach: (groups: PromisePoolGroupInternal[]) => void;
    resultConverter?: (result: R[]) => any;
}

export interface SingleTaskParams<T, R> extends TaskGeneral {
    /**
     * A function used for creating promises to run.
     */
    generator: (this: PromisePoolTask<any>, data: T) => Promise<R>;
    /**
     * Optional data to pass to the generator function as a parameter.
    */
    data?: T;
}

export interface LinearTaskParams<T, R> extends TaskGeneral, PromisePoolGroupConfig, InvocationLimit {
    /**
     * A function used for creating promises to run.
     * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each call.
     */
    generator: (this: PromisePoolTask<any[]>, invocation: number) => Promise<R>;
}

export interface BatchTaskParams<T, R> extends TaskGeneral, PromisePoolGroupConfig, InvocationLimit {
    /**
     * A function used for creating promises to run.
     * 
     * @param {T[]} values - Elements from {data} batched for this invocation.
     * @param startIndex The original index for the first element in {values}.
     */
    generator: (this: PromisePoolTask<any[]>, values: T[], startIndex: number, invocation: number) => Promise<R> | null;
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

export interface EachTaskParams<T, R> extends TaskGeneral, PromisePoolGroupConfig, InvocationLimit {
    /**
     * A function used for creating promises to run.
     * 
     * @param value The value from {data} for this invocation.
     * @param index The original index which {value} was stored at.
     */
    generator: (this: PromisePoolTask<any[]>, value: T, index: number) => Promise<R> | null;
    /**
     * An array of elements to be individually passed to {generator}.
     */
    data: T[];
}

export interface PromisePoolGroup {
    configure(params: PromisePoolGroupConfig): void;
    waitForIdle(): Promise<void>;
}

interface PromisePoolGroupParams extends PromisePoolGroupConfig {
    pool: PromisePoolExecutor;
    triggerPromises: () => void;
}

class PromisePoolGroupInternal implements PromisePoolGroup {
    public _pool: PromisePoolExecutor;
    private _triggerCallback: () => void;
    public _concurrencyLimit: number;
    public _frequencyLimit: number;
    public _frequencyWindow: number;
    public _frequencyStarts: number[] = [];
    private _promises: Array<ResolvablePromise<void>> = [];
    private _rejection?: TaskError;
    public _activeTaskCount: number = 0;
    public _activePromiseCount: number = 0;

    constructor(params: PromisePoolGroupParams) {
        // Finish the configuration afterwards because otherwise the promises will trigger during creation
        this.configure(params);
        this._pool = params.pool;
        this._triggerCallback = params.triggerPromises;
    }

    /**
     * Configures the group and triggers promises to run if applicable.
     */
    public configure(params: PromisePoolGroupConfig): void {
        this._configure(params);
        if (this._triggerCallback) {
            this._triggerCallback();
        }
    }

    /**
     * Configures the group without triggering promises to run.
     */
    public _configure(params: PromisePoolGroupConfig): void {
        let concurrencyLimit: number = Infinity;
        let frequencyLimit: number = Infinity;
        let frequencyWindow: number = 0;

        if (!isNull(params.concurrencyLimit)) {
            if (!params.concurrencyLimit || typeof params.concurrencyLimit !== "number" || params.concurrencyLimit <= 0) {
                throw new Error("Invalid concurrency limit: " + params.concurrencyLimit);
            }
            concurrencyLimit = params.concurrencyLimit;
        }
        if (!isNull(params.frequencyLimit) || !isNull(params.frequencyWindow)) {
            if (isNull(params.frequencyLimit) || isNull(params.frequencyWindow)) {
                throw new Error("Both frequencyLimit and frequencyWindow must be set at the same time.");
            }
            if (!params.frequencyLimit || typeof params.frequencyLimit !== "number" || params.frequencyLimit <= 0) {
                throw new Error("Invalid frequency limit: " + params.frequencyLimit);
            }
            if (!params.frequencyWindow || typeof params.frequencyWindow !== "number" || params.frequencyWindow <= 0) {
                throw new Error("Invalid frequency window: " + params.frequencyWindow);
            }
            frequencyLimit = params.frequencyLimit;
            frequencyWindow = params.frequencyWindow;
        }

        this._concurrencyLimit = concurrencyLimit;
        this._frequencyLimit = frequencyLimit;
        this._frequencyWindow = frequencyWindow;
    }

    /**
     * Cleans out old entries from the frequencyStarts array. Uses a passed timestamp to ensure consistency between
     * groups.
     */
    public _cleanFrequencyStarts(now: number): void {
        // Remove the frequencyStarts entries which are outside of the window
        if (this._frequencyStarts.length > 0) {
            let time: number = now - this._frequencyWindow;
            let i: number = 0;
            while (i < this._frequencyStarts.length && this._frequencyStarts[i] <= time) {
                i++;
            }
            if (i > 0) {
                this._frequencyStarts.splice(0, i);
            }
        }
    }

    /** 
     * Returns false if the group is available, true if the group is busy for an indeterminate time, or the timestamp
     * of when the group will become available.
     */
    public _busyTime(): boolean | number {
        if (this._activePromiseCount >= this._concurrencyLimit) {
            return true;
        } else if (this._frequencyLimit && this._frequencyStarts.length >= this._frequencyLimit) {
            return this._frequencyStarts[0] + this._frequencyWindow;
        }
        return false;
    }

    /**
     * Resolves all pending waitForIdle promises.
     */
    public _resolve() {
        if (!this._rejection && this._promises.length) {
            this._promises.forEach((promise) => {
                promise.resolve();
            });
            this._promises.length = 0;
        }
    }

    /**
     * Rejects all pending waitForIdle promises using the provided error.
     */
    public _reject(err: TaskError): void {
        if (this._rejection) {
            return;
        }
        this._rejection = err;
        if (this._promises.length) {
            err.handled = true;
            this._promises.forEach((promise) => {
                promise.reject(err.error);
            });
            this._promises.length = 0;
        }
        // The group error state should reset on the next tick
        nextTick(() => {
            delete this._rejection;
        });
    }

    /**
     * Returns a promise which resolves when the group becomes idle.
     */
    public waitForIdle(): Promise<void> {
        if (this._rejection) {
            this._rejection.handled = true;
            return Promise.reject(this._rejection.error);
        }
        if (this._activeTaskCount <= 0) {
            return Promise.resolve();
        }

        const promise: ResolvablePromise<void> = new ResolvablePromise();
        this._promises.push(promise);
        return promise.promise;
    }

    public _incrementTasks(): void {
        this._activeTaskCount++;
    }

    /**
     * Decrements the active tasks, resolving promises if applicable.
     */
    public _decrementTasks(): void {
        this._activeTaskCount--;
        if (this._activeTaskCount < 1) {
            this._resolve();
        }
    }
}

export interface PromisePoolTask<R> {
    configure(params: TaskLimits): void;
    pause(): void;
    resume(): void;
    end(): void;
    getStatus(): TaskStatus;
    promise(): Promise<R>;
}

export enum TaskState {
    /**
     * The task is active promises will be generated by the pool according to the limits set.
     */
    Active,
    /**
     * The task is paused and may be ended or resumed later. Any outstanding promises will continue to run.
     */
    Paused,
    /**
     * The task has completed all the work provided by the generator. The task will terminate when all outstanding
     * promises have ended.
     */
    Exhausted,
    /**
     * All outstanding promises have ended and the result has been returned or an error thrown.
     */
    Terminated,
}

class PromisePoolTaskInternal<R> implements PromisePoolTask<any> {
    private _groups: PromisePoolGroupInternal[];
    private _generator: (invocation: number) => Promise<R> | null;
    private _taskGroup: PromisePoolGroupInternal;
    private _invocations: number = 0;
    private _invocationLimit: number = Infinity;
    private _result: R[] = [];
    private _returnResult: any;
    private _state: TaskState;
    private _rejection?: TaskError;
    private _init: boolean;
    private _promises: Array<ResolvablePromise<any>> = [];
    private _pool: PromisePoolExecutor;
    private _triggerCallback: () => void;
    private _detachCallback: (groups: PromisePoolGroupInternal[]) => void;
    private _resultConverter?: (result: R[]) => any;

    public constructor(params: PromisePoolTaskParams<R>) {
        console.log("Creating task");
        this._pool = params.pool;
        this._triggerCallback = params.triggerPromises;
        this._detachCallback = params.detach;
        this._resultConverter = params.resultConverter;
        this._state = params.paused ? TaskState.Paused : TaskState.Active;

        if (!isNull(params.invocationLimit)) {
            if (typeof params.invocationLimit !== "number") {
                throw new Error("Invalid invocation limit: " + params.invocationLimit);
            }
            this._invocationLimit = params.invocationLimit;
        }
        // Create a group exclusively for this task. This may throw errors.
        this._taskGroup = new PromisePoolGroupInternal(params);
        this._groups = [params.globalGroup, this._taskGroup];
        if (params.groups) {
            const groups = params.groups as PromisePoolGroupInternal[];
            groups.forEach((group) => {
                if (group._pool !== this._pool) {
                    throw new Error("params.groups contains a group belonging to a different pool");
                }
            });
            this._groups.push(...groups);
        }
        this._generator = params.generator;

        // Resolve the promise only after all parameters have been validated
        if (params.invocationLimit <= 0) {
            this.end();
            return;
        }

        this._groups.forEach((group) => {
            group._incrementTasks();
        });

        params.attach(this, this._groups);

        // The creator will trigger the promises to run
    }

    /**
     * Private. Returns false if the task is ready, true if the task is busy with an indeterminate ready time, or the timestamp
     * for when the task will be ready.
     */
    public _busyTime(): boolean | number {
        if (this._state !== TaskState.Active) {
            return true;
        }

        let time: number = 0;
        for (let group of this._groups) {
            const busyTime: boolean | number = group._busyTime();
            if (typeof busyTime === "number") {
                if (busyTime > time) {
                    time = busyTime;
                }
            } else if (busyTime) {
                return true;
            }
        }
        return time ? time : false;
    }

    /**
     * Private. Invokes the task.
     */
    public _run(): void {
        if (this._invocations >= this._invocationLimit) {
            // TODO: Make a test for this
            // This may detach / resolve the task if no promises are active
            this.end();
            return;
        }

        let promise: Promise<any>;
        try {
            promise = this._generator.call(this, this._invocations);
        } catch (err) {
            this._reject(err);
            return;
        }
        if (!promise) {
            if (this._state === TaskState.Active) {
                this.end();
            }
            // Remove the task if needed and start the next task
            return;
        }

        if (!(promise instanceof Promise)) {
            // In case what is returned is not a promise, make it one
            promise = Promise.resolve(promise);
        }
        this._groups.forEach((group) => {
            group._activePromiseCount++;
            if (group._frequencyLimit) {
                group._frequencyStarts.push(Date.now());
            }
        });
        let resultIndex: number = this._invocations;
        this._invocations++;
        if (this._invocations >= this._invocationLimit) {
            // this will not detach the task since there are active promises
            this.end();
        }

        promise.catch((err) => {
            this._reject(err);
            // Resolve
        }).then((result) => {
            this._groups.forEach((group) => {
                group._activePromiseCount--;
            });
            // Avoid storing the result if it is undefined.
            // Some tasks may have countless iterations and never return anything, so this could eat memory.
            if (result !== undefined) {
                this._result[resultIndex] = result;
            }
            if (this._state >= TaskState.Exhausted && this._taskGroup._activePromiseCount <= 0) {
                this.end();
            }
            // Remove the task if needed and start the next task
            this._triggerCallback();
        });
    }

    /**
     * Private. Resolves the task if possible. Should only be called by end()
     */
    private _resolve(): void {
        if (this._rejection) {
            return;
        }
        // Set the length of the resulting array in case some undefined results affected this
        this._result.length = this._invocations;

        this._state = TaskState.Terminated;

        if (this._resultConverter) {
            try {
                this._returnResult = this._resultConverter(this._result);
            } catch (err) {
                this._reject(err);
                return;
            }
        } else {
            this._returnResult = this._result;
        }
        // discard the original array to free memory
        this._result = null;

        if (this._promises.length) {
            this._promises.forEach((promise) => {
                promise.resolve(this._returnResult);
            });
            this._promises.length = 0;
        }
    }

    private _reject(err: any) {
        // Check if the task has already failed
        if (this._rejection) {
            // Unhandled promise rejection
            Promise.reject(err);
            return;
        }

        const taskError: TaskError = {
            error: err,
            handled: false,
        };
        this._rejection = taskError;

        // This may detach the task
        this.end();

        if (this._promises.length) {
            taskError.handled = true;
            this._promises.forEach((promise) => {
                promise.reject(taskError.error);
            });
            this._promises.length = 0;
        }
        this._groups.forEach((group) => {
            group._reject(taskError);
        });

        if (!taskError.handled) {
            // Wait a tick to see if the error gets handled
            nextTick(() => {
                if (!taskError.handled) {
                    // Unhandled promise rejection
                    Promise.reject(taskError.error);
                }
            });
        }
    }

    public configure(params: TaskLimits): void {
        let invocationLimit: number = Infinity;
        let concurrencyLimit: number = Infinity;
        let frequencyLimit: number = Infinity;
        let frequencyWindow: number = 0;

        if (!isNull(params.invocationLimit)) {
            if (typeof params.invocationLimit !== "number") {
                throw new Error("Invalid invocation limit: " + params.invocationLimit);
            }
            invocationLimit = params.invocationLimit;
        }
        // Call the private configure method to avoid triggering a callback
        this._taskGroup._configure(params);

        this._invocationLimit = invocationLimit;

        if (this._invocations >= this._invocationLimit) {
            this.end();
        } else if (this._taskGroup._activeTaskCount > 0) {
            this._triggerCallback();
        }
    }

    /**
     * Returns a promise which resolves when the task completes.
     */
    public promise(): Promise<any> {
        if (this._rejection) {
            this._rejection.handled = true;
            return Promise.reject(this._rejection.error);
        } else if (this._state === TaskState.Terminated) {
            return Promise.resolve(this._returnResult);
        }

        const promise: ResolvablePromise<any> = new ResolvablePromise();
        this._promises.push(promise);
        return promise.promise;
    }

    /**
     * Pauses a running task, preventing any additional promises from being generated.
     */
    public pause(): void {
        if (this._state == TaskState.Active) {
            this._state = TaskState.Paused;
        }
    }

    /**
     * Pauses resumed a paused task, allowing for the generation of additional promises.
     */
    public resume(): void {
        if (this._state == TaskState.Paused) {
            this._state = TaskState.Active;
            this._triggerCallback();
        }
    }

    /**
     * Ends the task. Any promises created by the promise() method will be resolved when all outstanding promises
     * have ended.
     */
    public end(): void {
        // Note that this does not trigger more tasks to run. It can resolve a task though.
        console.log("Ending task");
        if (this._state < TaskState.Terminated && this._taskGroup._activePromiseCount <= 0) {
            this._state = TaskState.Terminated;

            if (this._taskGroup._activeTaskCount > 0) {
                this._groups.forEach((group) => {
                    group._decrementTasks();
                });
                this._detachCallback(this._groups);
            }
            this._resolve();
        } else if (this._state < TaskState.Exhausted) {
            this._state = TaskState.Exhausted;
        }
    }

    /**
     * Gets the current status of the task.
     */
    public getStatus(): TaskStatus {
        const now = Date.now();
        let freeSlots: number = this._invocationLimit - this._invocations;
        this._groups.forEach((group) => {
            let slots = group._concurrencyLimit - group._activePromiseCount;
            if (slots < freeSlots) {
                freeSlots = slots;
            }
            group._cleanFrequencyStarts(now);
            slots = group._frequencyLimit - group._frequencyStarts.length;
            if (slots < freeSlots) {
                freeSlots = slots;
            }
        });

        return {
            activeTaskCount: this._taskGroup._activeTaskCount,
            activePromiseCount: this._taskGroup._activePromiseCount,
            concurrencyLimit: this._taskGroup._concurrencyLimit,
            frequencyLimit: this._taskGroup._frequencyLimit,
            frequencyWindow: this._taskGroup._frequencyWindow,
            invocations: this._invocations,
            invocationLimit: this._invocationLimit,
            freeSlots: freeSlots,
        };
    }
}

export interface GroupStatus extends PromiseLimits {
    activeTaskCount: number;
    /**
     * The current number of active invocations for the task.
     */
    activePromiseCount: number;
    /**
     * The concurrency limit for the task.
     */
    concurrencyLimit: number;
    /**
     * The number of times the task can be invoked before reaching the invocation limit,
     * or the pool or task concurrency limit.
     */
    freeSlots: number;
}

export interface TaskStatus extends GroupStatus {
    /**
     * The number of times the task has been invoked.
     */
    invocations: number;
    /**
     * The maximum number of times the task can be invoked.
     */
    invocationLimit: number;
}

class ResolvablePromise<T> {
    public resolve?: (result?: T) => void;
    public reject?: (err: any) => void;
    public promise: Promise<T>;

    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

export interface ConfigureGroupParams extends PromisePoolGroupConfig {
    groupId: any;
}

export interface ConfigureTaskParams extends PromisePoolGroupConfig {
    taskId: any;
}

interface TaskError {
    error: any;
    handled: any;
}

function isNull(val: any): boolean {
    return val === undefined || val === null;
}

export class PromisePoolExecutor {
    private _nextTriggerTime: number;
    private _nextTriggerTimeout: any;
    /**
     * All tasks which are active or waiting.
     */
    private _tasks: PromisePoolTaskInternal<any>[] = [];
    private _globalGroup: PromisePoolGroupInternal;
    private _groupSet: Set<PromisePoolGroupInternal> = new Set();

    /**
     * Construct a new PromisePoolExecutor object.
     * 
     * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
     */
    constructor(params?: PromisePoolGroupConfig);
    constructor(concurrencyLimit?: number);
    constructor(params?: PromisePoolGroupConfig | number) {
        let groupParams: PromisePoolGroupParams = {
            pool: this,
            triggerPromises: () => this._triggerPromises(),
        };

        if (params !== undefined && params !== null) {
            if (typeof params === "object") {
                groupParams.concurrencyLimit = params.concurrencyLimit;
                groupParams.frequencyLimit = params.frequencyLimit;
                groupParams.frequencyWindow = params.frequencyWindow;
            } else {
                groupParams.concurrencyLimit = params;
            }
        }
        this._globalGroup = new PromisePoolGroupInternal(groupParams);
        this._groupSet.add(this._globalGroup);
    }

    /**
     * The maximum number of promises which are allowed to run at one time.
     */
    public get concurrencyLimit(): number {
        return this._globalGroup._concurrencyLimit;
    }

    public set concurrencyLimit(value: number) {
        if (value === undefined || value === null) {
            value = Infinity;
        } else if (!value || typeof value !== "number" || value <= 0) {
            throw new Error("Invalid concurrency limit: " + value);
        }
        this._globalGroup._concurrencyLimit = value;
        this._triggerPromises();
    }

    /**
     * The number of promises which are active.
     */
    public get activePromiseCount(): number {
        return this._globalGroup._activeTaskCount;
    }
    /**
     * The number of promises which can be invoked before the concurrency limit is reached.
     */
    public get freeSlots(): number {
        return this._globalGroup._concurrencyLimit - this._globalGroup._activePromiseCount;
    }
    /**
     * Returns true if the pool is idling (no active or queued promises).
     */
    public get idling(): boolean {
        return this._globalGroup._activeTaskCount === 0 && this._tasks.length === 0;
    }

    private _updateFrequencyStarts(): void {
        // Remove the frequencyStarts entries which are outside of the window
        const now = Date.now();
        this._groupSet.forEach((group) => {
            group._cleanFrequencyStarts(now);
        });
    }

    /**
     * Private Method: Triggers promises to start.
     */
    private _triggerPromises(): void {
        this._updateFrequencyStarts();

        if (this._nextTriggerTimeout) {
            clearTimeout(this._nextTriggerTimeout);
            this._nextTriggerTimeout = null;
        }

        let taskIndex: number = 0;
        let task: PromisePoolTaskInternal<any[]>;
        let soonest: number = Infinity;
        let busyTime: boolean | number;
        let blocked: boolean;

        while (taskIndex < this._tasks.length) {
            task = this._tasks[taskIndex];
            busyTime = task._busyTime();

            if (busyTime === true) {
                taskIndex++;
            } else if (busyTime) {
                if (busyTime < soonest) {
                    soonest = busyTime;
                }
                taskIndex++;
            } else {
                task._run();
            }
        }

        let time: number;
        if (soonest !== Infinity) {
            time = Date.now();
            if (time >= soonest) {
                return this._triggerPromises();
            }

            this._nextTriggerTime = soonest;
            this._nextTriggerTimeout = setTimeout(() => {
                this._nextTriggerTimeout = null;
                this._nextTriggerTime = 0;
                this._triggerPromises();
            }, soonest - time);
        }
    }

    /** Configures the global limits set for the pool. */
    public configure(params: PromisePoolGroupConfig): void {
        this._globalGroup.configure(params);
    }

    public addGroup(params: PromisePoolGroupConfig): PromisePoolGroup {
        return new PromisePoolGroupInternal({
            ...params,
            pool: this,
            triggerPromises: () => this._triggerPromises(),
        });
    }

    /**
     * General-purpose function for adding a task.
     * 
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the values returned by the task.
     */
    public addGenericTask<I, R>(params: GenericTaskParamsConverted<I, R>): PromisePoolTask<R>;
    public addGenericTask<R>(params: GenericTaskParams<R>): PromisePoolTask<R[]>;
    public addGenericTask<R>(params: GenericTaskParams<R>): PromisePoolTask<R[]> {
        const task: PromisePoolTaskInternal<R> = new PromisePoolTaskInternal({
            ...params,
            pool: this,
            globalGroup: this._globalGroup,
            triggerPromises: () => this._triggerPromises(),
            attach: (task: PromisePoolTaskInternal<R>, groups: PromisePoolGroupInternal[]) => {
                groups.forEach((group) => {
                    this._groupSet.add(group);
                });
                this._tasks.push(task);
            },
            detach: (groups: PromisePoolGroupInternal[]) => {
                const limit: number = groups[TASK_GROUP_INDEX]._activeTaskCount;
                groups.forEach((group) => {
                    if (group._activeTaskCount <= limit && group !== this._globalGroup) {
                        this._groupSet.delete(group);
                    }
                });
                this._removeTask(task);
            },
        });
        this._triggerPromises();
        return task;
    }

    private _removeTask(task: PromisePoolTaskInternal<any>) {
        const i: number = this._tasks.indexOf(task);
        if (i !== -1) {
            console.log("Task removed");
            this._tasks.splice(i, 1);
        }
    }

    /**
     * Runs a task once while obeying the concurrency limit set for the pool.
     * 
     * @param params Parameters used to define the task.
     * @return A promise which resolves to the result of the task.
     */
    public addSingleTask<T, R>(params: SingleTaskParams<T, R>): PromisePoolTask<R> {
        const data: T = params.data;
        return this.addGenericTask<R, R>({
            groups: params.groups,
            paused: params.paused,
            generator: function () {
                return params.generator.call(this, data);
            },
            invocationLimit: 1,
            resultConverter: (result) => result[0],
        });
    }

    /**
     * Runs a task with a concurrency limit of 1.
     * 
     * @param params 
     * @return A promise which resolves to an array containing the results of the task.
     */
    public addLinearTask<T, R>(params: LinearTaskParams<T, R>): PromisePoolTask<R[]> {
        return this.addGenericTask({
            groups: params.groups,
            generator: params.generator,
            invocationLimit: params.invocationLimit,
            concurrencyLimit: 1,
            frequencyLimit: params.frequencyLimit,
            frequencyWindow: params.frequencyWindow,
            paused: params.paused,
        });
    }

    /**
     * Runs a task for batches of elements in array, specifying the batch size to use per invocation.
     * 
     * @param params Parameters used to define the task.
     * @return A promise which resolves to an array containing the results of the task. Each element in the array corresponds to one invocation.
     */
    public addBatchTask<T, R>(params: BatchTaskParams<T, R>): PromisePoolTask<R[]> {
        let index: number = 0;

        // Unacceptable values: NaN, <=0, type not number/function
        if (!params.batchSize || typeof params.batchSize !== "function"
            && (typeof params.batchSize !== "number" || params.batchSize <= 0)) {

            throw new Error("Invalid batch size: " + params.batchSize);
        }

        return this.addGenericTask({
            groups: params.groups,
            concurrencyLimit: params.concurrencyLimit,
            frequencyLimit: params.frequencyLimit,
            frequencyWindow: params.frequencyWindow,
            invocationLimit: params.invocationLimit,
            paused: params.paused,
            generator: function (invocation) {
                if (index >= params.data.length) {
                    return null;
                }
                let oldIndex: number = index;
                if (typeof params.batchSize === "function") {
                    let status: TaskStatus = this.getStatus();
                    let batchSize: number = params.batchSize(
                        params.data.length - oldIndex,
                        status.freeSlots,
                    );
                    // Unacceptable values: NaN, <=0, type not number
                    if (!batchSize || typeof batchSize !== "number" || batchSize <= 0) {
                        return Promise.reject(new Error("Invalid batch size: " + batchSize));
                    }
                    index += batchSize;
                } else {
                    index += params.batchSize;
                }

                return params.generator.call(this, params.data.slice(oldIndex, index), oldIndex, invocation);
            },
        });
    }

    /**
     * Runs a task for each element in an array.
     * 
     * @param params 
     * @return A promise which resolves to an array containing the results of the task.
     */
    public addEachTask<T, R>(params: EachTaskParams<T, R>): PromisePoolTask<R[]> {
        return this.addGenericTask({
            groups: params.groups,
            concurrencyLimit: params.concurrencyLimit,
            frequencyLimit: params.frequencyLimit,
            frequencyWindow: params.frequencyWindow,
            invocationLimit: params.invocationLimit,
            paused: params.paused,
            generator: function (index) {
                if (index >= params.data.length) {
                    return null;
                }
                let oldIndex: number = index;
                index++;
                return params.generator.call(this, params.data[oldIndex], oldIndex);
            },
        });
    }

    public addPersistentBatchTask<I, O>(params: PersistentBatcherTaskParams<I, O>): PersistentBatcherTask<I, O> {
        return new PersistentBatchTaskInternal(this, params);
    }

    /**
     * Returns a promise which resolves when there are no more tasks queued to run.
     */
    public waitForIdle(): Promise<void> {
        return this._globalGroup.waitForIdle();
    }
}

export interface PersistentBatcherTaskParams<I, O> extends PromisePoolGroupConfig {
    maxBatchSize?: number;
    queuingDelay?: number;
    queuingThresholds?: number[];
    generator: (input: I[]) => Promise<(O | Error)[]>;
}

export interface PersistentBatcherTask<I, O> {
    getResult(input: I): Promise<O>;
    end(): void;
    getStats(): TaskStatus;
    configure(params: TaskLimits): void;
}

class PersistentBatchTaskInternal<I, O> implements PersistentBatcherTask<I, O> {
    private _task: PromisePoolTask<any>;
    private _maxBatchSize: number = Infinity;
    private _queuingDelay: number = 1;
    private _queuingThresholds: number[];
    private _activePromiseCount: number = 0;
    private _inputQueue: I[] = [];
    private _outputPromises: ResolvablePromise<O>[] = [];
    private _generator: (input: I[]) => Promise<(O | Error)[]>;
    private _runTimeout: NodeJS.Timer;
    private _running: boolean = false;

    constructor(pool: PromisePoolExecutor, params: PersistentBatcherTaskParams<I, O>) {
        const batcher = this;
        this._generator = params.generator;
        if (Array.isArray(params.queuingThresholds)) {
            if (!params.queuingThresholds.length) {
                throw new Error("params.batchThresholds must contain at least one number");
            }
            params.queuingThresholds.forEach((n) => {
                if (n < 1) {
                    throw new Error("params.batchThresholds must not contain numbers less than 1");
                }
            })
            this._queuingThresholds = [...params.queuingThresholds];
        } else {
            this._queuingThresholds = [1];
        }
        if (!isNull(params.maxBatchSize)) {
            if (params.maxBatchSize < 1) {
                throw new Error("params.batchSize must be greater than 0");
            }
            this._maxBatchSize = params.maxBatchSize;
        }
        if (!isNull(params.queuingDelay)) {
            this._queuingDelay = params.queuingDelay;
        }

        this._task = pool.addGenericTask({
            concurrencyLimit: params.concurrencyLimit,
            frequencyLimit: params.frequencyLimit,
            frequencyWindow: params.frequencyWindow,
            paused: true,
            generator: function () {
                batcher._running = false;
                batcher._activePromiseCount++;
                const inputs = batcher._inputQueue.splice(0, batcher._maxBatchSize);
                const outputPromises = batcher._outputPromises.splice(0, batcher._maxBatchSize);

                // Prepare for the next iteration, pausing the task if needed
                batcher._run();
                if (!batcher._running || batcher._runTimeout) {
                    batcher._task.pause();
                }

                let batchPromise;
                try {
                    batchPromise = batcher._generator(inputs);
                    if (!(batchPromise instanceof Promise)) {
                        batchPromise = Promise.resolve(batchPromise);
                    }
                } catch (err) {
                    batchPromise = Promise.reject(err);
                }

                return batchPromise.then((outputs) => {
                    if (outputs.length !== outputPromises.length) {
                        // TODO: Add a test for this
                        throw new Error("Generator function output length does not equal the input length.");
                    }
                    outputPromises.forEach((promise, index) => {
                        const output = outputs[index];
                        if (output instanceof Error) {
                            promise.reject(output);
                        } else {
                            promise.resolve(output);
                        }
                    });
                }).catch((err) => {
                    outputPromises.forEach((promise) => {
                        promise.reject(err);
                    });
                }).then(() => {
                    batcher._activePromiseCount--;
                    // Since we may be operating at a lower queuing threshold now, we should try run again
                    batcher._run();
                });
            },
        });
    }

    public getResult(input: I): Promise<O> {
        const index = this._inputQueue.length;
        this._inputQueue[index] = input;
        const promise = new ResolvablePromise<O>();
        this._outputPromises[index] = promise;
        this._run();
        return promise.promise;
    }

    private _run(): void {
        // If the queue has reached the maximum batch size, start it immediately
        if (this._inputQueue.length >= this._maxBatchSize) {
            if (this._runTimeout) {
                clearTimeout(this._runTimeout);
                this._runTimeout = null;
            }
            this._running = true;
            this._task.resume();
            return;
        }
        if (this._running) {
            return;
        }
        const thresholdIndex: number = Math.min(this._activePromiseCount, this._queuingThresholds.length - 1);
        if (this._inputQueue.length >= this._queuingThresholds[thresholdIndex]) {
            // Run the batch, but with a delay
            this._running = true;
            this._runTimeout = setTimeout(() => {
                this._runTimeout = null;
                this._task.resume();
            }, this._queuingDelay);
        }
    }

    public end(): void {
        this._task.end();
    }

    public getStats(): TaskStatus {
        return this._task.getStatus();
    }

    public configure(params: TaskLimits): void {
        this._task.configure(params);
    }
}