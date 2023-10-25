import { PromisePoolExecutor, TaskState } from "./imports";
import { TICK, nextTick, wait } from "./utils";

describe("Configuration change", () => {
	test("invocationLimit change", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addGenericTask({
			generator: () => wait(TICK),
			invocationLimit: 2,
			concurrencyLimit: 1,
		});
		expect(task.invocations).toBe(1);
		expect(task.invocationLimit).toBe(2);
		expect(task.state).toBe(TaskState.Active);
		task.invocationLimit = 1;
		expect(task.invocations).toBe(1);
		expect(task.invocationLimit).toBe(1);
		expect(task.state).toBe(TaskState.Exhausted);
	});

	test("concurrencyLimit change", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addGenericTask({
			generator: () => wait(TICK),
			invocationLimit: 2,
			concurrencyLimit: 1,
		});
		expect(task.invocations).toBe(1);
		expect(task.concurrencyLimit).toBe(1);
		task.concurrencyLimit = 2;
		expect(task.concurrencyLimit).toBe(2);
		expect(task.invocations).toBe(1);
		await nextTick();
		expect(task.invocations).toBe(2);
	});

	test("frequencyLimit change", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addGenericTask({
			generator: () => wait(TICK),
			invocationLimit: 2,
			frequencyLimit: 1,
		});
		expect(task.invocations).toBe(1);
		task.frequencyLimit = 2;
		expect(task.frequencyLimit).toBe(2);
		expect(task.invocations).toBe(1);
		await nextTick();
		expect(task.invocations).toBe(2);
	});

	test("frequencyWindow change", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addGenericTask({
			generator: () => wait(TICK * 2),
			invocationLimit: 2,
			frequencyLimit: 1,
			frequencyWindow: TICK * 9,
		});
		expect(task.invocations).toBe(1);
		await wait(TICK);
		task.frequencyWindow = TICK;
		expect(task.frequencyWindow).toBe(TICK);
		expect(task.invocations).toBe(1);
		await nextTick();
		expect(task.invocations).toBe(2);
	});
});

describe("Invalid Configuration", () => {
	test("invocationLimit not a number", () => {
		const pool = new PromisePoolExecutor();
		expect(() =>
			pool.addGenericTask({
				invocationLimit: "a" as unknown as number,
				generator: () => {},
			}),
		).toThrow(/^Invalid invocationLimit: a$/);
	});

	test("invocationLimit is NaN", () => {
		const pool = new PromisePoolExecutor();
		expect(() =>
			pool.addGenericTask({
				invocationLimit: NaN,
				generator: () => {},
			}),
		).toThrow(/^Invalid invocationLimit: NaN$/);
	});

	test("Group From Another Pool", () => {
		const pool1 = new PromisePoolExecutor();
		const pool2 = new PromisePoolExecutor();
		expect(() =>
			pool1.addGenericTask({
				generator: () => {},
				groups: [pool2.addGroup({ concurrencyLimit: 1 })],
			}),
		).toThrow(/^options.groups contains a group belonging to a different pool$/);
	});
});

describe("resultConverter", () => {
	test("Error handling", async () => {
		const pool = new PromisePoolExecutor();
		const err = new Error("a");
		await expect(() =>
			pool
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
