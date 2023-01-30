export declare const debug: (msg: string, ...param: any[]) => void;
export interface TaskError {
	error: any;
	promise?: Promise<never>;
}
export declare function isNull(val: any): val is null | undefined;
