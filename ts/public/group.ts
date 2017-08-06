export interface ConcurrencyLimit {
    /**
     * Limits the number of instances of a promise which can be run in parallel.
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

export interface PromiseLimits extends ConcurrencyLimit, FrequencyLimit { }

export type PromisePoolGroupOptions = Partial<PromiseLimits>;

export interface ActivePromiseCount {
    /**
     * The number of promises which are active.
     */
    readonly activePromiseCount: number;
}

export interface ActivePromiseCount {
    /**
     * The number of promises which are active.
     */
    readonly activePromiseCount: number;
}

export interface FreeSlots {
    /**
     * The number of promises which can be invoked before the concurrency limit is reached.
     */
    readonly freeSlots: number;
}

export interface PromisePoolGroup extends PromiseLimits, ActivePromiseCount, FreeSlots {
    readonly activeTaskCount: number;
    waitForIdle(): Promise<void>;
}
