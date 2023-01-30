/// <reference types="node" />
import util from "util";
export declare const debug: util.DebugLogger;
export interface TaskError {
	error: any;
	promise?: Promise<never>;
}
export declare function isNull(val: any): val is null | undefined;
