import failOnConsole from "jest-fail-on-console";
import { failOnHandledRejection, setupCatchingRejections } from "./rejectionEvents";
import "./setup";

failOnConsole();
setupCatchingRejections();
failOnHandledRejection();

beforeEach(() => {
	jest.clearAllTimers();
	jest.resetAllMocks();
});
