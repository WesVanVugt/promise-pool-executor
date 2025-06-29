declare namespace NodeJS {
	export interface Process {
		/**
		 * Issue: https://github.com/facebook/jest/issues/5620
		 */
		actual: () => NodeJS.Process;
	}
}
