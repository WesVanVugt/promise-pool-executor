import Debug from "debug";
export const debug = Debug("promise-pool-executor");

export function isNull(val: any): val is null | undefined | void {
    return val === undefined || val === null;
}

export function handleErr(promise: Promise<any>): void {
    promise.catch(() => {
        // do nothing
    });
}
