import defer from "p-defer";
import { Batcher, BatchingResult } from "promise-batcher";
import { PersistentBatchTask, PersistentBatchTaskOptions } from "../public/persistent-batch";
import { PromisePoolExecutor } from "../public/pool";
import { PromisePoolTask, TaskState } from "../public/task";

export class PersistentBatchTaskPrivate<I, O> implements PersistentBatchTask<I, O> {
	private readonly _batcher: Batcher<I, O>;
	private readonly _generator: (
		input: readonly I[],
	) => ReadonlyArray<BatchingResult<O>> | PromiseLike<ReadonlyArray<BatchingResult<O>>>;
	private readonly _task: PromisePoolTask<unknown>;

	constructor(pool: PromisePoolExecutor, options: PersistentBatchTaskOptions<I, O>) {
		let immediate: boolean | Error;
		let delayDeferred: Deferred<void> | undefined;
		let taskDeferred: Deferred<void> | undefined;

		// eslint-disable-next-line @typescript-eslint/unbound-method
		this._generator = options.generator;
		this._batcher = new Batcher<I, O>({
			batchingFunction: (inputs) => {
				if (!taskDeferred) {
					throw new Error("Expected taskPromise to be set (internal error).");
				}
				const localTaskDeferred = taskDeferred;
				taskDeferred = undefined;

				return (async () => {
					try {
						return await this._generator(inputs);
					} finally {
						// Do not send errors to the task, since they will be received via the getResult promises
						localTaskDeferred.resolve();
					}
				})();
			},
			delayFunction: () => {
				if (delayDeferred) {
					throw new Error("Expected delayDeferred not to be set (internal error).");
				}
				if (this._task.state >= TaskState.Exhausted) {
					throw new Error("This task has ended and cannot process more items");
				}
				immediate = false;
				this._task.resume();
				if (immediate) {
					if (immediate !== true) {
						throw immediate as Error;
					}
					return;
				}
				delayDeferred = defer();
				return delayDeferred.promise;
			},
			maxBatchSize: options.maxBatchSize,
			queuingDelay: options.queuingDelay,
			queuingThresholds: options.queuingThresholds,
		});

		this._task = pool.addGenericTask({
			concurrencyLimit: options.concurrencyLimit,
			frequencyLimit: options.frequencyLimit,
			frequencyWindow: options.frequencyWindow,
			generator: () => {
				this._task.pause();
				if (taskDeferred) {
					immediate = new Error("Expected taskDeferred not to be set (internal error).");
					return;
				}
				taskDeferred = defer();
				if (delayDeferred) {
					const localDelayDefered = delayDeferred;
					delayDeferred = undefined;
					localDelayDefered.resolve();
				} else {
					immediate = true;
				}
				return taskDeferred.promise;
			},
			paused: true,
		});
	}

	public get activePromiseCount(): number {
		return this._task.activePromiseCount;
	}

	public get concurrencyLimit(): number {
		return this._task.concurrencyLimit;
	}

	public set concurrencyLimit(val: number) {
		this._task.concurrencyLimit = val;
	}

	public get frequencyLimit(): number {
		return this._task.frequencyLimit;
	}

	public set frequencyLimit(val: number) {
		this._task.frequencyLimit = val;
	}

	public get frequencyWindow(): number {
		return this._task.frequencyWindow;
	}

	public set frequencyWindow(val: number) {
		this._task.frequencyWindow = val;
	}

	public get freeSlots(): number {
		return this._task.freeSlots;
	}

	public get state(): TaskState {
		return this._task.state;
	}

	public getResult(input: I): Promise<O> {
		if (this._task.state >= TaskState.Exhausted) {
			return Promise.reject(new Error("This task has ended and cannot process more items"));
		}
		return this._batcher.getResult(input);
	}

	public send(): void {
		this._batcher.send();
	}

	public end(): void {
		this._task.end();
	}
}
