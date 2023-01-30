import { PromisePoolExecutor } from "../public/pool";
import { GenericTaskConvertedOptions, GenericTaskOptions, PromisePoolTask, TaskState } from "../public/task";
import { PromisePoolGroupPrivate } from "./group";
export interface GenericTaskOptionsPrivate {
	pool: PromisePoolExecutor;
	globalGroup: PromisePoolGroupPrivate;
	triggerNowCallback: () => void;
	detach: () => void;
}
export declare class PromisePoolTaskPrivate<R> implements PromisePoolTask<any> {
	private readonly _groups;
	private readonly _generator;
	private readonly _taskGroup;
	private _invocations;
	private _invocationLimit;
	private _result?;
	private _returnResult;
	private _state;
	private _rejection?;
	/**
	 * Set to true while the generator function is being run. Prevents the task from being terminated since a final
	 * promise may be generated.
	 */
	private _generating?;
	private readonly _deferreds;
	private readonly _pool;
	private readonly _triggerCallback;
	private readonly _detachCallback;
	private readonly _resultConverter?;
	constructor(
		privateOptions: GenericTaskOptionsPrivate,
		options: GenericTaskOptions<R> | GenericTaskConvertedOptions<any, R>,
	);
	get activePromiseCount(): number;
	get invocations(): number;
	get invocationLimit(): number;
	set invocationLimit(val: number);
	get concurrencyLimit(): number;
	set concurrencyLimit(val: number);
	get frequencyLimit(): number;
	set frequencyLimit(val: number);
	get frequencyWindow(): number;
	set frequencyWindow(val: number);
	get freeSlots(): number;
	get state(): TaskState;
	/**
	 * Returns a promise which resolves when the task completes.
	 */
	promise(): Promise<any>;
	/**
	 * Pauses an active task, preventing any additional promises from being generated.
	 */
	pause(): void;
	/**
	 * Resumes a paused task, allowing for the generation of additional promises.
	 */
	resume(): void;
	/**
	 * Ends the task. Any promises created by the promise() method will be resolved when all outstanding promises
	 * have ended.
	 */
	end(): void;
	/**
	 * Private. Returns 0 if the task is ready, Infinity if the task is busy with an indeterminate ready time, or the
	 * timestamp for when the task will be ready.
	 */
	_busyTime(): number;
	_cleanFrequencyStarts(now: number): void;
	/**
	 * Private. Invokes the task.
	 */
	_run(): void;
	/**
	 * Private. Resolves the task if possible. Should only be called by end()
	 */
	private _resolve;
	private _reject;
}
