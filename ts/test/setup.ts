import mimicFn from "mimic-fn";
import { setImmediate } from "timers/promises";

const AUTO_ADVANCE_EVENT = "AutoAdvanceTimers";
const HOOK_SYMBOL = Symbol("EventHook");

const eventTarget = new EventTarget();

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
	eventTarget.dispatchEvent(new CustomEvent("xxx"));
};

const applyHooks = () => {
	if (HOOK_SYMBOL in globalThis.setTimeout) {
		return;
	}
	hookMethod(globalThis, "setTimeout");
	hookMethod(globalThis, "setInterval");
	(globalThis.setTimeout as typeof setTimeout & { [HOOK_SYMBOL]: undefined })[HOOK_SYMBOL] = undefined;
};

// Issue: https://github.com/facebook/jest/issues/10555
const areTimersMocked = () => typeof (setTimeout as { clock?: { Date?: unknown } }).clock?.Date === "function";

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
	for (;;) {
		await setImmediate();
		if (areTimersMocked()) {
			if (jest.getTimerCount() > 0) {
				jest.advanceTimersToNextTimer();
				continue;
			}
			applyHooks();
		}
		await new Promise((resolve) => {
			eventTarget.addEventListener(AUTO_ADVANCE_EVENT, resolve);
		});
	}
})();
