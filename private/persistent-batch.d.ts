import { PersistentBatchTask, PersistentBatchTaskOptions } from "../public/persistent-batch";
import { PromisePoolExecutor } from "../public/pool";
import { TaskState } from "../public/task";
export declare class PersistentBatchTaskPrivate<I, O> implements PersistentBatchTask<I, O> {
	private readonly _batcher;
	private readonly _generator;
	private readonly _task;
	constructor(pool: PromisePoolExecutor, options: PersistentBatchTaskOptions<I, O>);
	get activePromiseCount(): number;
	get concurrencyLimit(): number;
	set concurrencyLimit(val: number);
	get frequencyLimit(): number;
	set frequencyLimit(val: number);
	get frequencyWindow(): number;
	set frequencyWindow(val: number);
	get freeSlots(): number;
	get state(): TaskState;
	getResult(input: I): Promise<O>;
	send(): void;
	end(): void;
}
