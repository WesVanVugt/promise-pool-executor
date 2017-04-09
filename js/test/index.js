"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const Pool = require("../index");
const tick = 50;
const tolerance = 10;
function wait(time) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, time);
    });
}
function expectTimes(a, b, message) {
    chai_1.expect(a).to.have.lengthOf(b.length, message);
    a.forEach((val, i) => {
        chai_1.expect(val).to.be.within(b[i] * tick - tolerance, b[i] * tick + tolerance, message + " (" + i + ")");
    });
}
function sum(nums) {
    let total = 0;
    let i;
    for (i of nums) {
        total += i;
    }
    return total;
}
describe("Concurrency Test", () => {
    it("No Limit", (done) => {
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
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
        let pool = new Pool.PromisePoolExecutor(2);
        let start = Date.now();
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
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
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
describe("Task Secializations Test", () => {
    it("Single Task", (done) => {
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
        let iteration = 0;
        pool.addSingleTask({
            data: "test",
            generator: (data) => {
                chai_1.expect(data).to.equal("test");
                // The task cannot run more than once
                chai_1.expect(iteration++).to.equal(0);
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
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
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
    it("Batch Task", (done) => {
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
        pool.addBatchTask({
            data: [3, 1, 2],
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
});
//# sourceMappingURL=index.js.map