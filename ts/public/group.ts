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

export type PromisePoolGroupOptions = Partial<PromiseLimits>;

export interface PromisePoolGroup extends PromiseLimits {
    readonly activeTaskCount: number;
    readonly activePromiseCount: number;
    readonly freeSlots: number;
    waitForIdle(): Promise<void>;
}
