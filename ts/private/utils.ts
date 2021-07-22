import util from "util";
export const debug = util.debuglog("promise-pool-executor");

export function isNull(val: any): val is null | undefined | void {
    return val === undefined || val === null;
}

export function handleErr(promise: Promise<any>): void {
    promise.catch(() => {
        // do nothing
    });
}
