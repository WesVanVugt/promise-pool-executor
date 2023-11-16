import timeSpan from "time-span";
import { PromisePoolExecutor, TaskState } from "./imports";
import { TICK } from "./utils";

describe("Construction", () => {
	test("Default state", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addPersistentBatchTask({
			generator: () => [],
		});
		expect<number>(task.concurrencyLimit).toBe(Infinity);
		expect<number>(task.frequencyLimit).toBe(Infinity);
		expect<number>(task.frequencyWindow).toBe(1000);
		expect<number>(task.activePromiseCount).toBe(0);
		expect<number>(task.freeSlots).toBe(Infinity);
		expect<TaskState>(task.state).toBe(TaskState.Paused);
	});
});

describe("Configuration change", () => {
	test("concurrencyLimit change", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addPersistentBatchTask({ generator: () => [] });
		task.concurrencyLimit = 2;
		expect(task.concurrencyLimit).toBe(2);
	});

	test("frequencyLimit change", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addPersistentBatchTask({ generator: () => [] });
		task.frequencyLimit = 2;
		expect(task.frequencyLimit).toBe(2);
	});

	test("frequencyWindow change", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addPersistentBatchTask({ generator: () => [] });
		task.frequencyWindow = TICK;
		expect(task.frequencyWindow).toBe(TICK);
	});
});

describe("Integration", () => {
	test("Rate limited by task", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addPersistentBatchTask<number, string>({
			frequencyLimit: 1,
			frequencyWindow: TICK,
			generator: (input) => input.map(String),
		});
		const elapsed = timeSpan();
		expect(await task.getResult(1)).toBe("1");
		expect(elapsed()).toBe(1);
		expect(await task.getResult(2)).toBe("2");
		expect(elapsed()).toBe(TICK + 1);
	});

	test("PersistentBatchTask.endTask()", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addPersistentBatchTask({ generator: () => [] });
		await Promise.all([
			expect(task.getResult(undefined)).rejects.toThrow(/^This task has ended and cannot process more items$/),
			(async () => {
				task.end();
				expect(task.state).toBe(TaskState.Terminated);
				await expect(task.getResult(undefined)).rejects.toThrow(/^This task has ended and cannot process more items$/);
			})(),
		]);
	});

	test("PersistentBatchTask.send()", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addPersistentBatchTask<number, string>({
			generator: (input) => input.map(String),
		});
		const elapsed = timeSpan();
		await Promise.all([
			expect(task.getResult(1)).resolves.toBe("1"),
			(async () => {
				expect(task.activePromiseCount).toBe(0);
				task.send();
				expect(task.activePromiseCount).toBe(1);
			})(),
		]);
		expect(elapsed()).toBe(0);
	});
});
