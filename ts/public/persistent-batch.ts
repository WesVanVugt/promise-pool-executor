import { ActivePromiseCount, FreeSlots, PromisePoolGroupOptions } from "./group";
import { EndMethod, TaskStateProperty } from "./task";

export interface PersistentBatchTaskOptions<I, O> extends PromisePoolGroupOptions {
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
}

export interface PersistentBatchTask<I, O> extends
    ActivePromiseCount, PromisePoolGroupOptions, FreeSlots, TaskStateProperty, EndMethod {
    /**
     * Returns a promise which resolves or rejects with the individual result returned from the task's generator
     * function.
     */
    getResult(input: I): Promise<O>;
}
