import { PromisePoolExecutor } from "./imports";
import { TICK, nextTick, wait } from "./utils";

describe("Configuration change", () => {
	test("concurrencyLimit change", async () => {
		const pool = new PromisePoolExecutor();
		const group = pool.addGroup({ concurrencyLimit: 1 });
		const task = pool.addGenericTask({
			generator: () => wait(TICK),
			groups: [group],
			invocationLimit: 2,
		});
		expect(task.invocations).toBe(1);
		group.concurrencyLimit = 2;
		expect(group.concurrencyLimit).toBe(2);
		expect(task.invocations).toBe(1);
		await nextTick();
		expect(task.invocations).toBe(2);
	});

	test("frequencyLimit change", async () => {
		const pool = new PromisePoolExecutor();
		const group = pool.addGroup({ frequencyLimit: 1 });
		const task = pool.addGenericTask({
			generator: () => wait(TICK),
			groups: [group],
			invocationLimit: 2,
		});
		expect(task.invocations).toBe(1);
		group.frequencyLimit = 2;
		expect(group.frequencyLimit).toBe(2);
		expect(task.invocations).toBe(1);
		await nextTick();
		expect(task.invocations).toBe(2);
	});

	test("frequencyWindow change", async () => {
		const pool = new PromisePoolExecutor();
		const group = pool.addGroup({ frequencyLimit: 1, frequencyWindow: TICK * 9 });
		const task = pool.addGenericTask({
			generator: () => wait(TICK * 2),
			groups: [group],
			invocationLimit: 2,
		});
		expect(task.invocations).toBe(1);
		await wait(TICK);
		group.frequencyWindow = TICK;
		expect(group.frequencyWindow).toBe(TICK);
		expect(task.invocations).toBe(1);
		await nextTick();
		expect(task.invocations).toBe(2);
	});
});
