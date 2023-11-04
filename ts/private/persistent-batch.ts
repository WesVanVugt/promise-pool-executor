import assert from "assert/strict";
import defer, { DeferredPromise } from "p-defer";
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
		let synchronousResult: boolean | Error;
		let waitForTask: DeferredPromise<void> | undefined;
		let waitForBatcher: DeferredPromise<void> | undefined;

		// eslint-disable-next-line @typescript-eslint/unbound-method
		this._generator = options.generator;
		this._batcher = new Batcher<I, O>({
			batchingFunction: async (inputs) => {
				assert(waitForBatcher, "Expected taskPromise to be set (internal error).");
				const localWaitForBatcher = waitForBatcher;
				waitForBatcher = undefined;

				try {
					return await this._generator(inputs);
				} finally {
					// Do not send errors to the task, since they will be received via the getResult promises
					localWaitForBatcher.resolve();
				}
			},
			delayFunction: () => {
				assert(!waitForTask, "Expected waitForTask not to be set (internal error).");
				if (this._task.state >= TaskState.Exhausted) {
					throw new Error("This task has ended and cannot process more items");
				}
				synchronousResult = false;
				// Wake the task to allow processing
				this._task.resume();
				// If the task is ready or errored immediately, process that
				if (synchronousResult) {
					if (synchronousResult !== true) {
						throw synchronousResult as Error;
					}
					return;
				}
				// The task is not ready, so we wait for it
				waitForTask = defer();
				return waitForTask.promise;
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
				if (waitForBatcher) {
					synchronousResult = new Error("Expected taskDeferred not to be set (internal error).");
					return;
				}
				waitForBatcher = defer();
				if (waitForTask) {
					const localWaitForTask = waitForTask;
					waitForTask = undefined;
					localWaitForTask.resolve();
				} else {
					synchronousResult = true;
				}
				return waitForBatcher.promise;
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

	public set concurrencyLimit(v: number) {
		this._task.concurrencyLimit = v;
	}

	public get frequencyLimit(): number {
		return this._task.frequencyLimit;
	}

	public set frequencyLimit(v: number) {
		this._task.frequencyLimit = v;
	}

	public get frequencyWindow(): number {
		return this._task.frequencyWindow;
	}

	public set frequencyWindow(v: number) {
		this._task.frequencyWindow = v;
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

	// TODO: waitForIdle?
}
