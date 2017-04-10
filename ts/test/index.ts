import { expect } from "chai";
import * as Pool from "../index";

/**
 * Milliseconds per tick.
 */
const tick: number = 50;
/**
 * Milliseconds tolerance for tests, above or below the target.
 */
const tolerance: number = 15;

/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
function wait(time: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, time);
    });
}

/**
 * Expects an array of result times (ms) to be within the tolerance range of the specified numbers of target ticks.
 */
function expectTimes(resultTimes: number[], targetTicks: number[], message: string) {
    expect(resultTimes).to.have.lengthOf(targetTicks.length, message);
    resultTimes.forEach((val, i) => {
        expect(val).to.be.within(targetTicks[i] * tick - tolerance, targetTicks[i] * tick + tolerance, message + " (" + i + ")");
    });
}

/**
 * Returns the sum of an array of numbers.
 */
function sum(nums: number[]): number {
    let total: number = 0;
    let i: number;
    for (i of nums) {
        total += i;
    }
    return total;
}

describe("Concurrency", () => {
    it("No Limit", (done) => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        pool.addGenericTask({
            generator: () => {
                return wait(tick)
                    .then(() => {
                        return Date.now() - start;
                    });
            },
            invocationLimit: 3,
        }).then((results) => {
            expectTimes(results, [1, 1, 1], "Timing Results");
            done();
        }).catch(done);
    });

    it("Global Limit", (done) => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor(2);

        let start: number = Date.now();
        pool.addGenericTask({
            generator: () => {
                return wait(tick)
                    .then(() => {
                        return Date.now() - start;
                    });
            },
            invocationLimit: 3,
        }).then((results) => {
            expectTimes(results, [1, 1, 2], "Timing Results");
            done();
        }).catch(done);
    });

    it("Task Limit", (done) => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        pool.addGenericTask({
            generator: () => {
                return wait(tick)
                    .then(() => {
                        return Date.now() - start;
                    });
            },
            invocationLimit: 3,
            concurrencyLimit: 2,
        }).then((results) => {
            expectTimes(results, [1, 1, 2], "Timing Results");
            done();
        }).catch(done);
    });
});

describe("Exception Handling", () => {
    it("Generator Function", (done) => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let error: Error = new Error();
        let caught: boolean = false;
        pool.addGenericTask({
            generator: () => {
                throw error;
            }
        }).catch((err) => {
            expect(err).to.equal(error);
            caught = true;
        }).then((results) => {
            expect(caught).to.equal(true, "Must throw an error");
            done();
        }).catch(done);
    })

    it("Promise Rejection", (done) => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let error: Error = new Error();
        let caught: boolean = false;
        pool.addGenericTask({
            generator: () => {
                return wait(1).then(() => {
                    throw error;
                });
            },
            invocationLimit: 1
        }).catch((err) => {
            expect(err).to.equal(error);
            caught = true;
        }).then((results) => {
            expect(caught).to.equal(true, "Must throw an error");
            done();
        }).catch(done);
    })
});

describe("Miscellaneous Features", () => {
    it("Stop Task", (done) => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        let id: Symbol = Symbol();
        pool.addGenericTask({
            id: id,
            generator: (index) => {
                if (index >= 2) {
                    expect(pool.stopTask(id)).to.equal(true, "Stop task must succede");
                }
                return wait(tick)
                    .then(() => {
                        return Date.now() - start;
                    });
            }
        }).then((results) => {
            // The task must return the expected non-array result
            expectTimes(results, [1, 1, 1], "Timing Results");
            done();
        }).catch(done);
    });

    it("Get Task Status", (done) => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        let id: Symbol = Symbol();
        pool.addGenericTask({
            id: id,
            generator: (index) => {
                return wait(tick)
                    .then(() => {
                        let status: Pool.TaskStatus = pool.getTaskStatus(id);
                        expect(status).to.deep.equal({
                            id: id,
                            activeCount: 1,
                            concurrencyLimit: 5,
                            invocations: 1,
                            invocationLimit: 1,
                            freeSlots: 0,
                        } as Pool.TaskStatus);
                    });
            },
            invocationLimit: 1,
            concurrencyLimit: 5,
        }).then(() => {
            done();
        }).catch(done);
    })
});

describe("Task Secializations", () => {
    it("Single Task", (done) => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        let iteration: number = 0;
        pool.addSingleTask({
            data: "test",
            generator: (data) => {
                expect(data).to.equal("test");
                // The task cannot run more than once
                expect(iteration++).to.equal(0);
                return wait(tick)
                    .then(() => {
                        return Date.now() - start;
                    });
            }
        }).then((result) => {
            // The task must return the expected non-array result
            expectTimes([result], [1], "Timing Results");
            done();
        }).catch(done);
    });

    it("Linear Task", (done) => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        pool.addLinearTask({
            generator: (element) => {
                return wait(tick)
                    .then(() => {
                        return Date.now() - start;
                    });
            },
            invocationLimit: 3
        }).then((results) => {
            expectTimes(results, [1, 2, 3], "Timing Results");
            done();
        }).catch(done);
    });

    it("Each Task", (done) => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        pool.addEachTask({
            data: [3, 2, 1],
            generator: (element) => {
                return wait(tick * element)
                    .then(() => {
                        return Date.now() - start;
                    });
            },
            concurrencyLimit: Infinity,
        }).then((results) => {
            expectTimes(results, [3, 2, 1], "Timing Results");
            done();
        }).catch(done);
    });

    describe("Batch Task", () => {

        it("Static Batch Size", (done) => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
            pool.addBatchTask({
                data: [3, 1, 2],
                // Groups the data as [[3, 1], [2]]
                batchSize: 2,
                generator: (data) => {
                    return wait(tick * sum(data))
                        .then(() => {
                            return Date.now() - start;
                        });
                }
            }).then((results) => {
                expectTimes(results, [4, 2], "Timing Results");
                done();
            }).catch(done);
        });

        it("Dynamic Batch Size", (done) => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
            pool.addBatchTask({
                data: [2, 1, 3],
                batchSize: (elements, freeSlots) => {
                    // Groups the data as [[2], [1, 3]]
                    return Math.floor(elements / freeSlots);
                },
                generator: (data) => {
                    return wait(tick * sum(data))
                        .then(() => {
                            return Date.now() - start;
                        });
                },
                concurrencyLimit: 2
            }).then((results) => {
                expectTimes(results, [2, 4], "Timing Results");
                done();
            }).catch(done);
        });
    });
});