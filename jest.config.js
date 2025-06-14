// @ts-check

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
process.actual = (function (actual) {
	return () => actual;
})(process);

/** @type {import("jest").Config} */
const config = {
	preset: "ts-jest",
	collectCoverage: true,
	setupFilesAfterEnv: ["./ts/test/jestSetupEnv.ts"],
	fakeTimers: {
		enableGlobally: true,
	},
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
