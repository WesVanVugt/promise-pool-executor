import { PersistentBatchTask, PersistentBatchTaskOptions } from "../public/persistent-batch";
import { PromisePoolExecutor } from "../public/pool";
import { TaskState } from "../public/task";
export declare class PersistentBatchTaskPrivate<I, O> implements PersistentBatchTask<I, O> {
    private _batcher;
    private _generator;
    private _task;
    constructor(pool: PromisePoolExecutor, options: PersistentBatchTaskOptions<I, O>);
    readonly activePromiseCount: number;
    concurrencyLimit: number;
    frequencyLimit: number;
    frequencyWindow: number;
    readonly freeSlots: number;
    readonly state: TaskState;
    getResult(input: I): Promise<O>;
    end(): void;
}
