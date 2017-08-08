export interface ConcurrencyLimit {
    /**
     * The maximum number of promises allowed to be active simultaneously.
     */
    concurrencyLimit: number;
}
export interface FrequencyLimit {
    /**
     * The maximum number promises allowed to be generated within the time window specified by {frequencyWindow}.
     */
    frequencyLimit: number;
    /**
     * The time window in milliseconds to use for {frequencyLimit}.
     */
    frequencyWindow: number;
}
export interface PromisePoolGroupOptions extends Partial<ConcurrencyLimit>, Partial<FrequencyLimit> {
}
export interface ActivePromiseCount {
    /**
     * The number of promises currently active.
     */
    readonly activePromiseCount: number;
}
export interface FreeSlots {
    /**
     * The number of promises which can be created before reaching the configured limits.
     */
    readonly freeSlots: number;
}
export interface PromisePoolGroup extends PromisePoolGroupOptions, ActivePromiseCount, FreeSlots {
    /**
     * The number of tasks currently active or paused.
     */
    readonly activeTaskCount: number;
    /**
     * Returns a promise which resolves when no tasks are currently active or paused.
     */
    waitForIdle(): Promise<void>;
}
