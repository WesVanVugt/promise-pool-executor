import * as Debug from "debug";
export const debug = Debug("promise-pool-executor");

export class ResolvablePromise<T> {
    public resolve?: (result?: T) => void;
    public reject?: (err: any) => void;
    public promise: Promise<T>;

    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

export interface TaskError {
    error: any;
    handled: any;
}

export function isNull(val: any): boolean {
    return val === undefined || val === null;
}
