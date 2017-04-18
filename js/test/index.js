"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const Pool = require("../index");
/**
 * Milliseconds per tick.
 */
const tick = 50;
/**
 * Milliseconds tolerance for tests, above or below the target.
 */
const tolerance = 20;
/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
function wait(time) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, time);
    });
}
/**
 * Expects an array of result times (ms) to be within the tolerance range of the specified numbers of target ticks.
 */
function expectTimes(resultTimes, targetTicks, message) {
    chai_1.expect(resultTimes).to.have.lengthOf(targetTicks.length, message);
    resultTimes.forEach((val, i) => {
        chai_1.expect(val).to.be.within(targetTicks[i] * tick - tolerance, targetTicks[i] * tick + tolerance, message + " (" + i + ")");
    });
}
/**
 * Expects an unhandled promise rejection.
 * @param expectedError The error expected to be received with the rejection (optional).
 */
function expectUnhandledRejection(expectedError, delay) {
    process.removeListener("unhandledRejection", unhandledRejectionListener);
    let reAdded = false;
    let error;
    process.prependOnceListener("unhandledRejection", (err, test, test2) => {
        if (!reAdded) {
            error = err;
            // Catch any extra unhandled rejections which could occur before
            process.addListener("unhandledRejection", unhandledRejectionListener);
            reAdded = true;
        }
    });
    return wait(delay || tick).then(() => {
        if (!reAdded) {
            process.addListener("unhandledRejection", unhandledRejectionListener);
            reAdded = true;
            throw new Error("Expected unhandledRejection to be thrown.");
        }
        if (expectedError) {
            chai_1.expect(error).to.equal(expectedError);
        }
        else {
            chai_1.expect(error).to.be.instanceof(Error);
        }
    });
}
/**
 * Returns the sum of an array of numbers.
 */
function sum(nums) {
    let total = 0;
    let i;
    for (i of nums) {
        total += i;
    }
    return total;
}
function unhandledRejectionListener(err) {
    // Fail the test
    throw new Error("UnhandledPromiseRejection: " + err.message);
}
before(() => {
    process.addListener("unhandledRejection", unhandledRejectionListener);
});
describe("Concurrency", () => {
    it("No Limit", () => {
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
        return pool.addGenericTask({
            generator: () => {
                return wait(tick)
                    .then(() => {
                    return Date.now() - start;
                });
            },
            invocationLimit: 3,
        }).then((results) => {
            expectTimes(results, [1, 1, 1], "Timing Results");
        });
    });
    it("Global Limit", () => {
        let pool = new Pool.PromisePoolExecutor(2);
        let start = Date.now();
        return pool.addGenericTask({
            generator: () => {
                return wait(tick)
                    .then(() => {
                    return Date.now() - start;
                });
            },
            invocationLimit: 3,
        }).then((results) => {
            expectTimes(results, [1, 1, 2], "Timing Results");
        });
    });
    it("Task Limit", () => {
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
        return pool.addGenericTask({
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
        });
    });
});
describe("Exception Handling", () => {
    it("Generator Function (synchronous)", () => {
        let pool = new Pool.PromisePoolExecutor();
        let error = new Error();
        let caught = false;
        return pool.addGenericTask({
            generator: () => {
                throw error;
            }
        }).catch((err) => {
            chai_1.expect(err).to.equal(error);
            caught = true;
        }).then((results) => {
            chai_1.expect(caught).to.equal(true, "Must throw an error");
        });
    });
    it("Promise Rejection", () => {
        let pool = new Pool.PromisePoolExecutor();
        let error = new Error();
        let caught = false;
        return pool.addGenericTask({
            generator: () => {
                return wait(1).then(() => {
                    throw error;
                });
            },
            invocationLimit: 1
        }).catch((err) => {
            chai_1.expect(err).to.equal(error);
            caught = true;
        }).then((results) => {
            chai_1.expect(caught).to.equal(true, "Must throw an error");
        });
    });
    describe("Unhandled Rejection", () => {
        it("Generator Function (synchronous)", () => {
            let pool = new Pool.PromisePoolExecutor();
            let error = new Error();
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return expectUnhandledRejection(error);
        });
        it("Promise Rejection", () => {
            let pool = new Pool.PromisePoolExecutor();
            let error = new Error();
            pool.addGenericTask({
                generator: () => {
                    return wait(1).then(() => {
                        throw error;
                    });
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return expectUnhandledRejection(error);
        });
        it("Invalid Parameters", () => {
            let pool = new Pool.PromisePoolExecutor();
            pool.addGenericTask({
                generator: () => {
                    return Promise.resolve();
                },
                concurrencyLimit: 0,
                noPromise: true,
            });
            return expectUnhandledRejection();
        });
        it("Multi-rejection", () => {
            let pool = new Pool.PromisePoolExecutor();
            let errors = [new Error("First"), new Error("Second")];
            let caught;
            pool.addGenericTask({
                generator: (i) => {
                    return wait(i ? tick : 1).then(() => {
                        throw errors[i];
                    });
                },
                invocationLimit: 2,
            }).catch((err) => {
                caught = err;
            });
            return expectUnhandledRejection(errors[1], tick * 2).then(() => {
                chai_1.expect(caught).to.equal(errors[0]);
            });
        });
    });
    describe("waitForIdle", () => {
        it("Generator Function (synchronous)", () => {
            let pool = new Pool.PromisePoolExecutor();
            let error = new Error();
            let caught = false;
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return pool.waitForIdle().catch((err) => {
                chai_1.expect(err).to.equal(error);
                caught = true;
            }).then((results) => {
                chai_1.expect(caught).to.equal(true, "Must throw an error");
            });
        });
        it("Promise Rejection", () => {
            let pool = new Pool.PromisePoolExecutor();
            let error = new Error();
            let caught = false;
            pool.addGenericTask({
                generator: () => {
                    return wait(1).then(() => {
                        throw error;
                    });
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return pool.waitForIdle().catch((err) => {
                chai_1.expect(err).to.equal(error);
                caught = true;
            }).then((results) => {
                chai_1.expect(caught).to.equal(true, "Must throw an error");
            });
        });
        it("Invalid Parameters", () => {
            let pool = new Pool.PromisePoolExecutor();
            let error = new Error();
            let caught = false;
            pool.addGenericTask({
                generator: () => {
                    return Promise.resolve();
                },
                concurrencyLimit: 0,
                noPromise: true,
            });
            return pool.waitForIdle().catch((err) => {
                caught = true;
            }).then((results) => {
                chai_1.expect(caught).to.equal(true, "Must throw an error");
            });
        });
    });
    describe("waitForGroupIdle", () => {
        it("Generator Function (synchronous)", () => {
            let pool = new Pool.PromisePoolExecutor();
            let error = new Error();
            let caught = false;
            let groupId = Symbol();
            pool.addGenericTask({
                groupIds: [groupId],
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return pool.waitForGroupIdle(groupId).catch((err) => {
                chai_1.expect(err).to.equal(error);
                caught = true;
            }).then((results) => {
                chai_1.expect(caught).to.equal(true, "Must throw an error");
            });
        });
        it("Promise Rejection", () => {
            let pool = new Pool.PromisePoolExecutor();
            let error = new Error();
            let caught = false;
            let groupId = Symbol();
            pool.addGenericTask({
                groupIds: [groupId],
                generator: () => {
                    return wait(1).then(() => {
                        throw error;
                    });
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return pool.waitForGroupIdle(groupId).catch((err) => {
                chai_1.expect(err).to.equal(error);
                caught = true;
            }).then((results) => {
                chai_1.expect(caught).to.equal(true, "Must throw an error");
            });
        });
        it("Invalid Parameters", () => {
            let pool = new Pool.PromisePoolExecutor();
            let error = new Error();
            let caught = false;
            let groupId = Symbol();
            pool.addGenericTask({
                groupIds: [groupId],
                generator: () => {
                    return Promise.resolve();
                },
                concurrencyLimit: 0,
                noPromise: true,
            });
            return pool.waitForGroupIdle(groupId).catch((err) => {
                caught = true;
            }).then((results) => {
                chai_1.expect(caught).to.equal(true, "Must throw an error");
            });
        });
    });
});
describe("Miscellaneous Features", () => {
    it("Stop Task", () => {
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
        let id = Symbol();
        return pool.addGenericTask({
            id: id,
            generator: (index) => {
                if (index >= 2) {
                    chai_1.expect(pool.stopTask(id)).to.equal(true, "Stop task must succede");
                }
                return wait(tick)
                    .then(() => {
                    return Date.now() - start;
                });
            }
        }).then((results) => {
            // The task must return the expected non-array result
            expectTimes(results, [1, 1, 1], "Timing Results");
        });
    });
    it("Get Task Status", () => {
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
        let id = Symbol();
        return pool.addGenericTask({
            id: id,
            generator: (index) => {
                return wait(tick)
                    .then(() => {
                    return pool.getTaskStatus(id);
                });
            },
            invocationLimit: 1,
            concurrencyLimit: 5,
        }).then((status) => {
            chai_1.expect(status[0]).to.deep.equal({
                id: id,
                activeCount: 1,
                concurrencyLimit: 5,
                invocations: 1,
                invocationLimit: 1,
                freeSlots: 0,
            });
        });
    });
    describe("waitForIdle", () => {
        it("Simple", () => {
            let pool = new Pool.PromisePoolExecutor();
            let start = Date.now();
            pool.addGenericTask({
                generator: () => {
                    return wait(tick);
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return pool.waitForIdle()
                .then(() => {
                expectTimes([Date.now() - start], [1], "Timing Results");
            });
        });
        it("Set concurrencyLimit", () => {
            let pool = new Pool.PromisePoolExecutor(1);
            chai_1.expect(pool.concurrencyLimit).to.equal(1);
            pool.concurrencyLimit = 2;
            chai_1.expect(pool.concurrencyLimit).to.equal(2);
        });
        it("Child Task", () => {
            let pool = new Pool.PromisePoolExecutor();
            let start = Date.now();
            pool.addGenericTask({
                generator: () => {
                    return wait(tick).then(() => {
                        pool.addGenericTask({
                            generator: () => {
                                return wait(tick);
                            },
                            invocationLimit: 1,
                            noPromise: true,
                        });
                    });
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return pool.waitForIdle()
                .then(() => {
                expectTimes([Date.now() - start], [2], "Timing Results");
            });
        });
        it("No Task", () => {
            let pool = new Pool.PromisePoolExecutor();
            return pool.waitForIdle();
        });
    });
    describe("waitForGroupIdle", () => {
        it("Simple", () => {
            let pool = new Pool.PromisePoolExecutor();
            let start = Date.now();
            let groupId = Symbol();
            pool.addGenericTask({
                groupIds: [groupId],
                generator: () => {
                    return wait(tick);
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return pool.waitForGroupIdle(groupId)
                .then(() => {
                expectTimes([Date.now() - start], [1], "Timing Results");
            });
        });
        it("Child Task", () => {
            let pool = new Pool.PromisePoolExecutor();
            let start = Date.now();
            let groupId = Symbol();
            pool.addGenericTask({
                groupIds: [groupId],
                generator: () => {
                    return wait(tick).then(() => {
                        pool.addGenericTask({
                            groupIds: [groupId],
                            generator: () => {
                                return wait(tick);
                            },
                            invocationLimit: 1,
                            noPromise: true,
                        });
                    });
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return pool.waitForGroupIdle(groupId)
                .then(() => {
                expectTimes([Date.now() - start], [2], "Timing Results");
            });
        });
        it("No Task", () => {
            let pool = new Pool.PromisePoolExecutor();
            return pool.waitForGroupIdle(Symbol());
        });
    });
});
describe("Task Secializations", () => {
    it("Single Task", () => {
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
        let iteration = 0;
        return pool.addSingleTask({
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
        });
    });
    it("Linear Task", () => {
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
        return pool.addLinearTask({
            generator: (element) => {
                return wait(tick)
                    .then(() => {
                    return Date.now() - start;
                });
            },
            invocationLimit: 3
        }).then((results) => {
            expectTimes(results, [1, 2, 3], "Timing Results");
        });
    });
    it("Each Task", () => {
        let pool = new Pool.PromisePoolExecutor();
        let start = Date.now();
        return pool.addEachTask({
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
        });
    });
    describe("Batch Task", () => {
        it("Static Batch Size", () => {
            let pool = new Pool.PromisePoolExecutor();
            let start = Date.now();
            return pool.addBatchTask({
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
            });
        });
        it("Dynamic Batch Size", () => {
            let pool = new Pool.PromisePoolExecutor();
            let start = Date.now();
            return pool.addBatchTask({
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
            });
        });
    });
});
//# sourceMappingURL=index.js.map