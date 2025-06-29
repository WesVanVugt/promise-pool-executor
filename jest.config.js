// @ts-check

// @ts-expect-error -- custom property
process.actual = (function (actual) {
	return () => actual;
})(process);

/** @type {import("jest").Config} */
const config = {
	preset: "ts-jest",
	testPathIgnorePatterns: ["./test-package"],
	collectCoverage: true,
	setupFilesAfterEnv: ["./ts/test/jestSetupEnv.ts"],
	fakeTimers: {
		enableGlobally: true,
	},
	maxWorkers: 1, // Needed to support use of "actual" above
	collectCoverageFrom: ["./ts/**/*"],
	coverageThreshold: {
		global: {
			branches: 100,
			functions: 100,
			lines: 100,
			statements: 100,
		},
	},
};
module.exports = config;
