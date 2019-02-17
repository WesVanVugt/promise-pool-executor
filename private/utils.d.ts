import Debug from "debug";
export declare const debug: Debug.Debugger;
export interface TaskError {
    error: any;
    promise?: Promise<never>;
}
export declare function isNull(val: any): val is null | undefined | void;
