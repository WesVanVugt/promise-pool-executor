import util from "util";

export const debug = util.debuglog("promise-pool-executor");

export const isNull = (val: unknown): val is null | undefined => val === undefined || val === null;
