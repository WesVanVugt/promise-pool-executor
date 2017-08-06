export interface PromiseLimits {
    /**
     * Limits the number of instances of a promise which can be run in parallel.
     */
    concurrencyLimit: number;
    /**
     * The number of times a promise can be invoked within the time specified by {frequencyWindow}.
     */
    frequencyLimit: number;
    /**
     * The time window in milliseconds to use for {frequencyLimit}.
     */
    frequencyWindow: number;
}

export type PromisePoolGroupConfig = Partial<PromiseLimits>;

export interface PromisePoolGroup {
    readonly activeTaskCount: number;
    readonly activePromiseCount: number;
    concurrencyLimit: number;
    frequencyLimit: number;
    frequencyWindow: number;
    readonly freeSlots: number;
    waitForIdle(): Promise<void>;
}
