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
    private _promises;
    private _rejection?;
    private _triggerNextCallback;
    constructor(pool: PromisePoolExecutor, triggerNextCallback: () => void, options?: PromisePoolGroupOptions);
    readonly activeTaskCount: number;
    readonly activePromiseCount: number;
    concurrencyLimit: number;
    frequencyLimit: number;
    frequencyWindow: number;
    readonly freeSlots: number;
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
    _reject(err: TaskError): void;
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
