import { BatchingResult } from "promise-batcher";
import { ActivePromiseCount, ConcurrencyLimit, FreeSlots, FrequencyLimit, PromisePoolGroupOptions } from "./group";
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
	generator(
		this: PersistentBatchTaskOptions<I, O>,
		input: readonly I[],
	): ReadonlyArray<BatchingResult<O>> | PromiseLike<ReadonlyArray<BatchingResult<O>>>;
}

export interface PersistentBatchTask<I, O>
	extends ActivePromiseCount,
		ConcurrencyLimit,
		FrequencyLimit,
		FreeSlots,
		TaskStateProperty,
		EndMethod {
	/**
	 * Returns a promise which resolves or rejects with the individual result returned from the task's generator
	 * function.
	 */
	getResult(input: I): Promise<O>;
	/**
	 * Triggers a batch to run, bypassing the queuingDelay while respecting other imposed delays.
	 */
	send(): void;
}
