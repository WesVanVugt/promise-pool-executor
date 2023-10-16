import util from "util";
export const debug = util.debuglog("promise-pool-executor");

export interface TaskError {
	error: unknown;
	promise?: Promise<never>;
}

export function isNull(val: unknown): val is null | undefined {
	return val === undefined || val === null;
}
