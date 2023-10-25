import { clearCatchingRejections, failOnHandledRejection, setupCatchingRejections } from "./rejectionEvents";
import { autoAdvanceTimers } from "./setup";

beforeAll(() => {
	jest.useFakeTimers();
	autoAdvanceTimers();
	setupCatchingRejections();
	failOnHandledRejection();
});

beforeEach(() => {
	jest.clearAllTimers();
	clearCatchingRejections();
});
