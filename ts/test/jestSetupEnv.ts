import failOnConsole from "jest-fail-on-console";
import { clearCatchingRejections, failOnHandledRejection, setupCatchingRejections } from "./rejectionEvents";
import "./setup";

failOnConsole();
setupCatchingRejections();
failOnHandledRejection();

beforeEach(() => {
	jest.clearAllTimers();
	jest.resetAllMocks();
	clearCatchingRejections();
});
