import { PromisePoolGroupConfig } from "./group";

export interface PersistentBatcherTaskParams<I, O> extends PromisePoolGroupConfig {
    maxBatchSize?: number;
    queuingDelay?: number;
    queuingThresholds?: number[];
    generator: (input: I[]) => Promise<Array<O | Error>>;
}

export interface PersistentBatcherTask<I, O> {
    getResult(input: I): Promise<O>;
    end(): void;
}
