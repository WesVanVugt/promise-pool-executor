import timeSpan from "time-span";
import util from "util";
import * as Pool from "../index";
import { autoAdvanceTimers } from "./setup";

const realSetTimeout = setTimeout;
const realWait = util.promisify(setTimeout);
const debug = util.debuglog("promise-pool-executor:test");

// Verify that the types needed can be imported
const typingImportTest:
	| Pool.PromisePoolExecutor
	// Group
	| Pool.PromisePoolGroup
	| Pool.PromisePoolGroupOptions
	// General Tasks
	| Pool.PromisePoolTask<unknown>
	| Pool.GenericTaskOptions<unknown>
	| Pool.GenericTaskConvertedOptions<unknown, unknown>
	| Pool.SingleTaskOptions<unknown, unknown>
	| Pool.LinearTaskOptions<unknown>
	| Pool.BatchTaskOptions<unknown, unknown>
	| Pool.EachTaskOptions<unknown, unknown>
	| Pool.TaskState
	// Persistent Batch Task
	| Pool.PersistentBatchTask<unknown, unknown>
	| Pool.PersistentBatchTaskOptions<unknown, unknown>
	| Pool.BatchingResult<never>
	| undefined = undefined;
// TODO: Use ts-expect?
if (typingImportTest) {
	// satisfy TypeScript's need to use the variable
}

interface PromisePoolGroupPrivate extends Pool.PromisePoolGroup {
	readonly _frequencyStarts: readonly number[];
}

interface PromisePoolTaskPrivate extends Pool.PromisePoolTask<unknown> {
	readonly _result?: unknown[];
}

interface PersistentBatchTaskPrivate extends Pool.PersistentBatchTask<unknown, unknown> {
	readonly _task: PromisePoolTaskPrivate;
}

interface PromisePoolExecutorPrivate extends Pool.PromisePoolGroup {
	readonly _globalGroup: PromisePoolGroupPrivate;
}

/**
 * Milliseconds per tick.
 */
const TICK = 100;

/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
const wait = (ms: number) =>
	new Promise<void>((res) => {
		setTimeout(res, ms);
	});

const waitForUnhandledRejection = (): Promise<void> => {
	process._original().removeListener("unhandledRejection", unhandledRejectionListener);

	return new Promise((resolve, reject) => {
		const timeout = realSetTimeout(() => {
			resetUnhandledRejectionListener();
			resolve();
		}, 1);

		process._original().prependOnceListener("unhandledRejection", (err) => {
			clearTimeout(timeout);
			debug("Caught unhandledRejection");
			resetUnhandledRejectionListener();
			reject(err);
		});
	});
};

const expectHandledRejection = async () =>
	new Promise<void>((resolve, reject) => {
		const timeout = realSetTimeout(() => {
			resetHandledRejectionListener();
			reject(new Error("Rejection Not Handled"));
		}, 1);

		process._original().removeAllListeners("rejectionHandled");
		process._original().prependOnceListener("rejectionHandled", () => {
			clearTimeout(timeout);
			debug("rejectionHandled");
			resetHandledRejectionListener();
			resolve();
		});
	});

/**
 * Expects an unhandled promise rejection.
 * @param expectedError The error expected to be received with the rejection (optional).
 */
const expectUnhandledRejection = async (expectedError: Error) => {
	await expect(waitForUnhandledRejection()).rejects.toBe(expectedError);
};

/**
 * Returns the sum of an array of numbers.
 */
const sum = (nums: number[]) => {
	let total = 0;
	let i: number;
	for (i of nums) {
		total += i;
	}
	return total;
};

const unhandledRejectionListener = (err: unknown) => {
	debug("unhandledRejectionListener: %O", err);
	// Fail the test
	throw err;
};

const rejectionHandledListener = () => {
	debug("Unexpected rejectionHandled event");
	// Fail the test
	throw new Error("Unexpected rejectionHandled event");
};

const resetUnhandledRejectionListener = () => {
	process._original().removeAllListeners("unhandledRejection");
	process._original().addListener("unhandledRejection", unhandledRejectionListener);
};

const resetHandledRejectionListener = () => {
	process._original().removeAllListeners("rejectionHandled");
	process._original().addListener("rejectionHandled", rejectionHandledListener);
};

beforeAll(() => {
	jest.useFakeTimers();
	autoAdvanceTimers();
});

beforeEach(() => {
	jest.clearAllTimers();
	resetUnhandledRejectionListener();
	resetHandledRejectionListener();
});

describe("Concurrency", () => {
	test("No Limit", async () => {
		const pool = new Pool.PromisePoolExecutor();

		const elapsed = timeSpan();
		const results = await pool
			.addGenericTask({
				generator: async () => {
					await wait(TICK);
					return elapsed();
				},
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([TICK, TICK, TICK]);
	});

	test("Global Limit", async () => {
		const pool = new Pool.PromisePoolExecutor(2);

		const elapsed = timeSpan();
		const results = await pool
			.addGenericTask({
				generator: async () => {
					await wait(TICK);
					return elapsed();
				},
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([TICK, TICK, TICK * 2]);
	});

	test("Task Limit", async () => {
		const pool = new Pool.PromisePoolExecutor();

		const elapsed = timeSpan();
		const results = await pool
			.addGenericTask({
				concurrencyLimit: 2,
				generator: async () => {
					await wait(TICK);
					return elapsed();
				},
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([TICK, TICK, TICK * 2]);
	});

	test("Group Limit", async () => {
		const pool = new Pool.PromisePoolExecutor();
		const group = pool.addGroup({
			concurrencyLimit: 2,
		});

		const elapsed = timeSpan();
		const results = await pool
			.addGenericTask({
				generator: async () => {
					await wait(TICK);
					return elapsed();
				},
				groups: [group],
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([TICK, TICK, TICK * 2]);
	});
});

describe("Frequency", () => {
	describe("Global Limit", () => {
		test("Steady Work", async () => {
			const pool = new Pool.PromisePoolExecutor({
				frequencyLimit: 2,
				frequencyWindow: TICK,
			});

			const elapsed = timeSpan();
			const results = await pool
				.addGenericTask({
					generator: () => {
						return Promise.resolve(elapsed());
					},
					invocationLimit: 3,
				})
				.promise();
			expect(results).toStrictEqual([0, 0, TICK]);
		});

		test("Offset Calls", async () => {
			const pool = new Pool.PromisePoolExecutor({
				concurrencyLimit: 1,
				frequencyLimit: 2,
				frequencyWindow: TICK * 3,
			});

			const elapsed = timeSpan();
			const results = await pool
				.addGenericTask({
					generator: async () => {
						await wait(TICK);
						return elapsed();
					},
					invocationLimit: 4,
				})
				.promise();
			expect(results).toStrictEqual([TICK, 2 * TICK, 4 * TICK, 5 * TICK]);
		});

		test("Work Gap", async () => {
			const pool = new Pool.PromisePoolExecutor({
				frequencyLimit: 2,
				frequencyWindow: TICK,
			});

			const elapsed = timeSpan();
			const results = await pool
				.addGenericTask({
					generator: () => {
						return Promise.resolve(elapsed());
					},
					invocationLimit: 3,
				})
				.promise();
			debug("%o", results);
			expect(results).toStrictEqual([0, 0, TICK]);
			await wait(TICK * 2);
			const results2 = await pool
				.addGenericTask({
					generator: () => {
						return Promise.resolve(elapsed());
					},
					invocationLimit: 3,
				})
				.promise();
			debug("%o", results2);
			expect(results2).toStrictEqual([3 * TICK, 3 * TICK, 4 * TICK]);
		});
	});

	test("Group Limit", async () => {
		const pool = new Pool.PromisePoolExecutor();
		const group = pool.addGroup({
			frequencyLimit: 2,
			frequencyWindow: TICK,
		});

		const elapsed = timeSpan();
		const results = await pool
			.addGenericTask({
				generator: () => {
					return Promise.resolve(elapsed());
				},
				groups: [group],
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([0, 0, TICK]);
		expect((group as PromisePoolGroupPrivate)._frequencyStarts.length).toBeGreaterThanOrEqual(1);
	});

	test("Should Not Collect Timestamps If Not Set", async () => {
		const pool = new Pool.PromisePoolExecutor();
		await pool
			.addGenericTask({
				generator: () => Promise.resolve(),
				invocationLimit: 1,
			})
			.promise();
		expect((pool as unknown as PromisePoolExecutorPrivate)._globalGroup._frequencyStarts).toHaveLength(0);
	});
});

describe("Exception Handling", () => {
	test("Generator Function (synchronous)", async () => {
		const pool = new Pool.PromisePoolExecutor();

		const error = new Error();
		await expect(
			pool
				.addGenericTask({
					generator: () => {
						throw error;
					},
				})
				.promise(),
		).rejects.toBe(error);
	});

	test("Promise Rejection", async () => {
		const pool = new Pool.PromisePoolExecutor();

		const error = new Error();
		await expect(
			pool
				.addGenericTask({
					generator: async () => {
						await wait(1);
						throw error;
					},
					invocationLimit: 1,
				})
				.promise(),
		).rejects.toBe(error);
	});

	test("Multi-rejection", async () => {
		const pool = new Pool.PromisePoolExecutor();

		const errors = [new Error("First"), new Error("Second")];
		await expect(
			pool
				.addGenericTask({
					generator: async (i) => {
						await wait(i ? TICK : 1);
						throw errors[i];
					},
					invocationLimit: 2,
				})
				.promise(),
		).rejects.toBe(errors[0]);
		// Wait to ensure that the second rejection happens within the scope of this test without issue
		await wait(TICK * 2);
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
			).toThrowError(/^Invalid concurrency limit: 0$/);
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
			).toThrowError(/^options.groups contains a group belonging to a different pool$/);
		});
	});

	describe("Unhandled Rejection", () => {
		test("Generator Function (synchronous)", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			await Promise.all([
				expectUnhandledRejection(error),
				pool.addGenericTask({
					generator: () => {
						throw error;
					},
					invocationLimit: 1,
				}),
			]);
		});

		test("Promise Rejection", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			pool.addGenericTask({
				generator: async () => {
					await wait(1);
					throw error;
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
			await Promise.all([expectHandledRejection(), expect(task.promise()).rejects.toBe(error)]);
		});

		test("Multi-rejection", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const errors = [new Error("first"), new Error("second")] as const;
			// Create a task which fails without the test handling the error
			pool.addGenericTask({
				generator: async () => {
					throw errors[0];
				},
				invocationLimit: 1,
			});
			pool.addGenericTask({
				generator: async () => {
					await realWait(1);
					throw errors[1];
				},
				invocationLimit: 1,
			});
			await expectUnhandledRejection(errors[0]);
			await expectUnhandledRejection(errors[1]);
		});

		// This scenario creates two tasks at the same time
		// The first task rejects but is handled, while the second remains unhandled.
		test("Handled Rejection Followed By Unhandled Rejection", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const errors = [new Error("first"), new Error("second")];
			// Create a task which will reject later without being handled
			pool.addGenericTask({
				generator: async () => {
					await wait(TICK);
					throw errors[1];
				},
				invocationLimit: 1,
			});

			await expect(
				pool
					.addGenericTask({
						generator: async () => {
							await wait(1);
							throw errors[0];
						},
						invocationLimit: 1,
					})
					.promise(),
			).rejects.toBe(errors[0]);
			await expectUnhandledRejection(errors[1]);
		});

		test("Unhandled Followed By Rejection With pool.waitForIdle", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const errors = [new Error("first"), new Error("second")];
			pool.addGenericTask({
				generator: () => Promise.reject(errors[0]),
				invocationLimit: 1,
			});
			// Keep the global group busy so the error will not clear
			pool.addGenericTask({
				generator: () => realWait(1),
				invocationLimit: 1,
			});
			await expectUnhandledRejection(errors[0]);
			pool.addGenericTask({
				generator: () => {
					throw errors[1];
				},
				invocationLimit: 1,
			});
			await Promise.all([expectHandledRejection(), expect(pool.waitForIdle()).rejects.toBe(errors[0])]);
			// Wait to ensure the task does not throw an unhandled rejection
			await wait(TICK);
		});
	});

	describe("pool.waitForIdle", () => {
		test("Generator Function (synchronous)", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			pool.addGenericTask({
				generator: () => {
					throw error;
				},
				invocationLimit: 1,
			});
			await expect(pool.waitForIdle()).rejects.toBe(error);
		});

		test("Promise Rejection", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			pool.addGenericTask({
				generator: async () => {
					await wait(1);
					throw error;
				},
				invocationLimit: 1,
			});
			await expect(pool.waitForIdle()).rejects.toBe(error);
		});

		// In this scenario, a child task fails after its parent does. In this case, only the first error should
		// be received, and the second should be handled by the pool.
		test("Child Task Rejection Shadowed By Parent Rejection", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error("Parent error");
			let thrown = false;
			const elapsed = timeSpan();
			pool.addGenericTask({
				generator: async () => {
					await wait(TICK);
					pool.addGenericTask({
						generator: async () => {
							await wait(TICK);
							thrown = true;
							throw new Error("Child task error");
						},
						invocationLimit: 1,
					});
					debug("About to throw");
					throw error;
				},
				invocationLimit: 1,
			});
			await expect(pool.waitForIdle()).rejects.toBe(error);
			expect(elapsed()).toStrictEqual(TICK);
			expect(thrown).toBe(false);
			await wait(TICK * 2);
			expect(thrown).toBe(true);
		});

		describe("Clearing After Delay", () => {
			test("Promise Rejection", async () => {
				const pool = new Pool.PromisePoolExecutor();
				const error = new Error();
				await Promise.all([
					expect(
						pool
							.addGenericTask({
								generator: async () => {
									await wait(1);
									throw error;
								},
								invocationLimit: 1,
							})
							.promise(),
					).rejects.toBe(error),
					(async () => {
						await wait(TICK);
						await pool.waitForIdle();
					})(),
				]);
			});
		});
	});

	describe("group.waitForIdle", () => {
		test("Generator Function (synchronous)", async () => {
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
			await expect(group.waitForIdle()).rejects.toBe(error);
		});

		test("Promise Rejection", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const error = new Error();
			const group = pool.addGroup({});
			pool.addGenericTask({
				generator: async () => {
					await wait(1);
					throw error;
				},
				groups: [group],
				invocationLimit: 1,
			});
			await expect(group.waitForIdle()).rejects.toBe(error);
		});
	});
});

describe("Miscellaneous Features", () => {
	describe("End Task", () => {
		test("From Generator With No Promise", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const results = await pool
				.addGenericTask({
					generator() {
						this.end();
					},
				})
				.promise();
			expect(results).toHaveLength(0);
		});

		test("From Generator With Promise", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const results = await pool
				.addGenericTask({
					generator() {
						this.end();
						// Add one final promise after ending the task
						return Promise.resolve(1);
					},
				})
				.promise();
			expect(results).toEqual([1]);
		});
	});

	test("Generator Recursion Prevention", async () => {
		const pool = new Pool.PromisePoolExecutor();
		let runCount = 0;

		await pool
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
			.promise();
		expect(runCount).toBe(1);
	});

	test("Pause/Resume Task", async () => {
		const pool = new Pool.PromisePoolExecutor();

		const elapsed = timeSpan();
		const task = pool.addGenericTask({
			async generator(index) {
				if (index === 0) {
					this.pause();
				}
				await wait(TICK);
				return elapsed();
			},
			invocationLimit: 3,
		});
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		wait(TICK).then(() => {
			task.resume();
		});
		const results = await task.promise();
		// The task must return the expected non-array result
		expect(results).toStrictEqual([TICK, 2 * TICK, 2 * TICK]);
	});

	test("Get Task Status", async () => {
		const pool = new Pool.PromisePoolExecutor();

		const status = await pool
			.addGenericTask({
				concurrencyLimit: 5,
				frequencyLimit: 5,
				frequencyWindow: 1000,
				async generator() {
					await wait(TICK);
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
				},
				invocationLimit: 1,
			})
			.promise();
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

	describe("waitForIdle", () => {
		test("Simple", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const elapsed = timeSpan();
			pool.addGenericTask({
				generator: () => wait(TICK),
				invocationLimit: 1,
			});
			await pool.waitForIdle();
			expect(elapsed()).toBe(TICK);
		});

		test("Set concurrencyLimit", () => {
			const pool = new Pool.PromisePoolExecutor(1);

			expect(pool.concurrencyLimit).toBe(1);
			pool.concurrencyLimit = 2;
			expect(pool.concurrencyLimit).toBe(2);
		});

		test("Child Task", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const elapsed = timeSpan();
			pool.addGenericTask({
				generator: async () => {
					await wait(TICK);
					pool.addGenericTask({
						generator: () => wait(TICK),
						invocationLimit: 1,
					});
				},
				invocationLimit: 1,
			});
			await pool.waitForIdle();
			expect(elapsed()).toBe(2 * TICK);
		});

		test("No Task", async () => {
			const pool = new Pool.PromisePoolExecutor();

			await pool.waitForIdle();
		});
	});

	describe("waitForGroupIdle", () => {
		test("Simple", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const elapsed = timeSpan();
			const group = pool.addGroup({});
			pool.addGenericTask({
				generator: () => wait(TICK),
				groups: [group],
				invocationLimit: 1,
			});
			await group.waitForIdle();
			expect(elapsed()).toBe(TICK);
		});

		test("Child Task", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const elapsed = timeSpan();
			const group = pool.addGroup({});
			pool.addGenericTask({
				generator: async () => {
					await wait(TICK);
					pool.addGenericTask({
						generator: () => wait(TICK),
						groups: [group],
						invocationLimit: 1,
					});
				},
				groups: [group],
				invocationLimit: 1,
			});
			await group.waitForIdle();
			expect(elapsed()).toBe(2 * TICK);
		});
	});

	describe("Configure Task", () => {
		test("Invocation Limit Triggers Completion", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const elapsed = timeSpan();
			const task = pool.addGenericTask({
				frequencyLimit: 1,
				frequencyWindow: TICK * 2,
				generator: () => {
					return Promise.resolve(elapsed());
				},
				invocationLimit: 2,
			});
			// eslint-disable-next-line @typescript-eslint/no-floating-promises
			wait(TICK).then(() => {
				task.invocationLimit = 1;
			});
			const results = await task.promise();
			expect([...results, elapsed()]).toStrictEqual([0, TICK]);
		});
	});

	describe("Configure Group", () => {
		test("Triggers Promises", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const elapsed = timeSpan();
			const group = pool.addGroup({
				frequencyLimit: 1,
				frequencyWindow: TICK * 2,
			});
			// eslint-disable-next-line @typescript-eslint/no-floating-promises
			wait(TICK).then(() => {
				group.frequencyWindow = 1;
				group.frequencyLimit = 1;
			});
			const results = await pool
				.addGenericTask({
					generator: () => {
						return Promise.resolve(elapsed());
					},
					groups: [group],
					invocationLimit: 2,
				})
				.promise();
			expect(results).toStrictEqual([0, TICK]);
		});
	});
});

describe("Task Specializations", () => {
	test("Single Task", async () => {
		const pool = new Pool.PromisePoolExecutor();

		const elapsed = timeSpan();
		let iteration = 0;
		const result = await pool
			.addSingleTask({
				data: "test",
				generator: async (data) => {
					expect(data).toBe("test");
					// The task cannot run more than once
					expect(iteration++).toBe(0);
					await wait(TICK);
					return elapsed();
				},
			})
			.promise();
		debug(`Test result: ${result} (${typeof result})`);
		// The task must return the expected non-array result
		expect(result).toBe(TICK);
	});

	test("Linear Task", async () => {
		const pool = new Pool.PromisePoolExecutor();

		const elapsed = timeSpan();
		const results = await pool
			.addLinearTask({
				generator: async () => {
					await wait(TICK);
					return elapsed();
				},
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([TICK, 2 * TICK, 3 * TICK]);
	});

	test("Each Task", async () => {
		const pool = new Pool.PromisePoolExecutor();

		const elapsed = timeSpan();
		const results = await pool
			.addEachTask({
				concurrencyLimit: Infinity,
				data: [3, 2, 1],
				generator: async (element) => {
					await wait(TICK * element);
					return elapsed();
				},
			})
			.promise();
		expect(results).toStrictEqual([3 * TICK, 2 * TICK, TICK]);
	});

	describe("Batch Task", () => {
		test("Static Batch Size", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const elapsed = timeSpan();
			const results = await pool
				.addBatchTask({
					// Groups the data as [[3, 1], [2]]
					batchSize: 2,
					data: [3, 1, 2],
					generator: async (data) => {
						await wait(TICK * sum(data));
						return elapsed();
					},
				})
				.promise();
			expect(results).toStrictEqual([4 * TICK, 2 * TICK]);
		});

		test("Dynamic Batch Size", async () => {
			const pool = new Pool.PromisePoolExecutor();

			const elapsed = timeSpan();
			const results = await pool
				.addBatchTask({
					batchSize: (elements, freeSlots) => {
						// Groups the data as [[2], [1, 3]]
						return Math.floor(elements / freeSlots);
					},
					concurrencyLimit: 2,
					data: [2, 1, 3],
					generator: async (data) => {
						await wait(TICK * sum(data));
						return elapsed();
					},
				})
				.promise();
			expect(results).toStrictEqual([2 * TICK, 4 * TICK]);
		});
	});

	describe("Persistent Batch Task", () => {
		test("Core Functionality", async () => {
			const pool = new Pool.PromisePoolExecutor();
			let runCount = 0;
			const task = pool.addPersistentBatchTask<number, string>({
				generator: async (input) => {
					runCount++;
					await wait(TICK);
					return input.map(String);
				},
			});
			const inputs = [1, 5, 9];
			const elapsed = timeSpan();
			await Promise.all(
				inputs.map(async (input) => {
					const output = await task.getResult(input);
					expect(output).toBe(String(input));
					expect(elapsed()).toBe(TICK + 1);
				}),
			);
			expect(runCount).toBe(1);
			// Verify that the task is not storing the results, which would waste memory.
			expect((task as PersistentBatchTaskPrivate)._task._result!.length).toBe(0);
		});
		test("Offset Batches", async () => {
			// Runs two batches of requests, offset so the seconds starts while the first is half finished.
			// The second batch should start before the first finishes.
			const pool = new Pool.PromisePoolExecutor();
			const elapsed = timeSpan();
			let runCount = 0;
			const task = pool.addPersistentBatchTask<number, string>({
				generator: async (input) => {
					runCount++;
					await wait(TICK * 2);
					return input.map(String);
				},
			});
			const inputs = [
				[1, 9],
				[5, 7],
			];
			const results = await Promise.all(
				inputs.map(async (input, index) => {
					await wait(index * TICK);
					return Promise.all(
						input.map(async (value) => {
							const result = await task.getResult(value);
							expect(result).toBe(String(value));
							return elapsed();
						}),
					);
				}),
			);
			expect(results).toStrictEqual([
				[2 * TICK + 1, 2 * TICK + 1],
				[3 * TICK + 1, 3 * TICK + 1],
			]);
			expect(runCount).toBe(2);
		});
		describe("maxBatchSize", () => {
			test("Core Functionality", async () => {
				const pool = new Pool.PromisePoolExecutor();
				let runCount = 0;
				const task = pool.addPersistentBatchTask<number, string>({
					generator: async (input) => {
						runCount++;
						await wait(TICK);
						return input.map(String);
					},
					maxBatchSize: 2,
				});
				const inputs = [1, 5, 9];
				const elapsed = timeSpan();
				const results = await Promise.all(
					inputs.map(async (input) => {
						const output = await task.getResult(input);
						expect(output).toBe(String(input));
						return elapsed();
					}),
				);
				expect(results).toStrictEqual([TICK, TICK, TICK + 1]);
				expect(runCount).toBe(2);
			});
			test("Instant Start", async () => {
				const pool = new Pool.PromisePoolExecutor();
				let runCount = 0;
				const task = pool.addPersistentBatchTask<undefined, undefined>({
					generator: async (input) => {
						runCount++;
						await wait(TICK);
						return input;
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
		test("queuingDelay", async () => {
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
			const elapsed = timeSpan();
			const results = await Promise.all(
				delays.map(async (delay) => {
					await wait(delay * TICK);
					await task.getResult(undefined);
					return elapsed();
				}),
			);
			expect(results).toStrictEqual([2 * TICK, 2 * TICK, 5 * TICK]);
			expect(runCount).toBe(2);
		});
		test("Delay After Hitting Concurrency Limit", async () => {
			const pool = new Pool.PromisePoolExecutor();
			let runCount = 0;
			const task = pool.addPersistentBatchTask<undefined, undefined>({
				concurrencyLimit: 1,
				generator: async (input) => {
					runCount++;
					await wait(3 * TICK);
					return new Array<undefined>(input.length);
				},
				queuingDelay: TICK,
				queuingThresholds: [1, Infinity],
			});
			const elapsed = timeSpan();
			await Promise.all([
				(async () => {
					await task.getResult(undefined);
					await task.getResult(undefined);
					expect(elapsed()).toBe(TICK * 8);
				})(),
				(async () => {
					await wait(2 * TICK);
					await task.getResult(undefined);
					expect(elapsed()).toBe(TICK * 8);
				})(),
			]);
			expect(runCount).toBe(2);
		});
		describe("queueingThresholds", () => {
			test("Core Functionality", async () => {
				const pool = new Pool.PromisePoolExecutor();
				let runCount = 0;
				const task = pool.addPersistentBatchTask<undefined, undefined>({
					generator: async (input) => {
						runCount++;
						await wait(5 * TICK);
						return new Array<undefined>(input.length);
					},
					queuingThresholds: [1, 2],
				});
				const delays = [0, 1, 2, 3, 4];
				const elapsed = timeSpan();
				const results = await Promise.all(
					delays.map(async (delay) => {
						await wait(delay * TICK);
						await task.getResult(undefined);
						return elapsed();
					}),
				);
				expect(results).toStrictEqual([5 * TICK + 1, 7 * TICK + 1, 7 * TICK + 1, 9 * TICK + 1, 9 * TICK + 1]);
				expect(runCount).toBe(3);
			});
			test("Should Trigger On Task Completion", async () => {
				const pool = new Pool.PromisePoolExecutor();
				const task = pool.addPersistentBatchTask<undefined, undefined>({
					generator: async (input) => {
						await wait(2 * TICK);
						return new Array<undefined>(input.length);
					},
					queuingThresholds: [1, 2],
				});
				const delays = [0, 1];
				const elapsed = timeSpan();
				const results = await Promise.all(
					delays.map(async (delay) => {
						await wait(delay * TICK);
						await task.getResult(undefined);
						return elapsed();
					}),
				);
				expect(results).toStrictEqual([2 * TICK + 1, 4 * TICK + 2]);
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
				const elapsed = timeSpan();
				const results = await Promise.all(
					[1, 2].map(async (input) => {
						const output = await batcher.getResult(input);
						expect(output).toBe(input + 1);
						return elapsed();
					}),
				);
				expect(results).toStrictEqual([2 * TICK + 2, 2 * TICK + 2]);
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
				const elapsed = timeSpan();
				const results = await Promise.all(
					[1, 2].map(async (input) => {
						const output = await batcher.getResult(input);
						expect(output).toBe(input + 1);
						return elapsed();
					}),
				);
				expect(results).toStrictEqual([2 * TICK + 2, TICK + 1]);
				expect(runCount).toBe(2);
			});
			test("Ordering", async () => {
				const pool = new Pool.PromisePoolExecutor();
				const batchInputs: number[][] = [];
				const batcher = pool.addPersistentBatchTask<number, number>({
					generator: async (inputs) => {
						batchInputs.push(inputs.slice());
						await wait(TICK);
						return inputs.map((input, index) => {
							return batchInputs.length < 2 && index < 2 ? Pool.BATCHER_RETRY_TOKEN : input + 1;
						});
					},
					maxBatchSize: 3,
					queuingThresholds: [1, Infinity],
				});
				const elapsed = timeSpan();
				const results = await Promise.all(
					[1, 2, 3, 4].map(async (input) => {
						const output = await batcher.getResult(input);
						expect(output).toBe(input + 1);
						return elapsed();
					}),
				);
				expect(results).toStrictEqual([2 * TICK, 2 * TICK, TICK, 2 * TICK]);
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
				const elapsed = timeSpan();
				const results = await Promise.all(
					[1, 2, 3].map(async (_, index) => {
						const promise = batcher.getResult(undefined);
						if (index === 1) {
							expect(runCount).toBe(0);
							batcher.send();
							expect(runCount).toBe(1);
						}
						await promise;
						return elapsed();
					}),
				);
				expect(results).toStrictEqual([TICK, TICK, 3 * TICK]);
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
				const elapsed = timeSpan();
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
						return elapsed();
					}),
				);
				expect(results).toStrictEqual([TICK, TICK, 2 * TICK]);
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
				const elapsed = timeSpan();
				const results = await Promise.all(
					[1, 2, 3].map(async (_, index) => {
						const promise = batcher.getResult(undefined);
						if (index >= 1) {
							batcher.send();
						}
						await promise;
						return elapsed();
					}),
				);
				expect(runCount).toBe(2);
				expect(results).toStrictEqual([2 * TICK, 2 * TICK, 2 * TICK]);
			});
		});
		describe("Error Handling", () => {
			test("Single Rejection", async () => {
				const pool = new Pool.PromisePoolExecutor();
				const error = new Error();
				const task = pool.addPersistentBatchTask<string, undefined>({
					generator: async (input) => {
						await wait(TICK);
						return input.map((value) => (value === "error" ? error : undefined));
					},
				});

				await Promise.all([
					task.getResult("a"),
					expect(task.getResult("error")).rejects.toBe(error),
					task.getResult("b"),
				]);
			});
			test("Synchronous Generator Exception Followed By Success", async () => {
				const pool = new Pool.PromisePoolExecutor();
				const error = new Error();
				const task = pool.addPersistentBatchTask<number, undefined>({
					generator: async (input) => {
						if (input.includes(0)) {
							throw error;
						}
						await wait(1);
						return new Array<undefined>(input.length);
					},
					maxBatchSize: 2,
				});

				await Promise.all([
					expect(task.getResult(0)).rejects.toBe(error),
					expect(task.getResult(1)).rejects.toBe(error),
					task.getResult(2),
				]);
			});
			test("Asynchronous Generator Exception Followed By Success", async () => {
				const pool = new Pool.PromisePoolExecutor();
				const error = new Error();
				const task = pool.addPersistentBatchTask<number, undefined>({
					generator: async (input) => {
						await wait(1);
						if (input.includes(0)) {
							throw error;
						}
						return new Array<undefined>(input.length);
					},
					maxBatchSize: 2,
				});

				await Promise.all([
					expect(task.getResult(0)).rejects.toBe(error),
					expect(task.getResult(1)).rejects.toBe(error),
					task.getResult(2),
				]);
			});
			test("Invalid Output Length", async () => {
				const pool = new Pool.PromisePoolExecutor();
				const task = pool.addPersistentBatchTask<number, undefined>({
					generator: async (input) => {
						await wait(1);
						// Respond with an array larger than the input
						return new Array<undefined>(input.length + 1);
					},
				});

				await Promise.all([
					expect(task.getResult(0)).rejects.toThrowError(
						/^batchingFunction output length does not equal the input length$/,
					),
					expect(task.getResult(1)).rejects.toThrowError(
						/^batchingFunction output length does not equal the input length$/,
					),
					expect(task.getResult(2)).rejects.toThrowError(
						/^batchingFunction output length does not equal the input length$/,
					),
				]);
			});
			test("End Task", async () => {
				const pool = new Pool.PromisePoolExecutor();
				const task = pool.addPersistentBatchTask<undefined, undefined>({
					generator: async () => {
						await wait(TICK);
						return [];
					},
				});
				const firstPromise = task.getResult(undefined);
				task.end();
				expect(task.state).toBe(Pool.TaskState.Terminated);

				await Promise.all([
					expect(firstPromise).rejects.toThrowError(/^This task has ended and cannot process more items$/),
					expect(task.getResult(undefined)).rejects.toThrowError(/^This task has ended and cannot process more items$/),
				]);
			});
		});
	});
});
