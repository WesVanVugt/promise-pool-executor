import { ActivePromiseCount, FreeSlots, PromisePoolGroupOptions } from "./group";
import { TaskStateProperty } from "./task";

export interface PersistentBatchTaskOptions<I, O> extends PromisePoolGroupOptions {
    maxBatchSize?: number;
    queuingDelay?: number;
    queuingThresholds?: number[];
    generator: (this: PersistentBatchTaskOptions<I, O>, input: I[]) => Promise<Array<O | Error>>;
}

export interface PersistentBatchTask<I, O> extends
    ActivePromiseCount, PromisePoolGroupOptions, FreeSlots, TaskStateProperty {
    getResult(input: I): Promise<O>;
    end(): void;
}
