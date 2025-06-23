import assert from "assert/strict";
import util from "util";
import { PromisePoolExecutor } from "../public/pool";
import { GenericTaskConvertedOptions, PromisePoolTask, TaskState } from "../public/task";
import { PromisePoolGroupPrivate } from "./group";
import { OptionalDeferredPromise } from "./optional-defer";
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
	private readonly _result: I[] = [];
	private readonly _taskGroup: PromisePoolGroupPrivate;
	private _invocations = 0;
	private _invocationLimit!: number;
	private _state: TaskState;
	/**
	 * Set to true while the generator function is being run. Prevents the task from being terminated since a final
	 * promise may be generated.
	 */
	private _generating?: boolean;
	private readonly _deferred = new OptionalDeferredPromise<R>();
	private readonly _pool: PromisePoolExecutor;
	private readonly _triggerCallback: () => void;
	private readonly _detachCallback: () => void;
	private readonly _resultConverter?: (result: readonly I[]) => R;

	public constructor(privateOptions: GenericTaskOptionsPrivate, options: GenericTaskConvertedOptions<I, R>) {
		debug("Creating task");
		this._pool = privateOptions.pool;
		this._resultConverter = options.resultConverter;
		this._state = options.paused ? TaskState.Paused : TaskState.Active;

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

		// This may terminate the task
		this.invocationLimit = isNull(options.invocationLimit) ? Infinity : options.invocationLimit;

		if ((this._state as TaskState) !== TaskState.Terminated) {
			for (const group of this._groups) {
				group._incrementTasks();
			}
		}
		this._detachCallback = privateOptions.detach;
		this._triggerCallback = privateOptions.triggerNowCallback;
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
		return this._deferred.promise();
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
			this._detachCallback?.();
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
		assert(!this._generating, "Internal Error: Task is already being run");
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
				if (result !== undefined) {
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
		// Set the length of the resulting array in case some undefined results affected this
		this._result.length = this._invocations;

		this._state = TaskState.Terminated;

		let returnResult: R;
		if (this._resultConverter) {
			try {
				returnResult = this._resultConverter(this._result);
			} catch (err) {
				this._reject(err);
				return;
			}
		} else {
			returnResult = this._result as R;
		}
		this._deferred.resolve(returnResult);
	}

	private _reject(err: unknown) {
		const promise = Promise.reject(err);
		this._deferred.resolve(promise);
		for (const group of this._groups) {
			group._reject(promise);
		}
		this.end();
	}
}
