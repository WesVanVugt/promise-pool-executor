/// <reference types="debug" />
import * as Debug from "debug";
export declare const debug: Debug.IDebugger;
export declare class ResolvablePromise<T> {
    resolve: (result?: T) => void;
    reject: (err: any) => void;
    promise: Promise<T>;
    constructor();
}
export interface TaskError {
    error: any;
    handled: any;
}
export declare function isNull(val: any): val is null | undefined;
