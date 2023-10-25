import util from "util";
import { PersistentBatchTask, PromisePoolGroup, PromisePoolTask } from "./imports";

export const realWait = util.promisify(setTimeout);
export const nextTick = () =>
	new Promise((resolve) => {
		process.nextTick(resolve);
	});

export const debug = util.debuglog("promise-pool-executor:test");

export interface PromisePoolGroupPrivate extends PromisePoolGroup {
	readonly _frequencyStarts: readonly number[];
}

export interface PromisePoolTaskPrivate extends PromisePoolTask<unknown> {
	readonly _result?: unknown[];
}

export interface PersistentBatchTaskPrivate extends PersistentBatchTask<unknown, unknown> {
	readonly _task: PromisePoolTaskPrivate;
}

export interface PromisePoolExecutorPrivate extends PromisePoolGroup {
	readonly _globalGroup: PromisePoolGroupPrivate;
}

/**
 * Milliseconds per tick.
 */
export const TICK = 100;

/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
export const wait = (ms: number) =>
	new Promise<void>((res) => {
		setTimeout(res, ms);
	});

export const ticking = () => {
	let ticked = false;
	process.nextTick(() => {
		ticked = true;
	});
	return () => ticked;
};
