export interface PersistentBatchTaskOptions<I, O> {
    /**
     * The maximum number of requests that can be combined in a single batch.
     */
    maxBatchSize?: number;
    /**
     * The number of milliseconds to wait before running a batch of requests.
     */
    queuingDelay?: number;
    /**
     * An array containing the number of requests that must be queued in order to trigger a batch request at
     * each level of concurrency
     */
    queuingThresholds?: number[];
    /**
     * A function which is passed an array of request values, returning a promise which resolves to an array of
     * response values.
     */
    generator(this: PersistentBatchTaskOptions<I, O>, input: I[]): Array<O | Error> | PromiseLike<Array<O | Error>>;
    delayFunction?(): PromiseLike<void> | undefined | null | void;
}
export interface PersistentBatchTask<I, O> {
    /**
     * Returns a promise which resolves or rejects with the individual result returned from the task's generator
     * function.
     */
    getResult(input: I): Promise<O>;
}
export declare class Batcher<I, O> {
    private _maxBatchSize;
    private _queuingDelay;
    private _queuingThresholds;
    private _inputQueue;
    private _outputPromises;
    private _delayFunction?;
    private _generator;
    private _waitTimeout?;
    private _waiting;
    private _activePromiseCount;
    constructor(options: PersistentBatchTaskOptions<I, O>);
    getResult(input: I): Promise<O>;
    private _trigger();
    private _run();
    private _runImmediately();
}
