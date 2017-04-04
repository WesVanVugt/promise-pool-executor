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
        chai_1.expect(val).to.be.within(b[i] * tick - tolerance, b[i] * tick + tolerance, message);
    });
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
//# sourceMappingURL=index.js.map