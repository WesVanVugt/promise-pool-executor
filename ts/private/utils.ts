import * as Debug from "debug";
export const debug = Debug("promise-pool-executor");

export interface TaskError {
    error: any;
    handled: any;
}

export function isNull(val: any): val is null | undefined {
    return val === undefined || val === null;
}
