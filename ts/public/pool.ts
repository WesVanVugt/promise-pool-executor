import util from "util";
import { PromisePoolGroupPrivate } from "../private/group";
import { PersistentBatchTaskPrivate } from "../private/persistent-batch";
import { PromisePoolTaskPrivate } from "../private/task";
import { isNull } from "../private/utils";
import { FrequencyLimit, PromisePoolGroup, PromisePoolGroupOptions } from "./group";
import { PersistentBatchTask, PersistentBatchTaskOptions } from "./persistent-batch";
import {
	GenericTaskConvertedOptions,
	GenericTaskOptions,
	InvocationLimit,
	PromisePoolTask,
	TaskOptionsBase,
	TaskState,
} from "./task";

const debug = util.debuglog("promise-pool-executor:pool");
debug("booting %o", "promise-pool-executor");
let warnedThrottle = false;

export interface SingleTaskOptions<T, R> extends TaskOptionsBase {
	/**
	 * Optional data to pass to the generator function as a parameter.
	 */
	data?: T;
	/**
	 * A function used for creating promises to run.
	 */
	generator(this: PromisePoolTask<unknown>, data: T): R | PromiseLike<R> | undefined | null | void;
}

export interface LinearTaskOptions<R> extends TaskOptionsBase, Partial<FrequencyLimit>, Partial<InvocationLimit> {
	/**
	 * A function used for creating promises to run.
	 * If the function returns undefined, the task will be flagged as completed unless it is in a paused state.
	 * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each
	 * promise returned.
	 */
	generator: (this: PromisePoolTask<unknown>, invocation: number) => R | PromiseLike<R> | undefined | null | void;
}

export interface BatchTaskOptions<T, R> extends TaskOptionsBase, PromisePoolGroupOptions, Partial<InvocationLimit> {
	/**
	 * A function used for creating promises to run.
	 * If the function returns undefined, the task will be flagged as completed unless it is in a paused state.
	 * @param {T[]} values - Elements from {data} batched for this invocation.
	 * @param startIndex The original index for the first element in {values}.
	 */
	generator: (
		this: PromisePoolTask<unknown>,
		values: T[],
		startIndex: number,
		invocation: number,
	) => R | PromiseLike<R> | undefined | null | void;
	/**
	 * An array containing data to be divided into batches and passed to {generator}.
	 */
	data: T[];
	/**
	 * The number of elements from {data} to be passed to {generator} for each batch.
	 * If a function is used here, the value returned by the function determines the size of the batch.
	 * @param elements The number of unprocessed elements remaining in {data}.
	 * @param freeSlots The number of unused promise slots available in the promise pool.
	 */
	batchSize: number | ((elements: number, freeSlots: number) => number);
}

export interface EachTaskOptions<T, R> extends TaskOptionsBase, PromisePoolGroupOptions {
	/**
	 * An array of elements to be individually passed to {generator}.
	 */
	data: T[];
	/**
	 * A function used for creating promises to run.
	 * If the function returns undefined, the task will be flagged as completed unless it is in a paused state.
	 * @param value The value from {data} for this invocation.
	 * @param index The original index which {value} was stored at.
	 */
	generator(this: PromisePoolTask<unknown>, value: T, index: number): R | PromiseLike<R> | undefined | null | void;
}

export class PromisePoolExecutor implements PromisePoolGroup {
	private _nextTriggerTime = Infinity;
	private _nextTriggerClear?: () => void;
	/**
	 * All tasks which are active or waiting.
	 */
	private readonly _tasks: Set<PromisePoolTaskPrivate<unknown>> = new Set();
	private readonly _globalGroup: PromisePoolGroupPrivate;
	/**
	 * Currently in the process of triggering promises. Used to prevent recursion on generator functions.
	 */
	private _triggering?: boolean;
	/**
	 * Gets set when trying to trigger the tasks while they are already being triggerd.
	 */
	private _triggerAgain?: boolean;

	/**
	 * Construct a new PromisePoolExecutor object.
	 * @param concurrencyLimit The maximum number of promises which are allowed to run at one time.
	 */
	constructor(options?: PromisePoolGroupOptions | number) {
		let groupOptions: PromisePoolGroupOptions;

		if (!isNull(options)) {
			if (typeof options === "object") {
				groupOptions = options;
			} else {
				groupOptions = {
					concurrencyLimit: options,
				};
			}
		} else {
			groupOptions = {};
		}

		this._globalGroup = this.addGroup(groupOptions) as PromisePoolGroupPrivate;
	}

	/**
	 * The maximum number of promises allowed to be active simultaneously in the pool.
	 */
	public get concurrencyLimit(): number {
		return this._globalGroup.concurrencyLimit;
	}

	public set concurrencyLimit(v: number) {
		this._globalGroup.concurrencyLimit = v;
	}

	/**
	 * The maximum number promises allowed to be generated within the time window specified by {frequencyWindow}.
	 */
	public get frequencyLimit(): number {
		return this._globalGroup.frequencyLimit;
	}

	public set frequencyLimit(v: number) {
		this._globalGroup.frequencyLimit = v;
	}

	/**
	 * The time window in milliseconds to use for {frequencyLimit}.
	 */
	public get frequencyWindow(): number {
		return this._globalGroup.frequencyWindow;
	}

	public set frequencyWindow(v: number) {
		this._globalGroup.frequencyWindow = v;
	}

	/**
	 * The number of tasks active in the pool.
	 */
	public get activeTaskCount(): number {
		return this._globalGroup.activeTaskCount;
	}

	/**
	 * The number of promises active in the pool.
	 */
	public get activePromiseCount(): number {
		return this._globalGroup.activePromiseCount;
	}

	/**
	 * The number of promises which can be created before reaching the pool's configured limits.
	 */
	public get freeSlots(): number {
		return this._globalGroup.freeSlots;
	}

	/**
	 * Adds a group to the pool.
	 */
	public addGroup(options?: PromisePoolGroupOptions): PromisePoolGroup {
		return new PromisePoolGroupPrivate(this, () => this._setNextTrigger(0), options);
	}

	/**
	 * Adds a general-purpose task to the pool. The resulting task can be resolved to an array containing the results
	 * of the task, or a modified result using the resultConverter option.
	 */
	public addGenericTask<I, R>(options: GenericTaskConvertedOptions<I, R>): PromisePoolTask<R>;
	/**
	 * Adds a general-purpose task to the pool. The resulting task can be resolved to an array containing the results
	 * of the task, or a modified result using the resultConverter option.
	 */
	public addGenericTask<R>(options: GenericTaskOptions<R>): PromisePoolTask<R[]>;
	public addGenericTask<I, R>(
		options: GenericTaskOptions<R> | GenericTaskConvertedOptions<I, R>,
	): PromisePoolTask<R | R[]> {
		const task = new PromisePoolTaskPrivate<R, I>(
			{
				detach: () => {
					this._tasks.delete(task as PromisePoolTaskPrivate<unknown>);
					debug("Task removed");
				},
				globalGroup: this._globalGroup,
				pool: this,
				triggerNowCallback: () => this._triggerNow(),
			},
			options as GenericTaskConvertedOptions<I, R>,
		);
		if (task.state < TaskState.Exhausted) {
			this._tasks.add(task as PromisePoolTaskPrivate<unknown>);
		}
		this._triggerNow();
		return task;
	}

	/**
	 * Adds a task with a single promise. The resulting task can be resolved to the result of this promise.
	 */
	public addSingleTask<T, R>(options: SingleTaskOptions<T, R>): PromisePoolTask<R> {
		const data = options.data;
		// eslint-disable-next-line @typescript-eslint/unbound-method
		const generator = options.generator;
		return this.addGenericTask<R, R>({
			generator() {
				return generator.call(this, data as T);
			},
			groups: options.groups,
			invocationLimit: 1,
			paused: options.paused,
			resultConverter: (result) => result[0]!,
		});
	}

	/**
	 * Adds a task with a concurrency limit of 1. The resulting task can be resolved to an array containing the
	 * results of the task.
	 */
	public addLinearTask<R>(options: LinearTaskOptions<R>): PromisePoolTask<R[]> {
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
	public addBatchTask<T, R>(options: BatchTaskOptions<T, R>): PromisePoolTask<R[]> {
		let index = 0;

		// Unacceptable values: NaN, <=0, type not number/function
		if (
			!options.batchSize ||
			(typeof options.batchSize !== "function" && (typeof options.batchSize !== "number" || options.batchSize <= 0))
		) {
			throw new Error(`Invalid batchSize: ${options.batchSize}`);
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
						throw new Error(`Invalid batchSize: ${batchSize}`);
					}
					index += batchSize;
				} else {
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
	public addEachTask<T, R>(options: EachTaskOptions<T, R>): PromisePoolTask<R[]> {
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
				return options.generator.call(this, data[index]!, index);
			},
		});
	}

	/**
	 * Adds a task which can be used to combine multiple requests into batches to improve efficiency.
	 */
	public addPersistentBatchTask<I, O>(options: PersistentBatchTaskOptions<I, O>): PersistentBatchTask<I, O> {
		return new PersistentBatchTaskPrivate(this, options);
	}

	/**
	 * Returns a promise which resolves when there are no more tasks queued to run.
	 */
	public waitForIdle(): Promise<void> {
		return this._globalGroup.waitForIdle();
	}

	private _cleanFrequencyStarts(now: number): void {
		// Remove the frequencyStarts entries which are outside of the window
		this._globalGroup._cleanFrequencyStarts(now);
		for (const task of this._tasks) {
			task._cleanFrequencyStarts(now);
		}
	}

	private _setNextTrigger(time: 0): void;
	private _setNextTrigger(time: number, now: number): void;
	private _setNextTrigger(time: number, now?: number): void {
		if (time === this._nextTriggerTime) {
			return;
		}
		this._nextTriggerTime = time;
		this._nextTriggerClear?.();
		switch (time) {
			case 0:
				// eslint-disable-next-line no-case-declarations
				const immediate = setImmediate(() => {
					this._nextTriggerClear = undefined;
					this._nextTriggerTime = Infinity;
					this._triggerNow();
				});
				this._nextTriggerClear = () => {
					clearImmediate(immediate);
				};
				break;
			case Infinity:
				this._nextTriggerClear = undefined;
				break;
			default:
				// eslint-disable-next-line no-case-declarations
				const timeout = setTimeout(() => {
					this._nextTriggerClear = undefined;
					this._nextTriggerTime = Infinity;
					this._triggerNow();
				}, time - now!);
				this._nextTriggerClear = () => {
					clearTimeout(timeout);
				};
		}
	}

	/**
	 * Private Method: Triggers promises to start.
	 */
	private _triggerNow(): void {
		if (this._triggering) {
			debug("Setting triggerAgain flag.");
			this._triggerAgain = true;
			return;
		}

		this._triggering = true;
		this._triggerAgain = false;
		debug("Trigger promises");
		const now = Date.now();
		this._cleanFrequencyStarts(now);

		let soonest = Infinity;
		let lastTask: PromisePoolTaskPrivate<unknown, unknown> | undefined;
		for (const task of this._tasks) {
			for (;;) {
				const busyTime = task._busyTime();
				debug("BusyTime: %o", busyTime);

				if (!busyTime) {
					if (task.activePromiseCount > 100000) {
						if (lastTask === task) {
							soonest = 0;
							if (!warnedThrottle) {
								warnedThrottle = true;
								console.warn(
									"[PromisePoolExecutor] Throttling task with activePromiseCount %o.",
									task.activePromiseCount,
								);
							}
							break;
						}
						lastTask = task;
					}
					task._run();
				} else {
					if (busyTime < soonest) {
						soonest = busyTime;
					}
					break;
				}
			}
		}
		this._triggering = false;
		if (this._triggerAgain) {
			debug("TriggerAgain");
			return this._triggerNow();
		}

		this._setNextTrigger(soonest, now);
	}
}
