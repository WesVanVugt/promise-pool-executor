/// <reference types="node" />
import util from "util";
export declare const debug: util.DebugLogger;
export declare const isNull: (val: unknown) => val is null | undefined;
export declare const handleRejection: (promise: Promise<never>) => void;
