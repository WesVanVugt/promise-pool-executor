import EventEmitter from "events";
import mimicFn from "mimic-fn";

const AUTO_ADVANCE_SYMBOL = Symbol("AutoAdvanceTimers");
const HOOK_SYMBOL = Symbol("EventHook");

const eventEmitter = new EventEmitter();

// // eslint-disable-next-line @typescript-eslint/no-explicit-any
// type CleanFn<T> = T extends (...args: any) => any ? (...args: Parameters<T>) => ReturnType<T> : never;

// const wrapMethod = <T extends object, M extends jest.FunctionPropertyNames<Required<T>>>(
// 	object: T,
// 	method: M,
// 	cb: (fn: CleanFn<T[M]>) => CleanFn<T[M]>,
// ) => {
// 	const fn = object[method] as CleanFn<T[M]>;
// 	const newFn = cb(fn);
// 	mimicFn(newFn as () => void, fn);
// 	object[method] = newFn as T[M];
// };

const hookMethod = <T extends object, M extends jest.FunctionPropertyNames<Required<T>>>(object: T, method: M) => {
	const fn = object[method] as (...args: unknown[]) => unknown;
	const newFn = (...args: unknown[]) => {
		autoAdvanceTimers();
		return fn.call(object, ...args);
	};
	mimicFn(newFn, fn);
	object[method] = newFn as T[M];
};

export const autoAdvanceTimers = () => {
	eventEmitter.emit(AUTO_ADVANCE_SYMBOL);
};

const applyHooks = () => {
	if (HOOK_SYMBOL in globalThis.setTimeout) {
		return;
	}
	hookMethod(globalThis, "setTimeout");
	hookMethod(globalThis, "setInterval");
	hookMethod(process, "nextTick");
	(globalThis.setTimeout as typeof setTimeout & { [HOOK_SYMBOL]: undefined })[HOOK_SYMBOL] = undefined;
};

// Issue: https://github.com/facebook/jest/issues/10555
const areTimersMocked = () => typeof (setTimeout as { clock?: { Date?: unknown } }).clock?.Date === "function";

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
	for (;;) {
		for (let i = 0; i < 10; i++) {
			await Promise.resolve();
		}
		if (areTimersMocked()) {
			applyHooks();
			const timerCount = jest.getTimerCount();
			if (timerCount > 0) {
				eventEmitter.once(AUTO_ADVANCE_SYMBOL, () => {});
				jest.runAllTicks();
				if (eventEmitter.listenerCount(AUTO_ADVANCE_SYMBOL) > 0) {
					eventEmitter.removeAllListeners(AUTO_ADVANCE_SYMBOL);
					if (timerCount === jest.getTimerCount()) {
						jest.advanceTimersToNextTimer();
					}
				}
				continue;
			}
		}
		await new Promise((resolve) => {
			// TODO: Does event history trigger this?
			eventEmitter.once(AUTO_ADVANCE_SYMBOL, resolve);
		});
	}
})();
