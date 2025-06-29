type RejectionEventNames = "unhandledRejection" | "rejectionHandled";

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
			process.actual().removeListener(eventName, handler);
			if (eventName === "rejectionHandled") {
				resolve(err as Promise<never>);
			} else {
				// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
				reject(err);
			}
		};
		handlerSet.add(handler);
		process.actual().addListener(eventName as "unhandledRejection", handler);
	});

export const catchUnhandledRejection = () => catchRejectionEvent("unhandledRejection");

export const catchHandledRejection = () => catchRejectionEvent("rejectionHandled");

export const isCatchingUnhandledRejection = () => rejectionEventHandlerSets.unhandledRejection.size > 0;
export const isCatchingHandledRejection = () => rejectionEventHandlerSets.rejectionHandled.size > 0;

export const setupCatchingRejections = () => {
	const [unhandled] = process.actual().listeners("unhandledRejection");
	process.actual().removeListener("unhandledRejection", unhandled!);
	process.actual().addListener("unhandledRejection", (...args) => {
		// istanbul ignore if -- Only called during failing tests
		if (!isCatchingUnhandledRejection()) {
			return unhandled!(...args);
		}
	});
};

export const failOnHandledRejection = () => {
	process.actual().addListener("rejectionHandled", () => {
		// istanbul ignore if -- Only called during failing tests
		if (!isCatchingHandledRejection()) {
			throw new Error("Unexpected rejectionHandled event");
		}
	});
};
