import { setImmediate } from "timers/promises";
import { PromisePoolExecutor } from "./imports";
import { setTimeout, TICK } from "./utils";

describe("Construction", () => {
	test("Default state", async () => {
		const pool = new PromisePoolExecutor();
		const group = pool.addGroup();
		expect<number>(group.concurrencyLimit).toBe(Infinity);
		expect<number>(group.frequencyLimit).toBe(Infinity);
		expect<number>(group.frequencyWindow).toBe(1000);
		expect<number>(group.activePromiseCount).toBe(0);
		expect<number>(group.activeTaskCount).toBe(0);
		expect<number>(group.freeSlots).toBe(Infinity);
	});
});

describe("Configuration change", () => {
	test("concurrencyLimit change", async () => {
		const pool = new PromisePoolExecutor();
		const group = pool.addGroup({ concurrencyLimit: 1 });
		const task = pool.addGenericTask({
			generator: () => setTimeout(TICK),
			groups: [group],
			invocationLimit: 2,
		});
		expect(task.invocations).toBe(1);
		group.concurrencyLimit = 2;
		expect(group.concurrencyLimit).toBe(2);
		expect(task.invocations).toBe(1);
		await setImmediate();
		expect(task.invocations).toBe(2);
	});

	test("frequencyLimit change", async () => {
		const pool = new PromisePoolExecutor();
		const group = pool.addGroup({ frequencyLimit: 1 });
		const task = pool.addGenericTask({
			generator: () => setTimeout(TICK),
			groups: [group],
			invocationLimit: 2,
		});
		expect(task.invocations).toBe(1);
		group.frequencyLimit = 2;
		expect(group.frequencyLimit).toBe(2);
		expect(task.invocations).toBe(1);
		await setImmediate();
		expect(task.invocations).toBe(2);
	});

	test("frequencyWindow change", async () => {
		const pool = new PromisePoolExecutor();
		const group = pool.addGroup({ frequencyLimit: 1, frequencyWindow: TICK * 9 });
		const task = pool.addGenericTask({
			generator: () => setTimeout(TICK * 2),
			groups: [group],
			invocationLimit: 2,
		});
		expect(task.invocations).toBe(1);
		await setTimeout(TICK);
		group.frequencyWindow = TICK;
		expect(group.frequencyWindow).toBe(TICK);
		expect(task.invocations).toBe(1);
		await setImmediate();
		expect(task.invocations).toBe(2);
	});
});

describe("Invalid Configuration", () => {
	test("concurrencyLimit not a number", () => {
		const pool = new PromisePoolExecutor();
		expect(() => pool.addGroup({ concurrencyLimit: "a" as unknown as number })).toThrow(
			/^Invalid concurrencyLimit: a$/,
		);
	});

	test("concurrencyLimit is NaN", () => {
		const pool = new PromisePoolExecutor();
		expect(() => pool.addGroup({ concurrencyLimit: NaN })).toThrow(/^Invalid concurrencyLimit: NaN$/);
	});

	test("frequencyLimit not a number", () => {
		const pool = new PromisePoolExecutor();
		expect(() => pool.addGroup({ frequencyLimit: "a" as unknown as number })).toThrow(/^Invalid frequencyLimit: a$/);
	});

	test("frequencyLimit is NaN", () => {
		const pool = new PromisePoolExecutor();
		expect(() => pool.addGroup({ frequencyLimit: NaN })).toThrow(/^Invalid frequencyLimit: NaN$/);
	});

	test("frequencyWindow not a number", () => {
		const pool = new PromisePoolExecutor();
		expect(() => pool.addGroup({ frequencyWindow: "a" as unknown as number })).toThrow(/^Invalid frequencyWindow: a$/);
	});

	test("frequencyWindow is NaN", () => {
		const pool = new PromisePoolExecutor();
		expect(() => pool.addGroup({ frequencyWindow: NaN })).toThrow(/^Invalid frequencyWindow: NaN$/);
	});
});
