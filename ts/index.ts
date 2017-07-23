const nextTick = require("next-tick");

const TASK_GROUP_INDEX = 1;

export interface TaskGeneral {
    /**
     * An array of values, each of which identifies a group the task belongs to. These groups can be used to respond
     * to the completion of a larger task.
     */
    groups?: PromisePoolGroup[];
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
    private _triggerPromises: () => void;
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
        this._triggerPromises = params.triggerPromises;
    }

    public configure(params: PromisePoolGroupConfig): void {
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

        if (this._triggerPromises) {
            this._triggerPromises();
        }
    }

    public _updateFrequencyStarts(): void {
        // Remove the frequencyStarts entries which are outside of the window
        if (this._frequencyStarts.length > 0) {
            let time: number = Date.now() - this._frequencyWindow;
            let i: number = 0;
            for (; i < this._frequencyStarts.length; i++) {
                if (this._frequencyStarts[i] > time) {
                    break;
                }
            }
            if (i > 0) {
                this._frequencyStarts.splice(0, i);
            }
        }
    }

    public _busyTime(): boolean | number {
        if (this._activePromiseCount >= this._concurrencyLimit) {
            return true;
        } else if (this._frequencyLimit && this._frequencyStarts.length >= this._frequencyLimit) {
            return this._frequencyStarts[0] + this._frequencyWindow;
        }
        return false;
    }

    public _resolve() {
        if (!this._rejection && this._promises.length) {
            this._promises.forEach((promise) => {
                promise.resolve();
            });
            this._promises.length = 0;
        }
    }

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

    public _decrementTasks(): void {
        this._activeTaskCount--;
        if (this._activeTaskCount < 1) {
            this._resolve();
        }
    }
}

export interface PromisePoolTaskBase {
    configure(params: PromisePoolGroupConfig): void;
    end(): void;
    getStatus(): TaskStatus;
}

export interface PromisePoolTask<R> extends PromisePoolTaskBase {
    promise(): Promise<R>;
}

export interface PromisePoolSingleTask<R> extends PromisePoolTaskBase {
    promise(): Promise<R>;
}

class PromisePoolTaskInternal<R> implements PromisePoolTask<any> {
    private _groups: PromisePoolGroupInternal[];
    private _generator: (invocation: number) => Promise<R> | null;
    private _taskGroup: PromisePoolGroupInternal;
    private _invocations: number = 0;
    private _invocationLimit: number = Infinity;
    private _result: R[] = [];
    private _returnResult: any;
    private _exhausted?: boolean;
    private _rejection?: TaskError;
    private _init: boolean;
    private _promises: Array<ResolvablePromise<any>> = [];
    private _pool: PromisePoolExecutor;
    private _triggerPromises: () => void;
    private _detachCallback: (groups: PromisePoolGroupInternal[]) => void;
    private _resultConverter?: (result: R[]) => any;

    // addGenericTask

    public constructor(params: PromisePoolTaskParams<R>) {
        this._pool = params.pool;
        this._triggerPromises = params.triggerPromises;
        this._detachCallback = params.detach;
        this._resultConverter = params.resultConverter;

        if (!isNull(params.invocationLimit)) {
            if (typeof params.invocationLimit !== "number") {
                throw new Error("Invalid invocation limit: " + params.invocationLimit);
            }
            this._invocationLimit = params.invocationLimit;
        }
        this._taskGroup = new PromisePoolGroupInternal(params);
        this._groups = [params.globalGroup, this._taskGroup];
        if (params.groups) {
            const groups = params.groups as PromisePoolGroupInternal[];
            groups.forEach((group) => {
                if (group._pool !== this._pool) {
                    // TODO: Make a test for this
                    throw new Error("params.groups contains a group belonging to a different pool");
                }
            });
            this._groups.push(...groups);
        }
        this._generator = params.generator;

        if (params.invocationLimit <= 0) {
            this._resolve();
            return;
        }

        this._groups.forEach((group) => {
            group._incrementTasks();
        });

        params.attach(this, this._groups);

        // The creator will trigger the promises to run
    }

    public _busyTime(): boolean | number {
        if (this._exhausted) {
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
            this.end();
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
            this._result[resultIndex] = result;
            if (this._exhausted && this._taskGroup._activePromiseCount <= 0) {
                this._detach();
            }
            // Remove the task if needed and start the next task
            this._triggerPromises();
        });
    }

    private _resolve(): void {
        if (this._rejection) {
            return;
        }
        this.end();

        if (this._resultConverter) {
            try {
                this._returnResult = this._resultConverter(this._result);
            } catch (err) {
                return this._reject(err);
            }
        } else {
            this._returnResult = this._result;
        }

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
        this._taskGroup.configure(params);

        this._invocationLimit = invocationLimit;
        if (this._taskGroup._activeTaskCount > 0) {
            this._run();
        }
        if (!isNull(params.invocationLimit) && params.invocationLimit <= 0) {
            this.end();
            return;
        }
    }

    public promise(): Promise<R[]> {
        if (this._exhausted) {
            if (this._rejection) {
                this._rejection.handled = true;
                return Promise.reject(this._rejection.error);
            } else if (this._taskGroup._activePromiseCount < 1) {
                return Promise.resolve(this._returnResult);
            }
        }

        const promise: ResolvablePromise<R[]> = new ResolvablePromise();
        this._promises.push(promise);
        return promise.promise;
    }

    public end() {
        console.log("Ending task");
        if (!this._exhausted) {
            this._exhausted = true;
        }
        if (this._taskGroup._activePromiseCount <= 0) {
            this._detach();
        }
    }

    private _detach() {
        if (this._taskGroup._activeTaskCount > 0) {
            this._groups.forEach((group) => {
                group._decrementTasks();
            });
            this._detachCallback(this._groups);
            this._resolve();
        }
    }

    public getStatus(): TaskStatus {
        let freeSlots: number = this._invocationLimit - this._invocations;
        this._groups.forEach((group) => {
            let slots = group._concurrencyLimit - group._activePromiseCount;
            if (slots < freeSlots) {
                freeSlots = slots;
            }
            group._updateFrequencyStarts();
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

export interface GroupStatus {
    /**
     * The current number of active invocations for the task.
     */
    activePromiseCount: number;
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
        this._groupSet.forEach((group) => {
            group._updateFrequencyStarts();
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
    public addSingleTask<T, R>(params: SingleTaskParams<T, R>): PromisePoolSingleTask<R> {
        return this.addGenericTask<R, R>({
            groups: params.groups,
            generator: function () {
                return params.generator.call(this, params.data);
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
            concurrencyLimit: params.concurrencyLimit,
            frequencyLimit: params.frequencyLimit,
            frequencyWindow: params.frequencyWindow,
            invocationLimit: params.invocationLimit,
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
            generator: function (index) {
                if (index >= params.data.length) {
                    return null;
                }
                let oldIndex: number = index;
                index++;
                return params.generator.call(this, params.data[oldIndex], oldIndex);
            },
            concurrencyLimit: params.concurrencyLimit,
            frequencyLimit: params.frequencyLimit,
            frequencyWindow: params.frequencyWindow,
            invocationLimit: params.invocationLimit,
        });
    }

    /**
     * Returns a promise which resolves when there are no more tasks queued to run.
     */
    public waitForIdle(): Promise<void> {
        return this._globalGroup.waitForIdle();
    }
}
