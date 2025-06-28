import timeSpan from "time-span";
import { expectType } from "ts-expect";
import { PromisePoolGroupPrivate } from "../private/group";
import {
	BatchingResult,
	BatchTaskOptions,
	EachTaskOptions,
	GenericTaskConvertedOptions,
	GenericTaskOptions,
	LinearTaskOptions,
	PersistentBatchTask,
	PersistentBatchTaskOptions,
	PromisePoolExecutor,
	PromisePoolGroup,
	PromisePoolGroupOptions,
	PromisePoolTask,
	SingleTaskOptions,
	TaskState,
} from "./imports";
import { catchHandledRejection, catchUnhandledRejection } from "./rejectionEvents";
import { debug, PromisePoolExecutorPrivate, setTimeout, TICK } from "./utils";

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

describe("Typings", () => {
	// eslint-disable-next-line jest/expect-expect
	test("Exports", () => {
		expectType<
			| BatchingResult<never>
			| BatchTaskOptions<unknown, unknown>
			| EachTaskOptions<unknown, unknown>
			| GenericTaskConvertedOptions<unknown, unknown>
			| GenericTaskOptions<unknown>
			| LinearTaskOptions<unknown>
			| PersistentBatchTask<unknown, unknown>
			| PersistentBatchTaskOptions<unknown, unknown>
			| PromisePoolExecutor
			| PromisePoolGroup
			| PromisePoolGroupOptions
			| PromisePoolTask<unknown>
			| SingleTaskOptions<unknown, unknown>
			| TaskState
			| true
		>(true);
	});
});

describe("invocationLimit", () => {
	test("Zero limit", async () => {
		const pool = new PromisePoolExecutor();
		pool.addGenericTask({
			generator: () => setTimeout(TICK),
			invocationLimit: 1,
		});
		expect(pool.activeTaskCount).toBe(1);
		const results = await pool
			.addGenericTask({
				generator: () => 1,
				invocationLimit: 0,
			})
			.promise();
		expect(results).toStrictEqual([]);
		expect(pool.activeTaskCount).toBe(1);
	});
});

describe("concurrencyLimit", () => {
	test("None (Infinite)", async () => {
		const pool = new PromisePoolExecutor();

		const elapsed = timeSpan();
		const results = await pool
			.addGenericTask({
				generator: async () => {
					await setTimeout(TICK);
					return elapsed();
				},
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([TICK, TICK, TICK]);
	});

	test("Pool", async () => {
		const pool = new PromisePoolExecutor(2);

		const elapsed = timeSpan();
		const results = await pool
			.addGenericTask({
				generator: async () => {
					await setTimeout(TICK);
					return elapsed();
				},
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([TICK, TICK, TICK * 2]);
	});

	test("Task", async () => {
		const pool = new PromisePoolExecutor();

		const elapsed = timeSpan();
		const results = await pool
			.addGenericTask({
				concurrencyLimit: 2,
				generator: async () => {
					await setTimeout(TICK);
					return elapsed();
				},
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([TICK, TICK, TICK * 2]);
	});

	test("Group", async () => {
		const pool = new PromisePoolExecutor();
		const group = pool.addGroup({
			concurrencyLimit: 2,
		});

		const elapsed = timeSpan();
		const results = await pool
			.addGenericTask({
				generator: async () => {
					await setTimeout(TICK);
					return elapsed();
				},
				groups: [group],
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([TICK, TICK, TICK * 2]);
	});
});

describe("frequencyLimit", () => {
	describe("Pool", () => {
		test("Steady Work", async () => {
			const pool = new PromisePoolExecutor({
				frequencyLimit: 2,
				frequencyWindow: TICK,
			});

			const elapsed = timeSpan();
			const results = await pool
				.addGenericTask({
					generator: elapsed,
					invocationLimit: 3,
				})
				.promise();
			expect(results).toStrictEqual([0, 0, TICK]);
		});

		test("Offset Calls", async () => {
			const pool = new PromisePoolExecutor({
				concurrencyLimit: 1,
				frequencyLimit: 2,
				frequencyWindow: TICK * 3,
			});

			const elapsed = timeSpan();
			const results = await pool
				.addGenericTask({
					generator: async () => {
						await setTimeout(TICK);
						return elapsed();
					},
					invocationLimit: 4,
				})
				.promise();
			expect(results).toStrictEqual([TICK, 2 * TICK, 4 * TICK, 5 * TICK]);
		});

		test("Work Gap", async () => {
			const pool = new PromisePoolExecutor({
				frequencyLimit: 2,
				frequencyWindow: TICK,
			});

			const elapsed = timeSpan();
			const results = await pool
				.addGenericTask({
					generator: elapsed,
					invocationLimit: 3,
				})
				.promise();
			debug("%o", results);
			expect(results).toStrictEqual([0, 0, TICK]);
			await setTimeout(TICK * 2);
			const results2 = await pool
				.addGenericTask({
					generator: elapsed,
					invocationLimit: 3,
				})
				.promise();
			debug("%o", results2);
			expect(results2).toStrictEqual([3 * TICK, 3 * TICK, 4 * TICK]);
		});
	});

	test("Group", async () => {
		const pool = new PromisePoolExecutor();
		const group = pool.addGroup({
			frequencyLimit: 2,
			frequencyWindow: TICK,
		});

		const elapsed = timeSpan();
		const results = await pool
			.addGenericTask({
				generator: elapsed,
				groups: [group],
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([0, 0, TICK]);
		expect((group as PromisePoolGroupPrivate)._frequencyStarts.length).toBeGreaterThanOrEqual(1);
	});

	test("Should Not Collect Timestamps If Not Set", async () => {
		const pool = new PromisePoolExecutor();
		await pool
			.addGenericTask({
				generator: () => {},
				invocationLimit: 1,
			})
			.promise();
		expect((pool as unknown as PromisePoolExecutorPrivate)._globalGroup._frequencyStarts).toHaveLength(0);
	});
});

describe("Exception Handling", () => {
	test("Generator Function (synchronous)", async () => {
		const pool = new PromisePoolExecutor();

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
		const pool = new PromisePoolExecutor();

		const error = new Error();
		await expect(
			pool
				.addGenericTask({
					generator: async () => {
						await setTimeout(TICK);
						throw error;
					},
					invocationLimit: 1,
				})
				.promise(),
		).rejects.toBe(error);
	});

	test("Multi-rejection", async () => {
		const pool = new PromisePoolExecutor();

		const errors = [new Error("First"), new Error("Second")];
		await expect(
			pool
				.addGenericTask({
					generator: async (i) => {
						await setTimeout(TICK);
						throw errors[i]!;
					},
					invocationLimit: 2,
				})
				.promise(),
		).rejects.toBe(errors[0]);
		// Wait to ensure that the second rejection happens within the scope of this test without issue
		await setTimeout(TICK * 9);
	});

	describe("Unhandled Rejection", () => {
		test("Generator Function (synchronous)", async () => {
			const pool = new PromisePoolExecutor();

			const error = new Error();
			await Promise.all([
				expect(catchUnhandledRejection()).rejects.toBe(error),
				pool.addGenericTask({
					generator: () => {
						throw error;
					},
					invocationLimit: 1,
				}),
			]);
		});

		test("Promise Rejection", async () => {
			const pool = new PromisePoolExecutor();

			const error = new Error();
			pool.addGenericTask({
				generator: async () => {
					await setTimeout(TICK);
					throw error;
				},
				invocationLimit: 1,
			});
			await expect(catchUnhandledRejection()).rejects.toBe(error);
		});

		test("Late Rejection Handling", async () => {
			const pool = new PromisePoolExecutor();

			const error = new Error();
			const task = pool.addGenericTask({
				generator: async () => {
					await setTimeout(TICK);
					throw error;
				},
				invocationLimit: 1,
			});
			await expect(catchUnhandledRejection()).rejects.toBe(error);
			await Promise.all([
				expect(catchHandledRejection()).rejects.toBe(error),
				expect(task.promise()).rejects.toBe(error),
			]);
		});

		test("Multi-rejection", async () => {
			const pool = new PromisePoolExecutor();

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
					throw errors[1];
				},
				invocationLimit: 1,
			});
			await Promise.all([
				expect(catchUnhandledRejection()).rejects.toBe(errors[0]),
				expect(catchUnhandledRejection()).rejects.toBe(errors[1]),
			]);
		});

		// This scenario creates two tasks at the same time
		// The first task rejects but is handled, while the second remains unhandled.
		test("Handled Rejection Followed By Unhandled Rejection", async () => {
			const pool = new PromisePoolExecutor();

			const errors = [new Error("first"), new Error("second")];
			// Create a task which will reject later without being handled
			pool.addGenericTask({
				generator: async () => {
					await setTimeout(TICK);
					throw errors[1]!;
				},
				invocationLimit: 1,
			});

			await expect(
				pool
					.addGenericTask({
						generator: async () => {
							await setTimeout(TICK);
							throw errors[0]!;
						},
						invocationLimit: 1,
					})
					.promise(),
			).rejects.toBe(errors[0]);
			await expect(catchUnhandledRejection()).rejects.toBe(errors[1]);
		});

		test("Unhandled Followed By Rejection With pool.waitForIdle", async () => {
			const pool = new PromisePoolExecutor();

			const errors = [new Error("first"), new Error("second")];
			pool.addGenericTask({
				generator: () => Promise.reject(errors[0]!),
				invocationLimit: 1,
			});
			// Keep the global group busy so the error will not clear
			pool.addGenericTask({
				generator: () => new Promise(() => {}),
				invocationLimit: 1,
			});
			await expect(catchUnhandledRejection()).rejects.toBe(errors[0]);
			pool.addGenericTask({
				generator: () => {
					throw errors[1]!;
				},
				invocationLimit: 1,
			});
			await Promise.all([
				expect(catchHandledRejection()).rejects.toBe(errors[0]),
				expect(pool.waitForIdle()).rejects.toBe(errors[0]),
			]);
			// Wait to ensure the task does not throw an unhandled rejection
			await setTimeout(TICK);
		});
	});

	describe("pool.waitForIdle", () => {
		test("Generator Function (synchronous)", async () => {
			const pool = new PromisePoolExecutor();

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
			const pool = new PromisePoolExecutor();

			const error = new Error();
			pool.addGenericTask({
				generator: async () => {
					await setTimeout(TICK);
					throw error;
				},
				invocationLimit: 1,
			});
			await expect(pool.waitForIdle()).rejects.toBe(error);
		});

		// In this scenario, a child task fails after its parent does. In this case, only the first error should
		// be received, and the second should be handled by the pool.
		test("Child Task Rejection Shadowed By Parent Rejection", async () => {
			const pool = new PromisePoolExecutor();

			const error = new Error("Parent error");
			let thrown = false;
			const elapsed = timeSpan();
			pool.addGenericTask({
				generator: async () => {
					await setTimeout(TICK);
					pool.addGenericTask({
						generator: async () => {
							await setTimeout(TICK);
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
			await setTimeout(TICK * 2);
			expect(thrown).toBe(true);
		});

		describe("Clearing After Delay", () => {
			test("Promise Rejection", async () => {
				const pool = new PromisePoolExecutor();
				const error = new Error();
				await expect(
					pool
						.addGenericTask({
							generator: async () => {
								await setTimeout(TICK);
								throw error;
							},
							invocationLimit: 1,
						})
						.promise(),
				).rejects.toBe(error);
				await setTimeout(TICK);
				await pool.waitForIdle();
			});
		});
	});

	describe("group.waitForIdle", () => {
		test("Generator Function (synchronous)", async () => {
			const pool = new PromisePoolExecutor();

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
			const pool = new PromisePoolExecutor();

			const error = new Error();
			const group = pool.addGroup({});
			pool.addGenericTask({
				generator: async () => {
					await setTimeout(TICK);
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
			const pool = new PromisePoolExecutor();

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
			const pool = new PromisePoolExecutor();

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
		const pool = new PromisePoolExecutor();
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

	test("Get Task Status", async () => {
		const pool = new PromisePoolExecutor();

		const status = await pool
			.addGenericTask({
				concurrencyLimit: 5,
				frequencyLimit: 5,
				frequencyWindow: 1000,
				async generator() {
					await setTimeout(TICK);
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
			state: TaskState.Exhausted,
		});
	});

	describe("waitForIdle", () => {
		test("Simple", async () => {
			const pool = new PromisePoolExecutor();

			const elapsed = timeSpan();
			pool.addGenericTask({
				generator: () => setTimeout(TICK),
				invocationLimit: 1,
			});
			await Promise.all([pool.waitForIdle(), pool.waitForIdle()]);
			expect(elapsed()).toBe(TICK);
		});

		// WES TODO: Wrong category
		test("Set concurrencyLimit", () => {
			const pool = new PromisePoolExecutor(1);

			expect(pool.concurrencyLimit).toBe(1);
			pool.concurrencyLimit = 2;
			expect(pool.concurrencyLimit).toBe(2);
		});

		test("Child Task", async () => {
			const pool = new PromisePoolExecutor();

			const elapsed = timeSpan();
			pool.addGenericTask({
				generator: async () => {
					await setTimeout(TICK);
					pool.addGenericTask({
						generator: () => setTimeout(TICK),
						invocationLimit: 1,
					});
				},
				invocationLimit: 1,
			});
			await pool.waitForIdle();
			expect(elapsed()).toBe(2 * TICK);
		});

		// eslint-disable-next-line jest/expect-expect
		test("No Task", async () => {
			const pool = new PromisePoolExecutor();

			await pool.waitForIdle();
		});
	});

	// TODO: Realtime configuration? Add "Get and Set Pool Status"?
	describe("Configure Task", () => {
		// TODO: Redundant?
		test("invocationLimit Triggers Completion", async () => {
			const pool = new PromisePoolExecutor();

			const elapsed = timeSpan();
			const task = pool.addGenericTask({
				frequencyLimit: 1,
				frequencyWindow: TICK * 2,
				generator: elapsed,
				invocationLimit: 2,
			});
			const [results] = await Promise.all([
				task.promise(),
				(async () => {
					await setTimeout(TICK);
					task.invocationLimit = 1;
				})(),
			]);
			expect([...results, elapsed()]).toStrictEqual([0, TICK]);
		});
	});

	describe("PromisePoolGroup configuration", () => {
		// TODO: Is this needed?
		test("Triggers Promises", async () => {
			const pool = new PromisePoolExecutor();

			const elapsed = timeSpan();
			const group = pool.addGroup({
				frequencyLimit: 1,
				frequencyWindow: TICK * 2,
			});
			const [results] = await Promise.all([
				pool
					.addGenericTask({
						generator: elapsed,
						groups: [group],
						invocationLimit: 2,
					})
					.promise(),
				(async () => {
					await setTimeout(TICK);
					group.frequencyWindow = 1;
					group.frequencyLimit = 1;
				})(),
			]);
			expect(results).toStrictEqual([0, TICK]);
		});
	});
});

describe("Task Specializations", () => {
	test("Single Task", async () => {
		const pool = new PromisePoolExecutor();

		const elapsed = timeSpan();
		let iteration = 0;
		const result = await pool
			.addSingleTask({
				data: "test",
				generator: async (data) => {
					expect(data).toBe("test");
					// The task cannot run more than once
					expect(iteration++).toBe(0);
					await setTimeout(TICK);
					return elapsed();
				},
			})
			.promise();
		debug(`Test result: ${result} (${typeof result})`);
		// The task must return the expected non-array result
		expect(result).toBe(TICK);
	});

	test("Linear Task", async () => {
		const pool = new PromisePoolExecutor();

		const elapsed = timeSpan();
		const results = await pool
			.addLinearTask({
				generator: async () => {
					await setTimeout(TICK);
					return elapsed();
				},
				invocationLimit: 3,
			})
			.promise();
		expect(results).toStrictEqual([TICK, 2 * TICK, 3 * TICK]);
	});

	describe(".addEachTask", () => {
		test("General usage", async () => {
			const pool = new PromisePoolExecutor();

			const elapsed = timeSpan();
			const results = await pool
				.addEachTask({
					concurrencyLimit: Infinity,
					data: [3, 2, 1],
					generator: async (element) => {
						await setTimeout(TICK * element);
						return elapsed();
					},
				})
				.promise();
			expect(results).toStrictEqual([3 * TICK, 2 * TICK, TICK]);
		});

		test("Empty data", async () => {
			const pool = new PromisePoolExecutor();

			const task = pool.addEachTask({
				concurrencyLimit: Infinity,
				data: [],
				generator: async () => 1,
			});
			expect(task.invocations).toBe(0);
			expect(task.state).toBe(TaskState.Terminated);
		});
	});

	describe("Batch Task", () => {
		test("Static Batch Size", async () => {
			const pool = new PromisePoolExecutor();

			const elapsed = timeSpan();
			const results = await pool
				.addBatchTask({
					// Groups the data as [[3, 1], [2]]
					batchSize: 2,
					data: [3, 1, 2],
					generator: async (data) => {
						await setTimeout(TICK * sum(data));
						return elapsed();
					},
				})
				.promise();
			expect(results).toStrictEqual([4 * TICK, 2 * TICK]);
		});

		test("Dynamic Batch Size", async () => {
			const pool = new PromisePoolExecutor();

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
						await setTimeout(TICK * sum(data));
						return elapsed();
					},
				})
				.promise();
			expect(results).toStrictEqual([2 * TICK, 4 * TICK]);
		});

		test("Empty data", async () => {
			const pool = new PromisePoolExecutor();

			const task = pool.addBatchTask({
				batchSize: 2,
				data: [],
				generator: async () => 1,
			});
			expect(task.invocations).toBe(0);
			expect(task.state).toBe(TaskState.Terminated);
		});
	});
});
