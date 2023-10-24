import defer, { DeferredPromise } from "p-defer";
import util from "util";
import { PromisePoolExecutor } from "../public/pool";
import { GenericTaskConvertedOptions, PromisePoolTask, TaskState } from "../public/task";
import { PromisePoolGroupPrivate } from "./group";
import { isNull } from "./utils";

const debug = util.debuglog("promise-pool-executor:task");

export interface GenericTaskOptionsPrivate {
	readonly pool: PromisePoolExecutor;
	readonly globalGroup: PromisePoolGroupPrivate;
	readonly triggerNowCallback: () => void;
	readonly detach: () => void;
}

export class PromisePoolTaskPrivate<R, I = R> implements PromisePoolTask<R> {
	private readonly _groups: PromisePoolGroupPrivate[];
	private readonly _generator: (invocation: number) => I | PromiseLike<I> | undefined | null | void;
	private readonly _taskGroup: PromisePoolGroupPrivate;
	private _invocations = 0;
	private _invocationLimit!: number;
	private _result?: I[] = [];
	private _returnResult?: R;
	private _state: TaskState;
	private _rejection?: Promise<never>;
	/**
	 * Set to true while the generator function is being run. Prevents the task from being terminated since a final
	 * promise may be generated.
	 */
	private _generating?: boolean;
	private readonly _deferreds: Array<DeferredPromise<R>> = [];
	private readonly _pool: PromisePoolExecutor;
	private readonly _triggerCallback: () => void;
	private readonly _detachCallback: () => void;
	private readonly _resultConverter?: (result: readonly I[]) => R;

	public constructor(privateOptions: GenericTaskOptionsPrivate, options: GenericTaskConvertedOptions<I, R>) {
		debug("Creating task");
		this._pool = privateOptions.pool;
		this._triggerCallback = privateOptions.triggerNowCallback;
		this._detachCallback = privateOptions.detach;
		this._resultConverter = options.resultConverter;
		this._state = options.paused ? TaskState.Paused : TaskState.Active;

		this.invocationLimit = isNull(options.invocationLimit) ? Infinity : options.invocationLimit;
		// Create a group exclusively for this task. This may throw errors.
		this._taskGroup = privateOptions.pool.addGroup(options) as PromisePoolGroupPrivate;
		this._groups = [privateOptions.globalGroup, this._taskGroup];
		if (options.groups) {
			const groups = options.groups as PromisePoolGroupPrivate[];
			for (const group of groups) {
				if (group._pool !== this._pool) {
					throw new Error("options.groups contains a group belonging to a different pool");
				}
			}
			this._groups.push(...groups);
		}
		// eslint-disable-next-line @typescript-eslint/unbound-method
		this._generator = options.generator;

		// Resolve the promise only after all options have been validated
		if (!isNull(options.invocationLimit) && options.invocationLimit <= 0) {
			this.end();
			return;
		}

		for (const group of this._groups) {
			group._incrementTasks();
		}

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

	public set invocationLimit(v: number) {
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error("Invalid invocationLimit: " + v);
		}
		this._invocationLimit = v;
		if (this._invocations >= this._invocationLimit) {
			this.end();
		}
		this._triggerCallback?.();
	}

	public get concurrencyLimit(): number {
		return this._taskGroup.concurrencyLimit;
	}

	public set concurrencyLimit(v: number) {
		this._taskGroup.concurrencyLimit = v;
	}

	public get frequencyLimit(): number {
		return this._taskGroup.frequencyLimit;
	}

	public set frequencyLimit(v: number) {
		this._taskGroup.frequencyLimit = v;
	}

	public get frequencyWindow(): number {
		return this._taskGroup.frequencyWindow;
	}

	public set frequencyWindow(v: number) {
		this._taskGroup.frequencyWindow = v;
	}

	public get freeSlots(): number {
		let freeSlots: number = this._invocationLimit - this._invocations;
		for (const group of this._groups) {
			const slots = group.freeSlots;
			if (slots < freeSlots) {
				freeSlots = slots;
			}
		}
		return freeSlots;
	}

	public get state(): TaskState {
		return this._state;
	}

	/**
	 * Returns a promise which resolves when the task completes.
	 */
	public async promise(): Promise<R> {
		if (this._rejection) {
			return this._rejection;
		} else if (this._state === TaskState.Terminated) {
			return this._returnResult!;
		}

		const deferred = defer<R>();
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
				for (const group of this._groups) {
					group._decrementTasks();
				}
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

		let time = 0;
		for (const group of this._groups) {
			const busyTime = group._busyTime();
			if (busyTime > time) {
				time = busyTime;
			}
		}
		return time;
	}

	public _cleanFrequencyStarts(now: number): void {
		const groups = this._groups.values();
		// Skip the global group
		groups.next();
		for (const group of groups) {
			group._cleanFrequencyStarts(now);
		}
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

		let promise: PromiseLike<I> | I | undefined | null | void;
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

		for (const group of this._groups) {
			group._activePromiseCount++;
			if (group._frequencyLimit !== Infinity) {
				group._frequencyStarts.push(Date.now());
			}
		}
		// TODO: Remove inferrable typing. Use linting rule?
		const resultIndex = this._invocations;
		this._invocations++;
		if (this._invocations >= this._invocationLimit) {
			// this will not detach the task since there are active promises
			this.end();
		}

		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		(async () => {
			let result: I | undefined;
			try {
				result = await (promise as PromiseLike<I>);
			} catch (err) {
				this._reject(err);
			} finally {
				debug("Promise ended.");
				for (const group of this._groups) {
					group._activePromiseCount--;
				}
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
			}
		})();
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
			this._returnResult = this._result as R;
		}
		// discard the original array to free memory
		this._result = undefined;

		if (this._deferreds.length) {
			for (const deferred of this._deferreds) {
				deferred.resolve(this._returnResult);
			}
			this._deferreds.length = 0;
		}
	}

	private _reject(err: unknown) {
		// Check if the task has already failed
		if (this._rejection) {
			debug("This task already failed. Redundant error: %O", err);
			return;
		}

		const promise = Promise.reject(err);
		this._rejection = promise;

		// This may detach the task
		this.end();

		if (this._deferreds.length) {
			for (const deferred of this._deferreds) {
				deferred.resolve(promise);
			}
			this._deferreds.length = 0;
		}
		for (const group of this._groups) {
			group._reject(promise);
		}
	}
}
