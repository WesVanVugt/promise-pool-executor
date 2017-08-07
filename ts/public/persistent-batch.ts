import { PromisePoolGroupOptions } from "./group";
import { TaskStateProperty } from "./task";

export interface PersistentBatchTaskOptions<I, O> extends PromisePoolGroupOptions {
    maxBatchSize?: number;
    queuingDelay?: number;
    queuingThresholds?: number[];
    generator: (this: PersistentBatchTaskOptions<I, O>, input: I[]) => Promise<Array<O | Error>>;
}

export interface PersistentBatchTask<I, O> extends TaskStateProperty {
    getResult(input: I): Promise<O>;
    end(): void;
}
