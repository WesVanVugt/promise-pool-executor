export interface ConcurrencyLimit {
    /**
     * The maximum number of promises which are allowed to run at one time.
     */
    concurrencyLimit: number;
}

export interface FrequencyLimit {
    /**
     * The number of times a promise can be invoked within the time specified by {frequencyWindow}.
     */
    frequencyLimit: number;
    /**
     * The time window in milliseconds to use for {frequencyLimit}.
     */
    frequencyWindow: number;
}

export interface PromisePoolGroupOptions extends Partial<ConcurrencyLimit>, Partial<FrequencyLimit> { }

export interface ActivePromiseCount {
    /**
     * The number of promises which are active.
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
     * The number of tasks currently in an active state.
     */
    readonly activeTaskCount: number;
    waitForIdle(): Promise<void>;
}
