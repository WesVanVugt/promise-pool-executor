import { PersistentBatchTask, PersistentBatchTaskOptions } from "../public/persistent-batch";
import { PromisePoolExecutor } from "../public/pool";
import { TaskState } from "../public/task";
export declare class PersistentBatchTaskPrivate<I, O> implements PersistentBatchTask<I, O> {
    private _task;
    private _maxBatchSize;
    private _queuingDelay;
    private _queuingThresholds;
    private _inputQueue;
    private _outputPromises;
    private _generator;
    private _waitTimeout?;
    private _waiting;
    constructor(pool: PromisePoolExecutor, options: PersistentBatchTaskOptions<I, O>);
    readonly activePromiseCount: number;
    concurrencyLimit: number;
    frequencyLimit: number;
    frequencyWindow: number;
    readonly freeSlots: number;
    readonly state: TaskState;
    getResult(input: I): Promise<O>;
    end(): void;
    private _run(promiseEnding?);
}
