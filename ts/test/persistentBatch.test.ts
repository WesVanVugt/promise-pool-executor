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
		const task = pool.addPersistentBatchTask({
			generator: () => [],
		});
		task.concurrencyLimit = 2;
		expect(task.concurrencyLimit).toBe(2);
	});

	test("frequencyLimit change", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addPersistentBatchTask({
			generator: () => [],
		});
		task.frequencyLimit = 2;
		expect(task.frequencyLimit).toBe(2);
	});

	test("frequencyWindow change", async () => {
		const pool = new PromisePoolExecutor();
		const task = pool.addPersistentBatchTask({
			generator: () => [],
		});
		task.frequencyWindow = TICK;
		expect(task.frequencyWindow).toBe(TICK);
	});
});
