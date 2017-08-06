import { PromisePoolGroupOptions } from "./group";

export interface PersistentBatchTaskOptions<I, O> extends PromisePoolGroupOptions {
    maxBatchSize?: number;
    queuingDelay?: number;
    queuingThresholds?: number[];
    generator: (input: I[]) => Promise<Array<O | Error>>;
}

export interface PersistentBatchTask<I, O> {
    getResult(input: I): Promise<O>;
    end(): void;
}
