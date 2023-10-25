const REJECTION_EVENT_NAMES = ["unhandledRejection", "rejectionHandled"] as const;

type RejectionEventNames = (typeof REJECTION_EVENT_NAMES)[number];

const rejectionEventHandlerSets: Readonly<Record<RejectionEventNames, Set<(...args: unknown[]) => void>>> = {
	rejectionHandled: new Set(),
	unhandledRejection: new Set(),
};

const catchRejectionEvent = async (eventName: RejectionEventNames) =>
	new Promise<void>((resolve, reject) => {
		const handlerSet = rejectionEventHandlerSets[eventName];
		let i = handlerSet.size;
		const handler = (err: unknown) => {
			if (i > 0) {
				i--;
				return;
			}
			handlerSet.delete(handler);
			process._original().removeListener(eventName, handler);
			if (eventName === "rejectionHandled") {
				resolve(err as Promise<never>);
			} else {
				reject(err);
			}
		};
		handlerSet.add(handler);
		process._original().addListener(eventName as "unhandledRejection", handler);
	});

export const catchUnhandledRejection = () => catchRejectionEvent("unhandledRejection");

export const catchHandledRejection = () => catchRejectionEvent("rejectionHandled");

export const isCatchingUnhandledRejection = () => rejectionEventHandlerSets.unhandledRejection.size > 0;
export const isCatchingHandledRejection = () => rejectionEventHandlerSets.rejectionHandled.size > 0;

export const clearCatchingRejections = () => {
	for (const eventName of REJECTION_EVENT_NAMES) {
		const handlerSet = rejectionEventHandlerSets[eventName];
		for (const handler of handlerSet) {
			process._original().removeListener(eventName, handler);
		}
		handlerSet.clear();
	}
};
