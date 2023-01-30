import { PromisePoolGroup, PromisePoolGroupOptions } from "../public/group";
import { PromisePoolExecutor } from "../public/pool";
import { TaskError } from "./utils";
/** Internal use only */
export declare class PromisePoolGroupPrivate implements PromisePoolGroup {
	_pool: PromisePoolExecutor;
	_concurrencyLimit: number;
	_frequencyLimit: number;
	_frequencyWindow: number;
	_frequencyStarts: number[];
	_activeTaskCount: number;
	_activePromiseCount: number;
	private readonly _deferreds;
	/**
	 * This flag prevents a rejection from being removed before nextTick is called.
	 * This way, you can be certain that when calling waitForIdle after adding a task, the error will get handled.
	 */
	private _recentRejection;
	/**
	 * The error that the pool was rejected with.
	 * Clears when activePromiseCount reaches 0 and recentRejection is false.
	 */
	private _rejection?;
	/**
	 * This flag indicates whether the rejection was handled by this group. This is used to flag subsequent rejections
	 * within the group as handled.
	 */
	private _locallyHandled;
	/**
	 * Contains any additional rejections so they can be flagged as handled before the nextTick fires if applicable
	 */
	private readonly _secondaryRejections;
	private readonly _triggerNextCallback;
	constructor(pool: PromisePoolExecutor, triggerNextCallback: () => void, options?: PromisePoolGroupOptions);
	get activeTaskCount(): number;
	get activePromiseCount(): number;
	get concurrencyLimit(): number;
	set concurrencyLimit(val: number);
	get frequencyLimit(): number;
	set frequencyLimit(val: number);
	get frequencyWindow(): number;
	set frequencyWindow(val: number);
	get freeSlots(): number;
	_getFreeSlots(): number;
	/**
	 * Cleans out old entries from the frequencyStarts array. Uses a passed timestamp to ensure consistency between
	 * groups.
	 */
	_cleanFrequencyStarts(now: number): void;
	/**
	 * Returns 0 if the group is available, Infinity if the group is busy for an indeterminate time, or the timestamp
	 * of when the group will become available.
	 */
	_busyTime(): number;
	/**
	 * Resolves all pending waitForIdle promises.
	 */
	_resolve(): void;
	/**
	 * Rejects all pending waitForIdle promises using the provided error.
	 */
	_reject(err: TaskError): boolean;
	/**
	 * Returns a promise which resolves when the group becomes idle.
	 */
	waitForIdle(): Promise<void>;
	_incrementTasks(): void;
	/**
	 * Decrements the active tasks, resolving promises if applicable.
	 */
	_decrementTasks(): void;
}
