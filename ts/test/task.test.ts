import { PromisePoolExecutor, TaskState } from "./imports";
import { setTimeout, setImmediate, TICK } from "./utils";

describe("Configuration change", () => {
	test("invocationLimit change", async () => {
		const task = new PromisePoolExecutor().addGenericTask({
			generator: () => setTimeout(TICK),
			invocationLimit: 2,
			concurrencyLimit: 1,
		});
		expect<number>(task.invocations).toBe(1);
		expect<number>(task.invocationLimit).toBe(2);
		expect<number>(task.state).toBe(TaskState.Active);
		task.invocationLimit = 1;
		expect<number>(task.invocations).toBe(1);
		expect<number>(task.invocationLimit).toBe(1);
		expect<TaskState>(task.state).toBe(TaskState.Exhausted);
	});

	test("concurrencyLimit change", async () => {
		const task = new PromisePoolExecutor().addGenericTask({
			generator: () => setTimeout(TICK),
			invocationLimit: 2,
			concurrencyLimit: 1,
		});
		expect(task.invocations).toBe(1);
		expect(task.concurrencyLimit).toBe(1);
		task.concurrencyLimit = 2;
		expect(task.concurrencyLimit).toBe(2);
		expect(task.invocations).toBe(1);
		await setImmediate();
		expect(task.invocations).toBe(2);
	});

	test("frequencyLimit change", async () => {
		const task = new PromisePoolExecutor().addGenericTask({
			generator: () => setTimeout(TICK),
			invocationLimit: 2,
			frequencyLimit: 1,
		});
		expect(task.invocations).toBe(1);
		task.frequencyLimit = 2;
		expect(task.frequencyLimit).toBe(2);
		expect(task.invocations).toBe(1);
		await setImmediate();
		expect(task.invocations).toBe(2);
	});

	test("frequencyWindow change", async () => {
		const task = new PromisePoolExecutor().addGenericTask({
			generator: () => setTimeout(TICK * 2),
			invocationLimit: 2,
			frequencyLimit: 1,
			frequencyWindow: TICK * 9,
		});
		expect(task.invocations).toBe(1);
		await setTimeout(TICK);
		expect(task.invocations).toBe(1);
		task.frequencyWindow = TICK;
		expect(task.frequencyWindow).toBe(TICK);
		expect(task.invocations).toBe(1);
		await setImmediate();
		expect(task.invocations).toBe(2);
	});
});

describe("Invalid Configuration", () => {
	test("invocationLimit not a number", () => {
		expect(() =>
			new PromisePoolExecutor().addGenericTask({
				invocationLimit: "a" as unknown as number,
				generator: () => {},
			}),
		).toThrow(/^Invalid invocationLimit: a$/);
	});

	test("invocationLimit is NaN", () => {
		expect(() =>
			new PromisePoolExecutor().addGenericTask({
				invocationLimit: NaN,
				generator: () => {},
			}),
		).toThrow(/^Invalid invocationLimit: NaN$/);
	});

	test("Group From Another Pool", () => {
		expect(() =>
			new PromisePoolExecutor().addGenericTask({
				generator: () => {},
				groups: [new PromisePoolExecutor().addGroup({ concurrencyLimit: 1 })],
			}),
		).toThrow(/^options.groups contains a group belonging to a different pool$/);
	});
});

describe("resultConverter", () => {
	test("Error handling", async () => {
		const err = new Error("a");
		await expect(() =>
			new PromisePoolExecutor()
				.addGenericTask({
					invocationLimit: 1,
					generator: () => 1,
					resultConverter: () => {
						throw err;
					},
				})
				.promise(),
		).rejects.toBe(err);
	});
});

describe(".addGenericTask", () => {
	test("Synchronous infinite loop protection", async () => {
		const warn = jest.spyOn(console, "warn").mockImplementation();
		const task = new PromisePoolExecutor().addGenericTask({
			generator: async () => {
				await setTimeout(TICK);
			},
		});
		expect(task.activePromiseCount).toBe(100002);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith("[PromisePoolExecutor] Throttling task with activePromiseCount %o.", 100002);
		warn.mockClear();
		await setImmediate();
		expect(task.activePromiseCount).toBe(100003);
		expect(warn).not.toHaveBeenCalled();
	});
});

describe(".addBatchTask", () => {
	test("Invalid batchSize", () => {
		const pool = new PromisePoolExecutor();
		expect(() => pool.addBatchTask({ batchSize: NaN, data: [], generator: () => undefined })).toThrow(
			/^Invalid batchSize: NaN$/,
		);
		expect(() => pool.addBatchTask({ batchSize: -1, data: [], generator: () => undefined })).toThrow(
			/^Invalid batchSize: -1$/,
		);
		expect(() =>
			pool.addBatchTask({ batchSize: "a" as unknown as number, data: [], generator: () => undefined }),
		).toThrow(/^Invalid batchSize: a$/);
	});

	test("batchSize function returns invalid value", async () => {
		const pool = new PromisePoolExecutor();
		await expect(
			pool.addBatchTask({ batchSize: () => NaN, data: [1], generator: () => undefined }).promise(),
		).rejects.toThrow(/^Invalid batchSize: NaN$/);
		await expect(
			pool.addBatchTask({ batchSize: () => -1, data: [1], generator: () => undefined }).promise(),
		).rejects.toThrow(/^Invalid batchSize: -1$/);
		await expect(
			pool.addBatchTask({ batchSize: () => "a" as unknown as number, data: [1], generator: () => undefined }).promise(),
		).rejects.toThrow(/^Invalid batchSize: a$/);
	});
});
