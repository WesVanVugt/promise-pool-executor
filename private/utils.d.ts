/// <reference types="node" />
import util from "util";
export declare const debug: util.DebugLogger;
export interface TaskError {
	error: unknown;
	promise?: Promise<never>;
}
export declare function isNull(val: unknown): val is null | undefined;
