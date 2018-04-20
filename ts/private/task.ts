import * as Debug from "debug";
import defer = require("p-defer");
import { PromisePoolExecutor } from "../public/pool";
import { GenericTaskConvertedOptions, GenericTaskOptions, PromisePoolTask, TaskState } from "../public/task";
import { PromisePoolGroupPrivate } from "./group";
import { isNull, TaskError } from "./utils";

const debug = Debug("promise-pool-executor:task");

const GLOBAL_GROUP_INDEX = 0;

export interface GenericTaskOptionsPrivate {
    pool: PromisePoolExecutor;
    globalGroup: PromisePoolGroupPrivate;
    triggerNowCallback: () => void;
    detach: () => void;
}

export class PromisePoolTaskPrivate<R> implements PromisePoolTask<any> {
    private _groups: PromisePoolGroupPrivate[];
    private _generator: (invocation: number) => R | PromiseLike<R> | undefined | null | void;
    private _taskGroup: PromisePoolGroupPrivate;
    private _invocations: number = 0;
    private _invocationLimit: number = Infinity;
    private _result?: R[] = [];
    private _returnResult: any;
    private _state: TaskState;
    private _rejection?: TaskError;
    /**
     * Set to true while the generator function is being run. Prevents the task from being terminated since a final
     * promise may be generated.
     */
    private _generating?: boolean;
    private _deferreds: Array<Deferred<any>> = [];
    private _pool: PromisePoolExecutor;
    private _triggerCallback: () => void;
    private _detachCallback: () => void;
    private _resultConverter?: (result: R[]) => any;

    public constructor(
        privateOptions: GenericTaskOptionsPrivate,
        options: GenericTaskOptions<R> | GenericTaskConvertedOptions<any, R>,
    ) {
        debug("Creating task");
        this._pool = privateOptions.pool;
        this._triggerCallback = privateOptions.triggerNowCallback;
        this._detachCallback = privateOptions.detach;
        this._resultConverter = (options as GenericTaskConvertedOptions<any, R>).resultConverter;
        this._state = options.paused ? TaskState.Paused : TaskState.Active;

        if (!isNull(options.invocationLimit)) {
            if (typeof options.invocationLimit !== "number") {
                throw new Error("Invalid invocation limit: " + options.invocationLimit);
            }
            this._invocationLimit = options.invocationLimit;
        }
        // Create a group exclusively for this task. This may throw errors.
        this._taskGroup = privateOptions.pool.addGroup(options) as PromisePoolGroupPrivate;
        this._groups = [privateOptions.globalGroup, this._taskGroup];
        if (options.groups) {
            const groups = options.groups as PromisePoolGroupPrivate[];
            groups.forEach((group) => {
                if (group._pool !== this._pool) {
                    throw new Error("options.groups contains a group belonging to a different pool");
                }
            });
            this._groups.push(...groups);
        }
        this._generator = options.generator;

        // Resolve the promise only after all options have been validated
        if (!isNull(options.invocationLimit) && options.invocationLimit <= 0) {
            this.end();
            return;
        }

        this._groups.forEach((group) => {
            group._incrementTasks();
        });

        // The creator will trigger the promises to run
    }

    public get activePromiseCount(): number {
        return this._taskGroup._activePromiseCount;
    }

    public get invocations(): number {
        return this._invocations;
    }

    public get invocationLimit(): number {
        return this._invocationLimit;
    }

    public set invocationLimit(val: number) {
        if (isNull(val)) {
            this._invocationLimit = Infinity;
        } else if (!isNaN(val) && typeof val === "number" && val >= 0) {
            this._invocationLimit = val;
            if (this._invocations >= this._invocationLimit) {
                this.end();
            }
        } else {
            throw new Error("Invalid invocation limit: " + val);
        }
        if (this._triggerCallback) {
            this._triggerCallback();
        }
    }

    public get concurrencyLimit(): number {
        return this._taskGroup.concurrencyLimit;
    }

    public set concurrencyLimit(val: number) {
        this._taskGroup.concurrencyLimit = val;
    }

    public get frequencyLimit(): number {
        return this._taskGroup.frequencyLimit;
    }

    public set frequencyLimit(val: number) {
        this._taskGroup.frequencyLimit = val;
    }

    public get frequencyWindow(): number {
        return this._taskGroup.frequencyWindow;
    }

    public set frequencyWindow(val: number) {
        this._taskGroup.frequencyWindow = val;
    }

    public get freeSlots(): number {
        let freeSlots: number = this._invocationLimit - this._invocations;
        this._groups.forEach((group) => {
            const slots = group.freeSlots;
            if (slots < freeSlots) {
                freeSlots = slots;
            }
        });
        return freeSlots;
    }

    public get state(): TaskState {
        return this._state;
    }

    /**
     * Returns a promise which resolves when the task completes.
     */
    public promise(): Promise<any> {
        if (this._rejection) {
            if (this._rejection.promise) {
                // First handling of this rejection. Return the unhandled promise.
                const promise = this._rejection.promise;
                this._rejection.promise = undefined;
                return promise;
            }
            return Promise.reject(this._rejection.error);
        } else if (this._state === TaskState.Terminated) {
            return Promise.resolve(this._returnResult);
        }

        const deferred: Deferred<any> = defer();
        this._deferreds.push(deferred);
        return deferred.promise;
    }

    /**
     * Pauses an active task, preventing any additional promises from being generated.
     */
    public pause(): void {
        if (this._state === TaskState.Active) {
            debug("State: %o", "Paused");
            this._state = TaskState.Paused;
        }
    }

    /**
     * Resumes a paused task, allowing for the generation of additional promises.
     */
    public resume(): void {
        if (this._state === TaskState.Paused) {
            debug("State: %o", "Active");
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
        if (this._state < TaskState.Exhausted) {
            debug("State: %o", "Exhausted");
            this._state = TaskState.Exhausted;
            if (this._taskGroup._activeTaskCount > 0) {
                this._detachCallback();
            }
        }
        if (!this._generating && this._state < TaskState.Terminated && this._taskGroup._activePromiseCount <= 0) {
            debug("State: %o", "Terminated");
            this._state = TaskState.Terminated;

            if (this._taskGroup._activeTaskCount > 0) {
                this._groups.forEach((group) => {
                    group._decrementTasks();
                });
            }
            this._resolve();
        }
    }

    /**
     * Private. Returns 0 if the task is ready, Infinity if the task is busy with an indeterminate ready time, or the
     * timestamp for when the task will be ready.
     */
    public _busyTime(): number {
        if (this._state !== TaskState.Active) {
            return Infinity;
        }

        let time: number = 0;
        for (const group of this._groups) {
            const busyTime: number = group._busyTime();
            if (busyTime > time) {
                time = busyTime;
            }
        }
        return time;
    }

    public _cleanFrequencyStarts(now: number): void {
        this._groups.forEach((group, index) => {
            if (index > GLOBAL_GROUP_INDEX) {
                group._cleanFrequencyStarts(now);
            }
        });
    }

    /**
     * Private. Invokes the task.
     */
    public _run(): void {
        if (this._generating) {
            // This should never happen
            throw new Error("Internal Error: Task is already being run");
        }
        if (this._invocations >= this._invocationLimit) {
            // TODO: Make a test for this
            // This may detach / resolve the task if no promises are active
            this.end();
            return;
        }
        debug("Running generator");

        let promise: Promise<any>;
        this._generating = true; // prevent task termination
        try {
            promise = this._generator.call(this, this._invocations);
        } catch (err) {
            this._generating = false;
            this._reject(err);
            return;
        }
        this._generating = false;
        if (isNull(promise)) {
            if (this._state !== TaskState.Paused) {
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
            if (group._frequencyLimit !== Infinity) {
                group._frequencyStarts.push(Date.now());
            }
        });
        const resultIndex: number = this._invocations;
        this._invocations++;
        if (this._invocations >= this._invocationLimit) {
            // this will not detach the task since there are active promises
            this.end();
        }

        promise.catch((err) => {
            this._reject(err);
            // Resolve
        }).then((result) => {
            debug("Promise ended.");
            this._groups.forEach((group) => {
                group._activePromiseCount--;
            });
            debug("Promise Count: %o", this._taskGroup._activePromiseCount);
            // Avoid storing the result if it is undefined.
            // Some tasks may have countless iterations and never return anything, so this could eat memory.
            if (result !== undefined && this._result) {
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
        if (this._rejection || !this._result) {
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
        this._result = undefined;

        if (this._deferreds.length) {
            this._deferreds.forEach((deferred) => {
                deferred.resolve(this._returnResult);
            });
            this._deferreds.length = 0;
        }
    }

    private _reject(err: any) {
        // Check if the task has already failed
        if (this._rejection) {
            debug("This task already failed. Redundant error: %O", err);
            return;
        }

        const taskError: TaskError = {
            error: err,
        };
        this._rejection = taskError;
        let handled = false;

        // This may detach the task
        this.end();

        if (this._deferreds.length) {
            handled = true;
            this._deferreds.forEach((deferred) => {
                deferred.reject(taskError.error);
            });
            this._deferreds.length = 0;
        }
        this._groups.forEach((group) => {
            if (group._reject(taskError)) {
                handled = true;
            }
        });

        if (!handled) {
            // Create an unhandled rejection which may be handled later
            taskError.promise = Promise.reject(err);
        }
    }
}
