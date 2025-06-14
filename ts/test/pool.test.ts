import { setImmediate } from "timers/promises";
import { PromisePoolExecutor } from "./imports";
import { setTimeout, TICK } from "./utils";

describe("Construction", () => {
	test("Default state", () => {
		const pool = new PromisePoolExecutor();
		expect<number>(pool.concurrencyLimit).toBe(Infinity);
		expect<number>(pool.frequencyLimit).toBe(Infinity);
		expect<number>(pool.frequencyWindow).toBe(1000);
		expect<number>(pool.activePromiseCount).toBe(0);
		expect<number>(pool.activeTaskCount).toBe(0);
		expect<number>(pool.freeSlots).toBe(Infinity);
	});
});

describe("Global group config change", () => {
	test("concurrencyLimit change", () => {
		const pool = new PromisePoolExecutor();
		pool.concurrencyLimit = 2;
		expect(pool.concurrencyLimit).toBe(2);
		expect(pool.freeSlots).toBe(2);
	});

	test("frequencyLimit change", () => {
		const pool = new PromisePoolExecutor();
		pool.frequencyLimit = 2;
		expect(pool.frequencyLimit).toBe(2);
		expect(pool.freeSlots).toBe(2);
	});

	test("frequencyWindow change", () => {
		const pool = new PromisePoolExecutor();
		pool.frequencyWindow = TICK;
		expect(pool.frequencyWindow).toBe(TICK);
	});
});

describe("Integration", () => {
	test("Rate limited by global group", async () => {
		const pool = new PromisePoolExecutor({ concurrencyLimit: 1 });
		pool.addGenericTask({
			generator: () => setTimeout(TICK),
			invocationLimit: 2,
		});
		await Promise.all([
			pool.waitForIdle(),
			(async () => {
				expect(pool.activeTaskCount).toBe(1);
				expect(pool.activePromiseCount).toBe(1);
				pool.concurrencyLimit = 2;
				expect(pool.activePromiseCount).toBe(1);
				await setImmediate();
				expect(pool.activePromiseCount).toBe(2);
			})(),
		]);
		expect(pool.activeTaskCount).toBe(0);
	});
});
