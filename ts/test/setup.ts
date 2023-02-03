import EventEmitter from "events";
import mimicFn from "mimic-fn";

const AUTO_ADVANCE_SYMBOL = Symbol("AutoAdvanceTimers");
const HOOK_SYMBOL = Symbol("EventHook");

const eventEmitter = new EventEmitter();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CleanFn<T> = T extends (...args: any) => any ? (...args: Parameters<T>) => ReturnType<T> : never;

const wrapMethod = <T extends object, M extends jest.FunctionPropertyNames<Required<T>>>(
	object: T,
	method: M,
	cb: (fn: CleanFn<T[M]>) => CleanFn<T[M]>,
) => {
	const fn = object[method] as CleanFn<T[M]>;
	const newFn = cb(fn);
	mimicFn(newFn as () => void, fn);
	object[method] = newFn as T[M];
};

export const autoAdvanceTimers = () => {
	eventEmitter.emit(AUTO_ADVANCE_SYMBOL);
};

// Issue: https://github.com/facebook/jest/issues/10555
const areTimersMocked = () => typeof (setTimeout as { clock?: { Date?: unknown } }).clock?.Date === "function";

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
	// eslint-disable-next-line no-constant-condition
	while (true) {
		for (let i = 0; i < 10; i++) {
			await Promise.resolve();
		}
		const isFakeTimers = areTimersMocked();
		if (isFakeTimers && jest.getTimerCount() > 0) {
			jest.advanceTimersToNextTimer();
		} else {
			if (isFakeTimers && !(HOOK_SYMBOL in globalThis.setTimeout)) {
				wrapMethod(globalThis, "setTimeout", (fn) => (...args) => {
					autoAdvanceTimers();
					return fn(...args);
				});
				wrapMethod(globalThis, "setInterval", (fn) => (...args) => {
					autoAdvanceTimers();
					return fn(...args);
				});
				(globalThis.setTimeout as typeof setTimeout & { [HOOK_SYMBOL]: undefined })[HOOK_SYMBOL] = undefined;
			}
			await new Promise<void>((resolve) => {
				eventEmitter.once(AUTO_ADVANCE_SYMBOL, () => resolve());
			});
		}
	}
})();
