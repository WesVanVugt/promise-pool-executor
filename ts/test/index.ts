import * as Debug from "debug";
import * as Pool from "../index";

const debug = Debug("promise-pool-executor:test");

// Verify that the types needed can be imported
const typingImportTest:
	| Pool.PromisePoolExecutor
	// Group
	| Pool.PromisePoolGroup
	| Pool.PromisePoolGroupOptions
	// General Tasks
	| Pool.PromisePoolTask<any>
	| Pool.GenericTaskOptions<any>
	| Pool.GenericTaskConvertedOptions<any, any>
	| Pool.SingleTaskOptions<any, any>
	| Pool.LinearTaskOptions<any>
	| Pool.BatchTaskOptions<any, any>
	| Pool.EachTaskOptions<any, any>
	| Pool.TaskState
	// Persistent Batch Task
	| Pool.PersistentBatchTask<any, any>
	| Pool.PersistentBatchTaskOptions<any, any>
	| Pool.BatcherToken
	| Pool.BatchingResult<any>
	| undefined = undefined;

if (typingImportTest) {
	// satisfy TypeScript's need to use the variable
}

/**
 * Milliseconds per tick.
 */
const TICK = 100;
/**
 * Milliseconds tolerance for tests above the target.
 */
const tolerance = 80;

/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
function wait(time: number): Promise<void> {
	if (time <= 0) {
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => {
		setTimeout(() => {
			resolve();
		}, time);
	});
}

/**
 * Expects an array of result times (ms) to be within the tolerance range of the specified numbers of target ticks.
 */
// @ts-expect-error
function expectTimes(resultTimes: number[], targetTicks: number[], message: string) {
	expect(resultTimes).toHaveLength(targetTicks.length); // message
	resultTimes.forEach((val, i) => {
		expect(val).toBeGreaterThanOrEqual(targetTicks[i] * TICK - 1);
		expect(val).toBeLessThanOrEqual(targetTicks[i] * TICK + tolerance - 1);
		// " (" + i + ")");
	});
}

function waitForUnhandledRejection(delay: number = TICK * 2): Promise<void> {
	process._original().removeListener("unhandledRejection", unhandledRejectionListener);

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			resetUnhandledRejectionListener();
			resolve();
		}, delay);

		process._original().prependOnceListener("unhandledRejection", (err) => {
			clearTimeout(timeout);
			debug("Caught unhandledRejection");
			resetUnhandledRejectionListener();
			reject(err);
		});
	});
}

function expectHandledRejection(delay: number = TICK * 2): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			resetHandledRejectionListener();
			reject(new Error("Rejection Not Handled"));
		}, delay);

		process._original().removeAllListeners("rejectionHandled");
		process._original().prependOnceListener("rejectionHandled", () => {
			clearTimeout(timeout);
			debug("rejectionHandled");
			resetHandledRejectionListener();
			resolve();
		});
	});
}

/**
 * Expects an unhandled promise rejection.
 * @param expectedError The error expected to be received with the rejection (optional).
 */
async function expectUnhandledRejection(expectedError: any, delay: number = TICK * 2): Promise<void> {
	await expect(waitForUnhandledRejection(delay)).rejects.toThrowError(expectedError);
}

/**
 * Returns the sum of an array of numbers.
 */
function sum(nums: number[]): number {
	let total = 0;
	let i: number;
	for (i of nums) {
		total += i;
	}
	return total;
}

function unhandledRejectionListener(err: any) {
	debug("unhandledRejectionListener: %O", err);
	// Fail the test
	throw err;
}

function rejectionHandledListener() {
	debug("Unexpected rejectionHandled event");
	// Fail the test
	throw new Error("Unexpected rejectionHandled event");
}

function resetUnhandledRejectionListener(): void {
	process._original().removeAllListeners("unhandledRejection");
	process._original().addListener("unhandledRejection", unhandledRejectionListener);
}

function resetHandledRejectionListener(): void {
	process._original().removeAllListeners("rejectionHandled");
	process._original().addListener("rejectionHandled", rejectionHandledListener);
}

beforeEach(() => {
	resetUnhandledRejectionListener();
	resetHandledRejectionListener();
});

describe("Concurrency", () => {
	test("No Limit", () => {
		const pool = new Pool.PromisePoolExecutor();

		const start: number = Date.now();
		return pool
			.addGenericTask({
				generator: () => {
					return wait(TICK).then(() => {
						return Date.now() - start;
					});
				},
				invocationLimit: 3,
			})
			.promise()
			.then((results) => {
				expectTimes(results, [1, 1, 1], "Timing Results");
			});
	});

	test("Global Limit", () => {
		const pool = new Pool.PromisePoolExecutor(2);

		const start: number = Date.now();
		return pool
			.addGenericTask({
				generator: () => {
					return wait(TICK).then(() => {
						return Date.now() - start;
					});
				},
				invocationLimit: 3,
			})
			.promise()
			.then((results) => {
				expectTimes(results, [1, 1, 2], "Timing Results");
			});
	});

	test("Task Limit", () => {
		const pool = new Pool.PromisePoolExecutor();

		const start: number = Date.now();
		return pool
			.addGenericTask({
				concurrencyLimit: 2,
				generator: () => {
					return wait(TICK).then(() => {
						return Date.now() - start;
					});
				},
				invocationLimit: 3,
			})
			.promise()
			.then((results) => {
				expectTimes(results, [1, 1, 2], "Timing Results");
			});
	});

	test("Group Limit", () => {
		const pool = new Pool.PromisePoolExecutor();
		const group = pool.addGroup({
			concurrencyLimit: 2,
		});

		const start: number = Date.now();
		return pool
			.addGenericTask({
				generator: () => {
					return wait(TICK).then(() => {
						return Date.now() - start;
					});
				},
				groups: [group],
				invocationLimit: 3,
			})
			.promise()
			.then((results) => {
				expectTimes(results, [1, 1, 2], "Timing Results");
			});
	});
});

describe("Frequency", () => {
	describe("Global Limit", () => {
		test("Steady Work", () => {
			const pool = new Pool.PromisePoolExecutor({
				frequencyLimit: 2,
				frequencyWindow: TICK,
			});

			const start: number = Date.now();
			return pool
				.addGenericTask({
					generator: () => {
						return Promise.resolve(Date.now() - start);
					},
					invocationLimit: 3,
				})
				.promise()
				.then((results) => {
					expectTimes(results, [0, 0, 1], "Timing Results");
				});
		});

		test("Offset Calls", () => {
			const pool = new Pool.PromisePoolExecutor({
				concurrencyLimit: 1,
				frequencyLimit: 2,
				frequencyWindow: TICK * 3,
			});

			const start: number = Date.now();
			return pool
				.addGenericTask({
					generator: () => {
						return wait(TICK).then(() => Date.now() - start);
					},
					invocationLimit: 4,
				})
				.promise()
				.then((results) => {
					expectTimes(results, [1, 2, 4, 5], "Timing Results");
				});
		});

		test("Work Gap", () => {
			const pool = new Pool.PromisePoolExecutor({
				frequencyLimit: 2,
				frequencyWindow: TICK,
			});

			const start: number = Date.now();
			return pool
				.addGenericTask({
					generator: () => {
						return Promise.resolve(Date.now() - start);
					},
					invocationLimit: 3,
				})
				.promise()
				.then((results) => {
					debug(results);
					expectTimes(results, [0, 0, 1], "Timing Results 1");
					return wait(TICK * 2);
				})
				.then(() => {
					return pool
						.addGenericTask({
							generator: () => {
								return Promise.resolve(Date.now() - start);
							},
							invocationLimit: 3,
						})
						.promise();
				})
				.then((results) => {
					debug(results);
					expectTimes(results, [3, 3, 4], "Timing Results 2");
				});
		});
	});

	test("Group Limit", () => {
		const pool = new Pool.PromisePoolExecutor();
		const group = pool.addGroup({
			frequencyLimit: 2,
			frequencyWindow: TICK,
		});

		const start: number = Date.now();
		return pool
			.addGenericTask({
				generator: () => {
					return Promise.resolve(Date.now() - start);
				},
				groups: [group],
				invocationLimit: 3,
			})
			.promise()
			.then((results) => {
				expectTimes(results, [0, 0, 1], "Timing Results");
				expect((group as any)._frequencyStarts.length).toBeGreaterThanOrEqual(1);
			});
	});

	test("Should Not Collect Timestamps If Not Set", () => {
		const pool = new Pool.PromisePoolExecutor();
		return pool
			.addGenericTask({
				generator: () => Promise.resolve(),
				invocationLimit: 1,
			})
			.promise()
			.then(() => {
				expect((pool as any)._globalGroup._frequencyStarts).toHaveLength(0);
			});
	});
});

describe("Exception Handling", () => {
	test("Generator Function (synchronous)", () => {
		const pool = new Pool.PromisePoolExecutor();

		const error = new Error();
		return expect(
			pool
				.addGenericTask({
					generator: () => {
						throw error;
					},
				})
				.promise(),
		).rejects.toThrowError(error);
	});

	test("Promise Rejection", () => {
		const pool = new Pool.PromisePoolExecutor();

		const error = new Error();
		return expect(
			pool
				.addGenericTask({
					generator: () => {
						return wait(1).then(() => {
							throw error;
						});
					},
					invocationLimit: 1,
				})
				.promise(),
		).rejects.toThrowError(error);
	});

	test("Multi-rejection", () => {
		const pool = new Pool.PromisePoolExecutor();

		const errors = [new Error("First"), new Error("Second")];
		return (
			expect(
				pool
					.addGenericTask({
						generator: (i) => {
							return wait(i ? TICK : 1).then(() => {
								throw errors[i];
							});
						},
						invocationLimit: 2,
					})
					.promise(),
			)
				.rejects.toThrowError(errors[0])
				// Wait to ensure that the second rejection happens within the scope of this test without issue
				.then(() => wait(TICK * 2))
		);
	});

	describe("Invalid Configuration", () => {
		test("Invalid Parameters", () => {
			const pool = new Pool.PromisePoolExecutor();

			expect(() =>
				pool.addGenericTask({
					concurrencyLimit: 0, // invalid
					generator: () => {
						return Promise.resolve();
					},
				}),
			).toThrowError();
		});

		test("Group From Another Pool", () => {
			const pool1 = new Pool.PromisePoolExecutor();
			const pool2 = new Pool.PromisePoolExecutor();

			expect(() =>
				pool1.addGenericTask({
					generator: () => {
						return Promise.resolve();
					},
					groups: [
						pool2.addGroup({
							concurrencyLimit: 1,
						}),
					],
				}),
			).toThrowError();
		});
	});

	describe("Unhandled Rejection", () => {
		test("Generator Function (synchronous)", () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			return Promise.all([
				expectUnhandledRejection(error),
				pool.addGenericTask({
					generator: () => {
						throw error;
					},
					invocationLimit: 1,
				}),
			]);
		});

		test("Promise Rejection", () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			pool.addGenericTask({
				generator: () => {
					return wait(1).then(() => {
						throw error;
					});
				},
				invocationLimit: 1,
			});
			return expectUnhandledRejection(error);
		});

		test("Late Rejection Handling", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			const task = pool.addGenericTask({
				generator: async () => {
					await wait(1);
					throw error;
				},
				invocationLimit: 1,
			});
			await expectUnhandledRejection(error);
			await Promise.all([
				expectHandledRejection(),
				task.promise().catch(() => {
					// discard the error
				}),
			]);
		});

		test("Multi-rejection", () => {
			const pool = new Pool.PromisePoolExecutor();

			const errors = [new Error("first"), new Error("second")];
			errors.forEach((err, i) => {
				// Create a task which fails without the test handling the error
				pool.addGenericTask({
					generator: () => {
						return wait(i ? TICK : 1).then(() => {
							throw err;
						});
					},
					invocationLimit: 1,
				});
			});
			return expectUnhandledRejection(errors[0]).then(() => expectUnhandledRejection(errors[1]));
		});

		// This scenario creates two tasks at the same time
		// The first task rejects but is handled, while the second remains unhandled.
		test("Handled Rejection Followed By Unhandled Rejection", () => {
			const pool = new Pool.PromisePoolExecutor();

			const errors = [new Error("first"), new Error("second")];
			// Create a task which will reject later without being handled
			pool.addGenericTask({
				generator: () => {
					return wait(TICK).then(() => Promise.reject(errors[1]));
				},
				invocationLimit: 1,
			});

			return expect(
				pool
					.addGenericTask({
						generator: () => {
							return wait(1).then(() => Promise.reject(errors[0]));
						},
						invocationLimit: 1,
					})
					.promise(),
			)
				.rejects.toThrowError(errors[0])
				.then(() => {
					return expectUnhandledRejection(errors[1]);
				});
		});

		test("Unhandled Followed By Rejection With pool.waitForIdle", () => {
			const pool = new Pool.PromisePoolExecutor();

			const errors = [new Error("first"), new Error("second")];
			pool.addGenericTask({
				generator: () => Promise.reject(errors[0]),
				invocationLimit: 1,
			});
			// Keep the global group busy so the error will not clear
			pool.addGenericTask({
				generator: () => wait(TICK),
				invocationLimit: 1,
			});
			return expectUnhandledRejection(errors[0])
				.then(() => {
					pool.addGenericTask({
						generator: () => {
							throw errors[1];
						},
						invocationLimit: 1,
					});
					return Promise.all([expectHandledRejection(), expect(pool.waitForIdle()).rejects.toThrowError(errors[0])]);
					// Wait to ensure the task does not throw an unhandled rejection
				})
				.then(() => wait(TICK));
		});
	});

	describe("pool.waitForIdle", () => {
		test("Generator Function (synchronous)", () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			pool.addGenericTask({
				generator: () => {
					throw error;
				},
				invocationLimit: 1,
			});
			return expect(pool.waitForIdle()).rejects.toThrowError(error);
		});

		test("Promise Rejection", () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			pool.addGenericTask({
				generator: () => {
					return wait(1).then(() => {
						throw error;
					});
				},
				invocationLimit: 1,
			});
			return expect(pool.waitForIdle()).rejects.toThrowError(error);
		});

		// In this scenario, a child task fails after its parent does. In this case, only the first error should
		// be received, and the second should be handled by the pool.
		test("Child Task Rejection Shadowed By Parent Rejection", () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error("Parent error");
			let thrown = false;
			const start: number = Date.now();
			pool.addGenericTask({
				generator: () => {
					return wait(TICK).then(() => {
						pool.addGenericTask({
							generator: () => {
								return wait(TICK).then(() => {
									thrown = true;
									throw new Error("Child task error");
								});
							},
							invocationLimit: 1,
						});
						debug("About to throw");
						throw error;
					});
				},
				invocationLimit: 1,
			});
			return expect(pool.waitForIdle())
				.rejects.toThrowError(error)
				.then(() => {
					expectTimes([Date.now() - start], [1], "Timing Results");
					expect(thrown).toBe(false);
					return wait(TICK * 2);
				})
				.then(() => {
					expect(thrown).toBe(true);
				});
		});

		describe("Clearing After Delay", () => {
			test("Promise Rejection", () => {
				const pool = new Pool.PromisePoolExecutor();
				const error = new Error();
				return Promise.all([
					expect(
						pool
							.addGenericTask({
								generator: () => {
									return wait(1).then(() => {
										throw error;
									});
								},
								invocationLimit: 1,
							})
							.promise(),
					).rejects.toThrowError(error),
					wait(TICK)
						.then(() => pool.waitForIdle())
						.catch(() => {
							throw new Error("Error did not clear");
						}),
				]);
			});
		});
	});

	describe("group.waitForIdle", () => {
		test("Generator Function (synchronous)", () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			const group = pool.addGroup({});
			pool.addGenericTask({
				generator: () => {
					throw error;
				},
				groups: [group],
				invocationLimit: 1,
			});
			return expect(group.waitForIdle()).rejects.toThrowError(error);
		});

		test("Promise Rejection", () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			const group = pool.addGroup({});
			pool.addGenericTask({
				generator: () => {
					return wait(1).then(() => {
						throw error;
					});
				},
				groups: [group],
				invocationLimit: 1,
			});
			return expect(group.waitForIdle()).rejects.toThrowError(error);
		});
	});
});

describe("Miscellaneous Features", () => {
	describe("End Task", () => {
		test("From Generator With No Promise", () => {
			const pool = new Pool.PromisePoolExecutor();

			return pool
				.addGenericTask({
					generator() {
						this.end();
					},
				})
				.promise()
				.then((results) => {
					expect(results).toHaveLength(0);
				});
		});

		test("From Generator With Promise", () => {
			const pool = new Pool.PromisePoolExecutor();

			return pool
				.addGenericTask({
					generator() {
						this.end();
						// Add one final promise after ending the task
						return Promise.resolve(1);
					},
				})
				.promise()
				.then((results) => {
					expect(results).toEqual([1]);
				});
		});
	});

	test("Generator Recursion Prevention", () => {
		const pool = new Pool.PromisePoolExecutor();
		let runCount = 0;

		return pool
			.addGenericTask({
				generator() {
					runCount++;
					// Add a task, triggering it to run
					pool.addGenericTask({
						generator: () => {
							// do nothing
						},
					});
				},
			})
			.promise()
			.then(() => {
				expect(runCount).toBe(1);
			});
	});

	test("Pause/Resume Task", () => {
		const pool = new Pool.PromisePoolExecutor();

		const start: number = Date.now();
		const task = pool.addGenericTask({
			generator(index) {
				if (index === 0) {
					this.pause();
				}
				return wait(TICK).then(() => {
					return Date.now() - start;
				});
			},
			invocationLimit: 3,
		});
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		wait(TICK).then(() => {
			task.resume();
		});
		return task.promise().then((results) => {
			// The task must return the expected non-array result
			expectTimes(results, [1, 2, 2], "Timing Results");
		});
	});

	test("Get Task Status", () => {
		const pool = new Pool.PromisePoolExecutor();

		return pool
			.addGenericTask({
				concurrencyLimit: 5,
				frequencyLimit: 5,
				frequencyWindow: 1000,
				generator() {
					return wait(TICK).then(() => {
						return {
							activePromiseCount: this.activePromiseCount,
							concurrencyLimit: this.concurrencyLimit,
							freeSlots: this.freeSlots,
							frequencyLimit: this.frequencyLimit,
							frequencyWindow: this.frequencyWindow,
							invocationLimit: this.invocationLimit,
							invocations: this.invocations,
							state: this.state,
						};
					});
				},
				invocationLimit: 1,
			})
			.promise()
			.then((status) => {
				expect(status[0]).toEqual({
					activePromiseCount: 1,
					concurrencyLimit: 5,
					freeSlots: 0,
					frequencyLimit: 5,
					frequencyWindow: 1000,
					invocationLimit: 1,
					invocations: 1,
					state: Pool.TaskState.Exhausted,
				});
			});
	});

	describe("waitForIdle", () => {
		test("Simple", () => {
			const pool = new Pool.PromisePoolExecutor();

			const start: number = Date.now();
			pool.addGenericTask({
				generator: () => {
					return wait(TICK);
				},
				invocationLimit: 1,
			});
			return pool.waitForIdle().then(() => {
				expectTimes([Date.now() - start], [1], "Timing Results");
			});
		});

		test("Set concurrencyLimit", () => {
			const pool = new Pool.PromisePoolExecutor(1);

			expect(pool.concurrencyLimit).toBe(1);
			pool.concurrencyLimit = 2;
			expect(pool.concurrencyLimit).toBe(2);
		});

		test("Child Task", () => {
			const pool = new Pool.PromisePoolExecutor();

			const start: number = Date.now();
			pool.addGenericTask({
				generator: () => {
					return wait(TICK).then(() => {
						pool.addGenericTask({
							generator: () => {
								return wait(TICK);
							},
							invocationLimit: 1,
						});
					});
				},
				invocationLimit: 1,
			});
			return pool.waitForIdle().then(() => {
				expectTimes([Date.now() - start], [2], "Timing Results");
			});
		});

		test("No Task", () => {
			const pool = new Pool.PromisePoolExecutor();

			return pool.waitForIdle();
		});
	});

	describe("waitForGroupIdle", () => {
		test("Simple", () => {
			const pool = new Pool.PromisePoolExecutor();

			const start: number = Date.now();
			const group = pool.addGroup({});
			pool.addGenericTask({
				generator: () => {
					return wait(TICK);
				},
				groups: [group],
				invocationLimit: 1,
			});
			return group.waitForIdle().then(() => {
				expectTimes([Date.now() - start], [1], "Timing Results");
			});
		});

		test("Child Task", () => {
			const pool = new Pool.PromisePoolExecutor();

			const start: number = Date.now();
			const group = pool.addGroup({});
			pool.addGenericTask({
				generator: () => {
					return wait(TICK).then(() => {
						pool.addGenericTask({
							generator: () => {
								return wait(TICK);
							},
							groups: [group],
							invocationLimit: 1,
						});
					});
				},
				groups: [group],
				invocationLimit: 1,
			});
			return group.waitForIdle().then(() => {
				expectTimes([Date.now() - start], [2], "Timing Results");
			});
		});
	});

	describe("Configure Task", () => {
		test("Invocation Limit Triggers Completion", () => {
			const pool = new Pool.PromisePoolExecutor();

			const start: number = Date.now();
			const task = pool.addGenericTask({
				frequencyLimit: 1,
				frequencyWindow: TICK * 2,
				generator: () => {
					return Promise.resolve(Date.now() - start);
				},
				invocationLimit: 2,
			});
			// eslint-disable-next-line @typescript-eslint/no-floating-promises
			wait(TICK).then(() => {
				task.invocationLimit = 1;
			});
			return task.promise().then((results) => {
				expectTimes([...results, Date.now() - start], [0, 1], "Timing Results");
			});
		});
	});

	describe("Configure Group", () => {
		test("Triggers Promises", () => {
			const pool = new Pool.PromisePoolExecutor();

			const start: number = Date.now();
			const group = pool.addGroup({
				frequencyLimit: 1,
				frequencyWindow: TICK * 2,
			});
			// eslint-disable-next-line @typescript-eslint/no-floating-promises
			wait(TICK).then(() => {
				group.frequencyWindow = 1;
				group.frequencyLimit = 1;
			});
			return pool
				.addGenericTask({
					generator: () => {
						return Promise.resolve(Date.now() - start);
					},
					groups: [group],
					invocationLimit: 2,
				})
				.promise()
				.then((results) => {
					expectTimes(results, [0, 1], "Timing Results");
				});
		});
	});
});

describe("Task Specializations", () => {
	test("Single Task", () => {
		const pool = new Pool.PromisePoolExecutor();

		const start: number = Date.now();
		let iteration = 0;
		return pool
			.addSingleTask({
				data: "test",
				generator: (data) => {
					expect(data).toBe("test");
					// The task cannot run more than once
					expect(iteration++).toBe(0);
					return wait(TICK).then(() => {
						return Date.now() - start;
					});
				},
			})
			.promise()
			.then((result) => {
				debug(`Test result: ${result} (${typeof result})`);
				// The task must return the expected non-array result
				expectTimes([result], [1], "Timing Results");
			});
	});

	test("Linear Task", () => {
		const pool = new Pool.PromisePoolExecutor();

		const start: number = Date.now();
		return pool
			.addLinearTask({
				generator: () => {
					return wait(TICK).then(() => {
						return Date.now() - start;
					});
				},
				invocationLimit: 3,
			})
			.promise()
			.then((results) => {
				expectTimes(results, [1, 2, 3], "Timing Results");
			});
	});

	test("Each Task", () => {
		const pool = new Pool.PromisePoolExecutor();

		const start: number = Date.now();
		return pool
			.addEachTask({
				concurrencyLimit: Infinity,
				data: [3, 2, 1],
				generator: (element) => {
					return wait(TICK * element).then(() => {
						return Date.now() - start;
					});
				},
			})
			.promise()
			.then((results) => {
				expectTimes(results, [3, 2, 1], "Timing Results");
			});
	});

	describe("Batch Task", () => {
		test("Static Batch Size", () => {
			const pool = new Pool.PromisePoolExecutor();

			const start: number = Date.now();
			return pool
				.addBatchTask({
					// Groups the data as [[3, 1], [2]]
					batchSize: 2,
					data: [3, 1, 2],
					generator: (data) => {
						return wait(TICK * sum(data)).then(() => {
							return Date.now() - start;
						});
					},
				})
				.promise()
				.then((results) => {
					expectTimes(results, [4, 2], "Timing Results");
				});
		});

		test("Dynamic Batch Size", () => {
			const pool = new Pool.PromisePoolExecutor();

			const start: number = Date.now();
			return pool
				.addBatchTask({
					batchSize: (elements, freeSlots) => {
						// Groups the data as [[2], [1, 3]]
						return Math.floor(elements / freeSlots);
					},
					concurrencyLimit: 2,
					data: [2, 1, 3],
					generator: (data) => {
						return wait(TICK * sum(data)).then(() => {
							return Date.now() - start;
						});
					},
				})
				.promise()
				.then((results) => {
					expectTimes(results, [2, 4], "Timing Results");
				});
		});
	});

	describe("Persistent Batch Task", () => {
		test("Core Functionality", () => {
			const pool = new Pool.PromisePoolExecutor();
			let runCount = 0;
			const task = pool.addPersistentBatchTask<number, string>({
				generator: (input) => {
					runCount++;
					return wait(TICK).then(() => input.map(String));
				},
			});
			const inputs = [1, 5, 9];
			const start: number = Date.now();
			return Promise.all(
				inputs.map((input) => {
					return task.getResult(input).then((output) => {
						expect(output).toBe(String(input));
						expectTimes([Date.now() - start], [1], "Timing Results");
					});
				}),
			).then(() => {
				expect(runCount).toBe(1);
				// Verify that the task is not storing the results, which would waste memory.
				expect((task as any)._task._result.length).toBe(0);
			});
		});
		test("Offset Batches", () => {
			// Runs two batches of requests, offset so the seconds starts while the first is half finished.
			// The second batch should start before the first finishes.
			const pool = new Pool.PromisePoolExecutor();
			const start: number = Date.now();
			let runCount = 0;
			const task = pool.addPersistentBatchTask<number, string>({
				generator: (input) => {
					runCount++;
					return wait(TICK * 2).then(() => input.map(String));
				},
			});
			const inputs = [
				[1, 9],
				[5, 7],
			];
			return Promise.all(
				inputs.map((input, index) => {
					return wait(index * TICK).then(() =>
						Promise.all(
							input.map((value, index2) => {
								return task.getResult(value).then((result) => {
									expect(result).toBe(String(value));
									expectTimes([Date.now() - start], [index + 2], `Timing result (${index},${index2})`);
								});
							}),
						),
					);
				}),
			).then(() => {
				expect(runCount).toBe(2);
			});
		});
		describe("maxBatchSize", () => {
			test("Core Functionality", () => {
				const pool = new Pool.PromisePoolExecutor();
				let runCount = 0;
				const task = pool.addPersistentBatchTask<number, string>({
					generator: (input) => {
						runCount++;
						return wait(TICK).then(() => input.map(String));
					},
					maxBatchSize: 2,
				});
				const inputs = [1, 5, 9];
				const start: number = Date.now();
				return Promise.all(
					inputs.map((input) => {
						return task.getResult(input).then((output) => {
							expect(output).toBe(String(input));
							expectTimes([Date.now() - start], [1], "Timing Results");
						});
					}),
				).then(() => {
					expect(runCount).toBe(2);
				});
			});
			test("Instant Start", () => {
				const pool = new Pool.PromisePoolExecutor();
				let runCount = 0;
				const task = pool.addPersistentBatchTask<undefined, undefined>({
					generator: (input) => {
						runCount++;
						return wait(TICK).then(() => input);
					},
					maxBatchSize: 2,
				});

				const runCounts = [0, 1, 1];
				return Promise.all(
					runCounts.map((expectedRunCount) => {
						// The generator should be triggered instantly when the max batch size is reached
						const promise = task.getResult(undefined);
						expect(runCount).toBe(expectedRunCount);
						return promise;
					}),
				);
			});
		});
		test("queuingDelay", () => {
			const pool = new Pool.PromisePoolExecutor();
			let runCount = 0;
			const task = pool.addPersistentBatchTask<undefined, undefined>({
				generator: (input) => {
					runCount++;
					return Promise.resolve(new Array(input.length));
				},
				queuingDelay: TICK * 2,
			});
			const delays = [0, 1, 3];
			const start: number = Date.now();
			return Promise.all(
				delays.map((delay) => {
					return wait(delay * TICK)
						.then(() => task.getResult(undefined))
						.then(() => Date.now() - start);
				}),
			).then((results) => {
				expectTimes(results, [2, 2, 5], "Timing Results");
				expect(runCount).toBe(2);
			});
		});
		test("Delay After Hitting Concurrency Limit", () => {
			const pool = new Pool.PromisePoolExecutor();
			let runCount = 0;
			const task = pool.addPersistentBatchTask<undefined, undefined>({
				concurrencyLimit: 1,
				generator: (input) => {
					runCount++;
					return wait(3 * TICK).then(() => new Array(input.length));
				},
				queuingDelay: TICK,
				queuingThresholds: [1, Infinity],
			});
			const start: number = Date.now();
			return Promise.all(
				[
					task.getResult(undefined).then(() => {
						return task.getResult(undefined);
					}),
					wait(2 * TICK).then(() => task.getResult(undefined)),
				].map((promise) => promise.then(() => Date.now() - start)),
			).then((results) => {
				expectTimes(results, [8, 8], "Timing Results");
				expect(runCount).toBe(2);
			});
		});
		describe("queueingThresholds", () => {
			test("Core Functionality", () => {
				const pool = new Pool.PromisePoolExecutor();
				let runCount = 0;
				const task = pool.addPersistentBatchTask<undefined, undefined>({
					generator: (input) => {
						runCount++;
						return wait(5 * TICK).then(() => new Array(input.length));
					},
					queuingThresholds: [1, 2],
				});
				const delays = [0, 1, 2, 3, 4];
				const start: number = Date.now();
				return Promise.all(
					delays.map((delay) => {
						return wait(delay * TICK)
							.then(() => task.getResult(undefined))
							.then(() => Date.now() - start);
					}),
				).then((results) => {
					expectTimes(results, [5, 7, 7, 9, 9], "Timing Results");
					expect(runCount).toBe(3);
				});
			});
			test("Should Trigger On Task Completion", () => {
				const pool = new Pool.PromisePoolExecutor();
				const task = pool.addPersistentBatchTask<undefined, undefined>({
					generator: (input) => {
						return wait(2 * TICK).then(() => new Array(input.length));
					},
					queuingThresholds: [1, 2],
				});
				const delays = [0, 1];
				const start: number = Date.now();
				return Promise.all(
					delays.map((delay) => {
						return wait(delay * TICK)
							.then(() => task.getResult(undefined))
							.then(() => Date.now() - start);
					}),
				).then((results) => {
					expectTimes(results, [2, 4], "Timing Results");
				});
			});
		});
		describe("Retries", () => {
			test("Full", async () => {
				const pool = new Pool.PromisePoolExecutor();
				let batchNumber = 0;
				let runCount = 0;
				const batcher = pool.addPersistentBatchTask<number, number>({
					generator: async (inputs) => {
						runCount++;
						await wait(TICK);
						batchNumber++;
						if (batchNumber < 2) {
							return inputs.map(() => Pool.BATCHER_RETRY_TOKEN);
						}
						return inputs.map((input) => input + 1);
					},
				});
				const start = Date.now();
				const results = await Promise.all(
					[1, 2].map(async (input) => {
						const output = await batcher.getResult(input);
						expect(output).toBe(input + 1);
						return Date.now() - start;
					}),
				);
				expectTimes(results, [2, 2], "Timing Results");
				expect(runCount).toBe(2);
			});
			test("Partial", async () => {
				const pool = new Pool.PromisePoolExecutor();
				let batchNumber = 0;
				let runCount = 0;
				const batcher = pool.addPersistentBatchTask<number, number>({
					generator: async (inputs) => {
						runCount++;
						await wait(TICK);
						batchNumber++;
						return inputs.map((input, index) => {
							return batchNumber < 2 && index < 1 ? Pool.BATCHER_RETRY_TOKEN : input + 1;
						});
					},
				});
				const start = Date.now();
				const results = await Promise.all(
					[1, 2].map(async (input) => {
						const output = await batcher.getResult(input);
						expect(output).toBe(input + 1);
						return Date.now() - start;
					}),
				);
				expectTimes(results, [2, 1], "Timing Results");
				expect(runCount).toBe(2);
			});
			test("Ordering", async () => {
				const pool = new Pool.PromisePoolExecutor();
				const batchInputs: number[][] = [];
				const batcher = pool.addPersistentBatchTask<number, number>({
					generator: async (inputs) => {
						batchInputs.push(inputs);
						await wait(TICK);
						return inputs.map((input, index) => {
							return batchInputs.length < 2 && index < 2 ? Pool.BATCHER_RETRY_TOKEN : input + 1;
						});
					},
					maxBatchSize: 3,
					queuingThresholds: [1, Infinity],
				});
				const start = Date.now();
				const results = await Promise.all(
					[1, 2, 3, 4].map(async (input) => {
						const output = await batcher.getResult(input);
						expect(output).toBe(input + 1);
						return Date.now() - start;
					}),
				);
				expectTimes(results, [2, 2, 1, 2], "Timing Results");
				expect(batchInputs).toEqual([
					[1, 2, 3],
					[1, 2, 4],
				]);
			});
		});
		describe("Send Method", () => {
			test("Single Use", async () => {
				const pool = new Pool.PromisePoolExecutor();
				let runCount = 0;
				const batcher = pool.addPersistentBatchTask<undefined, undefined>({
					generator: async (inputs) => {
						runCount++;
						await wait(TICK);
						return inputs;
					},
					queuingDelay: TICK,
					queuingThresholds: [1, Infinity],
				});
				const start = Date.now();
				const results = await Promise.all(
					[1, 2, 3].map(async (_, index) => {
						const promise = batcher.getResult(undefined);
						if (index === 1) {
							expect(runCount).toBe(0);
							batcher.send();
							expect(runCount).toBe(1);
						}
						await promise;
						return Date.now() - start;
					}),
				);
				expectTimes(results, [1, 1, 3], "Timing Results");
			});
			test("Effect Delayed By queuingThreshold", async () => {
				const pool = new Pool.PromisePoolExecutor();
				let runCount = 0;
				const batcher = pool.addPersistentBatchTask<undefined, undefined>({
					generator: async (inputs) => {
						runCount++;
						await wait(TICK);
						return inputs;
					},
					queuingDelay: TICK,
					queuingThresholds: [1, Infinity],
				});
				const start = Date.now();
				const results = await Promise.all(
					[1, 2, 3].map(async (_, index) => {
						const promise = batcher.getResult(undefined);
						if (index === 1) {
							expect(runCount).toBe(0);
							batcher.send();
							expect(runCount).toBe(1);
						} else if (index === 2) {
							batcher.send();
							expect(runCount).toBe(1);
						}
						await promise;
						return Date.now() - start;
					}),
				);
				expectTimes(results, [1, 1, 2], "Timing Results");
			});
			test("Interaction With Retries", async () => {
				// This tests that the effect of the send method lasts even after a retry
				const pool = new Pool.PromisePoolExecutor();
				let runCount = 0;
				const batcher = pool.addPersistentBatchTask<undefined, undefined>({
					generator: async (inputs) => {
						runCount++;
						await wait(TICK);
						return runCount === 1 ? inputs.map(() => Pool.BATCHER_RETRY_TOKEN) : inputs;
					},
					queuingDelay: TICK,
					queuingThresholds: [1, Infinity],
				});
				const start = Date.now();
				const results = await Promise.all(
					[1, 2, 3].map(async (_, index) => {
						const promise = batcher.getResult(undefined);
						if (index >= 1) {
							batcher.send();
						}
						await promise;
						return Date.now() - start;
					}),
				);
				expect(runCount).toBe(2);
				expectTimes(results, [2, 2, 2], "Timing Results");
			});
		});
		describe("Error Handling", () => {
			test("Single Rejection", () => {
				const pool = new Pool.PromisePoolExecutor();
				const task = pool.addPersistentBatchTask<string, undefined>({
					generator: (input) => {
						return wait(TICK).then(() =>
							input.map((value) => {
								return value === "error" ? new Error("test") : undefined;
							}),
						);
					},
				});

				const inputs = ["a", "error", "b"];
				return Promise.all(
					inputs.map((input) => {
						return task
							.getResult(input)
							.then(() => true)
							.catch((err: Error) => {
								expect(err.message).toBe("test");
								return false;
							});
					}),
				).then((results) => {
					expect(results).toEqual([true, false, true]);
				});
			});
			test("Synchronous Generator Exception Followed By Success", () => {
				const pool = new Pool.PromisePoolExecutor();
				const task = pool.addPersistentBatchTask<number, undefined>({
					generator: (input) => {
						input.forEach((value) => {
							if (value === 0) {
								throw new Error("test");
							}
						});
						return wait(1).then(() => new Array(input.length));
					},
					maxBatchSize: 2,
				});

				const inputs = [0, 1, 2];
				return Promise.all(
					inputs.map((input) => {
						return task
							.getResult(input)
							.then(() => true)
							.catch((err: Error) => {
								expect(err.message).toBe("test");
								return false;
							});
					}),
				).then((results) => {
					expect(results).toEqual([false, false, true]);
				});
			});
			test("Asynchronous Generator Exception Followed By Success", () => {
				const pool = new Pool.PromisePoolExecutor();
				const task = pool.addPersistentBatchTask<number, undefined>({
					generator: (input) => {
						return wait(1).then(() => {
							input.forEach((value) => {
								if (value === 0) {
									throw new Error("test");
								}
							});
							return new Array(input.length);
						});
					},
					maxBatchSize: 2,
				});

				const inputs = [0, 1, 2];
				return Promise.all(
					inputs.map((input) => {
						return task
							.getResult(input)
							.then(() => true)
							.catch((err: Error) => {
								expect(err.message).toBe("test");
								return false;
							});
					}),
				).then((results) => {
					expect(results).toEqual([false, false, true]);
				});
			});
			test("Invalid Output Length", () => {
				const pool = new Pool.PromisePoolExecutor();
				const task = pool.addPersistentBatchTask<number, undefined>({
					generator: (input) => {
						// Respond with an array larger than the input
						return wait(1).then(() => new Array(input.length + 1));
					},
				});

				const inputs = [0, 1, 2];
				return Promise.all(
					inputs.map((input) => {
						return task
							.getResult(input)
							.then(() => true)
							.catch(() => false);
					}),
				).then((results) => {
					expect(results).toEqual([false, false, false]);
				});
			});
			test("End Task", () => {
				const pool = new Pool.PromisePoolExecutor();
				const task = pool.addPersistentBatchTask<undefined, undefined>({
					generator: () => {
						return wait(TICK).then(() => []);
					},
				});
				const firstPromise = task.getResult(undefined);
				task.end();
				expect(task.state).toBe(Pool.TaskState.Terminated);

				return Promise.all(
					[firstPromise, task.getResult(undefined)].map((promise) => {
						return expect(promise).rejects.toThrowError(Error);
					}),
				);
			});
		});
	});
});
