import { expect } from "chai";
import * as Pool from "../index";

const tick: number = 50;
const tolerance: number = 10;

function wait(time: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, time);
    });
}

function expectTimes(a: number[], b: number[], message: string) {
    expect(a).to.have.lengthOf(b.length, message);
    a.forEach((val, i) => {
        expect(val).to.be.within(b[i] * tick - tolerance, b[i] * tick + tolerance, message + " (" + i + ")");
    });
}

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