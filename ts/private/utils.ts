import util from "util";
export const debug = util.debuglog("promise-pool-executor");

export interface TaskError {
	error: any;
	promise?: Promise<never>;
}

export function isNull(val: any): val is null | undefined {
	return val === undefined || val === null;
}
