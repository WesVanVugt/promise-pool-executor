"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const chai = require("chai");
const chai_1 = require("chai");
const chaiAsPromised = require("chai-as-promised");
const Debug = require("debug");
const Pool = require("../index");
const batcher_1 = require("../public/batcher");
const debug = Debug("promise-pool-executor");
chai.use(chaiAsPromised);
/**
 * Milliseconds per tick.
 */
const tick = 100;
/**
 * Milliseconds tolerance for tests above the target.
 */
const tolerance = 60;
/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
function wait(time) {
    if (time <= 0) {
        return Promise.resolve();
    }
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
        chai_1.expect(val).to.be.within(targetTicks[i] * tick, targetTicks[i] * tick + tolerance, message + " (" + i + ")");
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
    process.prependOnceListener("unhandledRejection", (err) => {
        if (!reAdded) {
            debug("Caught unhandled");
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
    debug("unhandledRejectionListener: " + err.stack);
    // Fail the test
    throw new Error("UnhandledPromiseRejection: " + err.message);
}
beforeEach(() => {
    process.removeAllListeners("unhandledRejection");
    process.addListener("unhandledRejection", unhandledRejectionListener);
});
describe("Concurrency", () => {
    it("No Limit", () => {
        const pool = new Pool.PromisePoolExecutor();
        const start = Date.now();
        return pool.addGenericTask({
            generator: () => {
                return wait(tick)
                    .then(() => {
                    return Date.now() - start;
                });
            },
            invocationLimit: 3,
        }).promise().then((results) => {
            expectTimes(results, [1, 1, 1], "Timing Results");
        });
    });
    it("Global Limit", () => {
        const pool = new Pool.PromisePoolExecutor(2);
        const start = Date.now();
        return pool.addGenericTask({
            generator: () => {
                return wait(tick)
                    .then(() => {
                    return Date.now() - start;
                });
            },
            invocationLimit: 3,
        }).promise().then((results) => {
            expectTimes(results, [1, 1, 2], "Timing Results");
        });
    });
    it("Task Limit", () => {
        const pool = new Pool.PromisePoolExecutor();
        const start = Date.now();
        return pool.addGenericTask({
            concurrencyLimit: 2,
            generator: () => {
                return wait(tick)
                    .then(() => {
                    return Date.now() - start;
                });
            },
            invocationLimit: 3,
        }).promise().then((results) => {
            expectTimes(results, [1, 1, 2], "Timing Results");
        });
    });
    it("Group Limit", () => {
        const pool = new Pool.PromisePoolExecutor();
        const group = pool.addGroup({
            concurrencyLimit: 2,
        });
        const start = Date.now();
        return pool.addGenericTask({
            generator: () => {
                return wait(tick)
                    .then(() => {
                    return Date.now() - start;
                });
            },
            groups: [group],
            invocationLimit: 3,
        }).promise().then((results) => {
            expectTimes(results, [1, 1, 2], "Timing Results");
        });
    });
});
describe("Frequency", () => {
    describe("Global Limit", () => {
        it("Steady Work", () => {
            const pool = new Pool.PromisePoolExecutor({
                frequencyLimit: 2,
                frequencyWindow: tick,
            });
            const start = Date.now();
            return pool.addGenericTask({
                generator: () => {
                    return Promise.resolve(Date.now() - start);
                },
                invocationLimit: 3,
            }).promise().then((results) => {
                expectTimes(results, [0, 0, 1], "Timing Results");
            });
        });
        it("Offset Calls", () => {
            const pool = new Pool.PromisePoolExecutor({
                concurrencyLimit: 1,
                frequencyLimit: 2,
                frequencyWindow: tick * 3,
            });
            const start = Date.now();
            return pool.addGenericTask({
                generator: () => {
                    return wait(tick).then(() => Date.now() - start);
                },
                invocationLimit: 4,
            }).promise().then((results) => {
                expectTimes(results, [1, 2, 4, 5], "Timing Results");
            });
        });
        it("Work Gap", () => {
            const pool = new Pool.PromisePoolExecutor({
                frequencyLimit: 2,
                frequencyWindow: tick,
            });
            const start = Date.now();
            return pool.addGenericTask({
                generator: (i) => {
                    return Promise.resolve(Date.now() - start);
                },
                invocationLimit: 3,
            }).promise().then((results) => {
                debug(results);
                expectTimes(results, [0, 0, 1], "Timing Results 1");
                return wait(tick * 2);
            }).then(() => {
                return pool.addGenericTask({
                    generator: (i) => {
                        return Promise.resolve(Date.now() - start);
                    },
                    invocationLimit: 3,
                }).promise();
            }).then((results) => {
                debug(results);
                expectTimes(results, [3, 3, 4], "Timing Results 2");
            });
        });
    });
    it("Group Limit", () => {
        const pool = new Pool.PromisePoolExecutor();
        const group = pool.addGroup({
            frequencyLimit: 2,
            frequencyWindow: tick,
        });
        const start = Date.now();
        return pool.addGenericTask({
            generator: () => {
                return Promise.resolve(Date.now() - start);
            },
            groups: [group],
            invocationLimit: 3,
        }).promise().then((results) => {
            expectTimes(results, [0, 0, 1], "Timing Results");
            chai_1.expect(group._frequencyStarts).to.have.length.of.at.least(1);
        });
    });
    it("Should Not Collect Timestamps If Not Set", () => {
        const pool = new Pool.PromisePoolExecutor();
        return pool.addGenericTask({
            generator: () => Promise.resolve(),
            invocationLimit: 1,
        }).promise().then(() => {
            chai_1.expect(pool._globalGroup._frequencyStarts).to.have.lengthOf(0);
        });
    });
});
describe("Exception Handling", () => {
    it("Generator Function (synchronous)", () => {
        const pool = new Pool.PromisePoolExecutor();
        const error = new Error();
        let caught = false;
        return pool.addGenericTask({
            generator: () => {
                throw error;
            },
        }).promise().catch((err) => {
            chai_1.expect(err).to.equal(error);
            caught = true;
        }).then((results) => {
            chai_1.expect(caught).to.equal(true, "Must throw an error");
        });
    });
    it("Promise Rejection", () => {
        const pool = new Pool.PromisePoolExecutor();
        const error = new Error();
        let caught = false;
        return pool.addGenericTask({
            generator: () => {
                return wait(1).then(() => {
                    throw error;
                });
            },
            invocationLimit: 1,
        }).promise().catch((err) => {
            chai_1.expect(err).to.equal(error);
            caught = true;
        }).then((results) => {
            chai_1.expect(caught).to.equal(true, "Must throw an error");
        });
    });
    describe("Invalid Configuration", () => {
        it("Invalid Parameters", () => {
            const pool = new Pool.PromisePoolExecutor();
            chai_1.expect(() => pool.addGenericTask({
                concurrencyLimit: 0,
                generator: () => {
                    return Promise.resolve();
                },
            })).to.throw();
        });
        it("Group From Another Pool", () => {
            const pool1 = new Pool.PromisePoolExecutor();
            const pool2 = new Pool.PromisePoolExecutor();
            chai_1.expect(() => pool1.addGenericTask({
                generator: () => {
                    return Promise.resolve();
                },
                groups: [pool2.addGroup({
                        concurrencyLimit: 1,
                    })],
            })).to.throw();
        });
    });
    describe("Unhandled Rejection", () => {
        it("Generator Function (synchronous)", () => {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
            });
            return expectUnhandledRejection(error);
        });
        it("Promise Rejection", () => {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            pool.addGenericTask({
                generator: () => {
                    return wait(1).then(() => {
                        throw error;
                    });
                },
                invocationLimit: 1,
            });
            return expectUnhandledRejection(error);
        });
        it("Multi-rejection", () => {
            const pool = new Pool.PromisePoolExecutor();
            const errors = [new Error("First"), new Error("Second")];
            let caught;
            pool.addGenericTask({
                generator: (i) => {
                    return wait(i ? tick : 1).then(() => {
                        throw errors[i];
                    });
                },
                invocationLimit: 2,
            }).promise().catch((err) => {
                caught = err;
            });
            return expectUnhandledRejection(errors[1], tick * 2).then(() => {
                chai_1.expect(caught).to.equal(errors[0]);
            });
        });
    });
    describe("pool.waitForIdle", () => {
        it("Generator Function (synchronous)", () => {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            let caught = false;
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
            });
            return pool.waitForIdle().catch((err) => {
                chai_1.expect(err).to.equal(error);
                caught = true;
            }).then(() => {
                chai_1.expect(caught).to.equal(true, "Must throw an error");
            });
        });
        it("Promise Rejection", () => {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            let caught = false;
            pool.addGenericTask({
                generator: () => {
                    return wait(1).then(() => {
                        throw error;
                    });
                },
                invocationLimit: 1,
            });
            return pool.waitForIdle().catch((err) => {
                chai_1.expect(err).to.equal(error);
                caught = true;
            }).then(() => {
                chai_1.expect(caught).to.equal(true, "Must throw an error");
            });
        });
        describe("Clearing After Delay", () => {
            it("Promise Rejection", () => {
                const pool = new Pool.PromisePoolExecutor();
                const error = new Error();
                let caught = false;
                pool.addGenericTask({
                    generator: () => {
                        return wait(1).then(() => {
                            throw error;
                        });
                    },
                    invocationLimit: 1,
                }).promise().catch((err) => {
                    chai_1.expect(err).to.equal(error);
                    caught = true;
                });
                return wait(tick).then(() => {
                    return pool.waitForIdle();
                }).catch(() => {
                    throw new Error("Error did not clear");
                }).then(() => {
                    chai_1.expect(caught).to.equal(true, "Must throw an error");
                });
            });
        });
    });
    describe("group.waitForIdle", () => {
        it("Generator Function (synchronous)", () => {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            let caught = false;
            const group = pool.addGroup({});
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                groups: [group],
                invocationLimit: 1,
            });
            return group.waitForIdle().catch((err) => {
                chai_1.expect(err).to.equal(error);
                caught = true;
            }).then((results) => {
                chai_1.expect(caught).to.equal(true, "Must throw an error");
            });
        });
        it("Promise Rejection", () => {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            let caught = false;
            const group = pool.addGroup({});
            pool.addGenericTask({
                generator: () => {
                    return wait(1).then(() => {
                        throw error;
                    });
                },
                groups: [group],
                invocationLimit: 1,
            });
            return group.waitForIdle().catch((err) => {
                chai_1.expect(err).to.equal(error);
                caught = true;
            }).then((results) => {
                chai_1.expect(caught).to.equal(true, "Must throw an error");
            });
        });
    });
});
describe("Miscellaneous Features", () => {
    describe("End Task", () => {
        it("From Generator With No Promise", () => {
            const pool = new Pool.PromisePoolExecutor();
            return pool.addGenericTask({
                generator() {
                    this.end();
                },
            }).promise().then((results) => {
                chai_1.expect(results).to.have.lengthOf(0);
            });
        });
        it("From Generator With Promise", () => {
            const pool = new Pool.PromisePoolExecutor();
            return pool.addGenericTask({
                generator() {
                    this.end();
                    // Add one final promise after ending the task
                    return Promise.resolve(1);
                },
            }).promise().then((results) => {
                chai_1.expect(results).to.deep.equal([1]);
            });
        });
    });
    it("Generator Recursion Prevention", () => {
        const pool = new Pool.PromisePoolExecutor();
        let runCount = 0;
        return pool.addGenericTask({
            generator() {
                runCount++;
                // Add a task, triggering it to run
                pool.addGenericTask({
                    generator: () => {
                        // do nothing
                    },
                });
            },
        }).promise().then(() => {
            chai_1.expect(runCount).to.equal(1, "runCount");
        });
    });
    it("Pause/Resume Task", () => {
        const pool = new Pool.PromisePoolExecutor();
        const start = Date.now();
        let paused = false;
        const task = pool.addGenericTask({
            generator(index) {
                if (index === 1 && !paused) {
                    paused = true;
                    this.pause();
                    return;
                }
                return wait(tick)
                    .then(() => {
                    return Date.now() - start;
                });
            },
            invocationLimit: 3,
        });
        wait(tick).then(() => {
            task.resume();
        });
        return task.promise().then((results) => {
            // The task must return the expected non-array result
            expectTimes(results, [1, 2, 2], "Timing Results");
        });
    });
    it("Get Task Status", () => {
        const pool = new Pool.PromisePoolExecutor();
        const start = Date.now();
        return pool.addGenericTask({
            concurrencyLimit: 5,
            frequencyLimit: 5,
            frequencyWindow: 1000,
            generator(index) {
                return wait(tick)
                    .then(() => {
                    return {
                        activePromiseCount: this.activePromiseCount,
                        concurrencyLimit: this.concurrencyLimit,
                        freeSlots: this.freeSlots,
                        frequencyLimit: this.frequencyLimit,
                        frequencyWindow: this.frequencyWindow,
                        invocationLimit: this.invocationLimit,
                        invocations: this.invocations,
                        state: this.state,
                    };
                });
            },
            invocationLimit: 1,
        }).promise().then((status) => {
            chai_1.expect(status[0]).to.deep.equal({
                activePromiseCount: 1,
                concurrencyLimit: 5,
                freeSlots: 0,
                frequencyLimit: 5,
                frequencyWindow: 1000,
                invocationLimit: 1,
                invocations: 1,
                state: Pool.TaskState.Exhausted,
            });
        });
    });
    describe("waitForIdle", () => {
        it("Simple", () => {
            const pool = new Pool.PromisePoolExecutor();
            const start = Date.now();
            pool.addGenericTask({
                generator: () => {
                    return wait(tick);
                },
                invocationLimit: 1,
            });
            return pool.waitForIdle()
                .then(() => {
                expectTimes([Date.now() - start], [1], "Timing Results");
            });
        });
        it("Set concurrencyLimit", () => {
            const pool = new Pool.PromisePoolExecutor(1);
            chai_1.expect(pool.concurrencyLimit).to.equal(1);
            pool.concurrencyLimit = 2;
            chai_1.expect(pool.concurrencyLimit).to.equal(2);
        });
        it("Child Task", () => {
            const pool = new Pool.PromisePoolExecutor();
            const start = Date.now();
            pool.addGenericTask({
                generator: () => {
                    return wait(tick).then(() => {
                        pool.addGenericTask({
                            generator: () => {
                                return wait(tick);
                            },
                            invocationLimit: 1,
                        });
                    });
                },
                invocationLimit: 1,
            });
            return pool.waitForIdle()
                .then(() => {
                expectTimes([Date.now() - start], [2], "Timing Results");
            });
        });
        it("No Task", () => {
            const pool = new Pool.PromisePoolExecutor();
            return pool.waitForIdle();
        });
    });
    describe("waitForGroupIdle", () => {
        it("Simple", () => {
            const pool = new Pool.PromisePoolExecutor();
            const start = Date.now();
            const group = pool.addGroup({});
            pool.addGenericTask({
                generator: () => {
                    return wait(tick);
                },
                groups: [group],
                invocationLimit: 1,
            });
            return group.waitForIdle()
                .then(() => {
                expectTimes([Date.now() - start], [1], "Timing Results");
            });
        });
        it("Child Task", () => {
            const pool = new Pool.PromisePoolExecutor();
            const start = Date.now();
            const group = pool.addGroup({});
            pool.addGenericTask({
                generator: () => {
                    return wait(tick).then(() => {
                        pool.addGenericTask({
                            generator: () => {
                                return wait(tick);
                            },
                            groups: [group],
                            invocationLimit: 1,
                        });
                    });
                },
                groups: [group],
                invocationLimit: 1,
            });
            return group.waitForIdle()
                .then(() => {
                expectTimes([Date.now() - start], [2], "Timing Results");
            });
        });
    });
    describe("Configure Task", () => {
        it("Invocation Limit Triggers Completion", () => {
            const pool = new Pool.PromisePoolExecutor();
            const start = Date.now();
            const task = pool.addGenericTask({
                frequencyLimit: 1,
                frequencyWindow: tick * 2,
                generator: () => {
                    return Promise.resolve(Date.now() - start);
                },
                invocationLimit: 2,
            });
            wait(tick).then(() => {
                task.invocationLimit = 1;
            });
            return task.promise().then((results) => {
                expectTimes([...results, Date.now() - start], [0, 1], "Timing Results");
            });
        });
    });
    describe("Configure Group", () => {
        it("Triggers Promises", () => {
            const pool = new Pool.PromisePoolExecutor();
            const start = Date.now();
            const group = pool.addGroup({
                frequencyLimit: 1,
                frequencyWindow: tick * 2,
            });
            wait(tick).then(() => {
                group.frequencyWindow = 1;
                group.frequencyLimit = 1;
            });
            return pool.addGenericTask({
                generator: () => {
                    return Promise.resolve(Date.now() - start);
                },
                groups: [group],
                invocationLimit: 2,
            }).promise().then((results) => {
                expectTimes(results, [0, 1], "Timing Results");
            });
        });
    });
});
describe("Task Secializations", () => {
    it("Single Task", () => {
        const pool = new Pool.PromisePoolExecutor();
        const start = Date.now();
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
            },
        }).promise().then((result) => {
            debug(`Test result: ${result} (${typeof result})`);
            // The task must return the expected non-array result
            expectTimes([result], [1], "Timing Results");
        });
    });
    it("Linear Task", () => {
        const pool = new Pool.PromisePoolExecutor();
        const start = Date.now();
        return pool.addLinearTask({
            generator: (element) => {
                return wait(tick)
                    .then(() => {
                    return Date.now() - start;
                });
            },
            invocationLimit: 3,
        }).promise().then((results) => {
            expectTimes(results, [1, 2, 3], "Timing Results");
        });
    });
    it("Each Task", () => {
        const pool = new Pool.PromisePoolExecutor();
        const start = Date.now();
        return pool.addEachTask({
            concurrencyLimit: Infinity,
            data: [3, 2, 1],
            generator: (element) => {
                return wait(tick * element)
                    .then(() => {
                    return Date.now() - start;
                });
            },
        }).promise().then((results) => {
            expectTimes(results, [3, 2, 1], "Timing Results");
        });
    });
    describe("Batch Task", () => {
        it("Static Batch Size", () => {
            const pool = new Pool.PromisePoolExecutor();
            const start = Date.now();
            return pool.addBatchTask({
                // Groups the data as [[3, 1], [2]]
                batchSize: 2,
                data: [3, 1, 2],
                generator: (data) => {
                    return wait(tick * sum(data))
                        .then(() => {
                        return Date.now() - start;
                    });
                },
            }).promise().then((results) => {
                expectTimes(results, [4, 2], "Timing Results");
            });
        });
        it("Dynamic Batch Size", () => {
            const pool = new Pool.PromisePoolExecutor();
            const start = Date.now();
            return pool.addBatchTask({
                batchSize: (elements, freeSlots) => {
                    // Groups the data as [[2], [1, 3]]
                    return Math.floor(elements / freeSlots);
                },
                concurrencyLimit: 2,
                data: [2, 1, 3],
                generator: (data) => {
                    return wait(tick * sum(data))
                        .then(() => {
                        return Date.now() - start;
                    });
                },
            }).promise().then((results) => {
                expectTimes(results, [2, 4], "Timing Results");
            });
        });
    });
    describe("Persistent Batch Task", () => {
        it("Core Functionality", () => {
            const pool = new Pool.PromisePoolExecutor();
            let runCount = 0;
            const task = pool.addPersistentBatchTask({
                generator: (input) => {
                    runCount++;
                    return wait(tick).then(() => input.map(String));
                },
            });
            const inputs = [1, 5, 9];
            const start = Date.now();
            return Promise.all(inputs.map((input) => {
                return task.getResult(input).then((output) => {
                    chai_1.expect(output).to.equal(String(input), "Outputs");
                    expectTimes([Date.now() - start], [1], "Timing Results");
                });
            })).then((outputs) => {
                chai_1.expect(runCount).to.equal(1, "runCount");
                // Verify that the task is not storing the results, which would waste memory.
                chai_1.expect(task._task._result.length).to.equal(0);
            });
        });
        it("Offset Batches", () => {
            // Runs two batches of requests, offset so the seconds starts while the first is half finished.
            // The second batch should start before the first finishes.
            const pool = new Pool.PromisePoolExecutor();
            const start = Date.now();
            let runCount = 0;
            const task = pool.addPersistentBatchTask({
                generator: (input) => {
                    runCount++;
                    return wait(tick * 2).then(() => input.map(String));
                },
            });
            const inputs = [[1, 9], [5, 7]];
            return Promise.all(inputs.map((input, index) => {
                return wait(index * tick).then(() => Promise.all(input.map((value, index2) => {
                    return task.getResult(value).then((result) => {
                        chai_1.expect(result).to.equal(String(value));
                        expectTimes([Date.now() - start], [index + 2], `Timing result (${index},${index2})`);
                    });
                })));
            })).then(() => {
                chai_1.expect(runCount).to.equal(2, "runCount");
            });
        });
        describe("maxBatchSize", () => {
            it("Core Functionality", () => {
                const pool = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const task = pool.addPersistentBatchTask({
                    generator: (input) => {
                        runCount++;
                        return wait(tick).then(() => input.map(String));
                    },
                    maxBatchSize: 2,
                });
                const inputs = [1, 5, 9];
                const start = Date.now();
                return Promise.all(inputs.map((input) => {
                    return task.getResult(input).then((output) => {
                        chai_1.expect(output).to.equal(String(input), "Outputs");
                        expectTimes([Date.now() - start], [1], "Timing Results");
                    });
                })).then((outputs) => {
                    chai_1.expect(runCount).to.equal(2, "runCount");
                });
            });
            it("Instant Start", () => {
                const pool = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const task = pool.addPersistentBatchTask({
                    generator: (input) => {
                        runCount++;
                        return wait(tick).then(() => input);
                    },
                    maxBatchSize: 2,
                });
                const runCounts = [0, 1, 1];
                return Promise.all(runCounts.map((expectedRunCount) => {
                    // The generator should be triggered instantly when the max batch size is reached
                    const promise = task.getResult(undefined);
                    chai_1.expect(runCount).to.equal(expectedRunCount);
                    return promise;
                }));
            });
        });
        it("queuingDelay", () => {
            const pool = new Pool.PromisePoolExecutor();
            let runCount = 0;
            const task = pool.addPersistentBatchTask({
                generator: (input) => {
                    runCount++;
                    return Promise.resolve(new Array(input.length));
                },
                queuingDelay: tick * 2,
            });
            const delays = [0, 1, 3];
            const start = Date.now();
            return Promise.all(delays.map((delay) => {
                return wait(delay * tick)
                    .then(() => task.getResult(undefined))
                    .then(() => Date.now() - start);
            })).then((results) => {
                expectTimes(results, [2, 2, 5], "Timing Results");
                chai_1.expect(runCount).to.equal(2, "runCount");
            });
        });
        it("Delay After Hitting Concurrency Limit", () => {
            const pool = new Pool.PromisePoolExecutor();
            let runCount = 0;
            const task = pool.addPersistentBatchTask({
                concurrencyLimit: 1,
                generator: (input) => {
                    runCount++;
                    return wait(3 * tick).then(() => new Array(input.length));
                },
                queuingDelay: tick,
                queuingThresholds: [1, Infinity],
            });
            const start = Date.now();
            return Promise.all([
                task.getResult(undefined).then(() => {
                    return task.getResult(undefined);
                }),
                wait(2 * tick).then(() => task.getResult(undefined)),
            ].map((promise) => promise.then(() => Date.now() - start))).then((results) => {
                expectTimes(results, [8, 8], "Timing Results");
                chai_1.expect(runCount).to.equal(2, "runCount");
            });
        });
        describe("queueingThresholds", () => {
            it("Core Functionality", () => {
                const pool = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const task = pool.addPersistentBatchTask({
                    generator: (input) => {
                        runCount++;
                        return wait(5 * tick).then(() => new Array(input.length));
                    },
                    queuingThresholds: [1, 2],
                });
                const delays = [0, 1, 2, 3, 4];
                const start = Date.now();
                return Promise.all(delays.map((delay) => {
                    return wait(delay * tick)
                        .then(() => task.getResult(undefined))
                        .then(() => Date.now() - start);
                })).then((results) => {
                    expectTimes(results, [5, 7, 7, 9, 9], "Timing Results");
                    chai_1.expect(runCount).to.equal(3, "runCount");
                });
            });
            it("Should Trigger On Task Completion", () => {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: (input) => {
                        return wait(2 * tick).then(() => new Array(input.length));
                    },
                    queuingThresholds: [1, 2],
                });
                const delays = [0, 1];
                const start = Date.now();
                return Promise.all(delays.map((delay) => {
                    return wait(delay * tick)
                        .then(() => task.getResult(undefined))
                        .then(() => Date.now() - start);
                })).then((results) => {
                    expectTimes(results, [2, 4], "Timing Results");
                });
            });
        });
        describe("Error Handling", () => {
            it("Single Rejection", () => {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: (input) => {
                        return wait(tick).then(() => input.map((value) => {
                            return value === "error" ? new Error("test") : undefined;
                        }));
                    },
                });
                const inputs = ["a", "error", "b"];
                return Promise.all(inputs.map((input) => {
                    return task.getResult(input).then(() => true).catch((err) => {
                        chai_1.expect(err.message).to.equal("test");
                        return false;
                    });
                })).then((results) => {
                    chai_1.expect(results).to.deep.equal([true, false, true]);
                });
            });
            it("Synchronous Generator Exception Followed By Success", () => {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: (input) => {
                        input.forEach((value) => {
                            if (value === 0) {
                                throw new Error("test");
                            }
                        });
                        return wait(1).then(() => new Array(input.length));
                    },
                    maxBatchSize: 2,
                });
                const inputs = [0, 1, 2];
                return Promise.all(inputs.map((input) => {
                    return task.getResult(input).then(() => true).catch((err) => {
                        chai_1.expect(err.message).to.equal("test");
                        return false;
                    });
                })).then((results) => {
                    chai_1.expect(results).to.deep.equal([false, false, true]);
                });
            });
            it("Asynchronous Generator Exception Followed By Success", () => {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: (input) => {
                        return wait(1).then(() => {
                            input.forEach((value) => {
                                if (value === 0) {
                                    throw new Error("test");
                                }
                            });
                            return new Array(input.length);
                        });
                    },
                    maxBatchSize: 2,
                });
                const inputs = [0, 1, 2];
                return Promise.all(inputs.map((input) => {
                    return task.getResult(input).then(() => true).catch((err) => {
                        chai_1.expect(err.message).to.equal("test");
                        return false;
                    });
                })).then((results) => {
                    chai_1.expect(results).to.deep.equal([false, false, true]);
                });
            });
            it("Invalid Output Length", () => {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: (input) => {
                        // Respond with an array larger than the input
                        return wait(1).then(() => new Array(input.length + 1));
                    },
                });
                const inputs = [0, 1, 2];
                return Promise.all(inputs.map((input) => {
                    return task.getResult(input).then(() => true).catch(() => false);
                })).then((results) => {
                    chai_1.expect(results).to.deep.equal([false, false, false]);
                });
            });
            it("End Task", () => {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: (input) => {
                        return wait(tick).then(() => []);
                    },
                });
                const firstPromise = task.getResult(undefined);
                task.end();
                chai_1.expect(task.state === Pool.TaskState.Terminated, "State should be terminated");
                return Promise.all([firstPromise, task.getResult(undefined)].map((promise) => {
                    promise.catch((err) => err).then((result) => {
                        chai_1.expect(result).to.be.an.instanceof(Error);
                    });
                }));
            });
        });
    });
    describe("Batcher", () => {
        it("Core Functionality", () => {
            let runCount = 0;
            const batcher = new batcher_1.Batcher({
                generator: (input) => {
                    runCount++;
                    return wait(tick).then(() => input.map(String));
                },
            });
            const inputs = [1, 5, 9];
            const start = Date.now();
            return Promise.all(inputs.map((input) => {
                return batcher.getResult(input).then((output) => {
                    chai_1.expect(output).to.equal(String(input), "Outputs");
                    expectTimes([Date.now() - start], [1], "Timing Results");
                });
            })).then((outputs) => {
                chai_1.expect(runCount).to.equal(1, "runCount");
            });
        });
        it("Offset Batches", () => {
            // Runs two batches of requests, offset so the seconds starts while the first is half finished.
            // The second batch should start before the first finishes.
            const start = Date.now();
            let runCount = 0;
            const batcher = new batcher_1.Batcher({
                generator: (input) => {
                    runCount++;
                    return wait(tick * 2).then(() => input.map(String));
                },
            });
            const inputs = [[1, 9], [5, 7]];
            return Promise.all(inputs.map((input, index) => {
                return wait(index * tick).then(() => Promise.all(input.map((value, index2) => {
                    return batcher.getResult(value).then((result) => {
                        chai_1.expect(result).to.equal(String(value));
                        expectTimes([Date.now() - start], [index + 2], `Timing result (${index},${index2})`);
                    });
                })));
            })).then(() => {
                chai_1.expect(runCount).to.equal(2, "runCount");
            });
        });
        describe("maxBatchSize", () => {
            it("Core Functionality", () => {
                let runCount = 0;
                const batcher = new batcher_1.Batcher({
                    generator: (input) => {
                        runCount++;
                        return wait(tick).then(() => input.map(String));
                    },
                    maxBatchSize: 2,
                });
                const inputs = [1, 5, 9];
                const start = Date.now();
                return Promise.all(inputs.map((input) => {
                    return batcher.getResult(input).then((output) => {
                        chai_1.expect(output).to.equal(String(input), "Outputs");
                        expectTimes([Date.now() - start], [1], "Timing Results");
                    });
                })).then((outputs) => {
                    chai_1.expect(runCount).to.equal(2, "runCount");
                });
            });
            it("Instant Start", () => {
                let runCount = 0;
                const batcher = new batcher_1.Batcher({
                    generator: (input) => {
                        runCount++;
                        return wait(tick).then(() => input);
                    },
                    maxBatchSize: 2,
                });
                const runCounts = [0, 1, 1];
                return Promise.all(runCounts.map((expectedRunCount) => {
                    // The generator should be triggered instantly when the max batch size is reached
                    const promise = batcher.getResult(undefined);
                    chai_1.expect(runCount).to.equal(expectedRunCount);
                    return promise;
                }));
            });
        });
        it("queuingDelay", () => {
            let runCount = 0;
            const batcher = new batcher_1.Batcher({
                generator: (input) => {
                    runCount++;
                    return Promise.resolve(new Array(input.length));
                },
                queuingDelay: tick * 2,
            });
            const delays = [0, 1, 3];
            const start = Date.now();
            return Promise.all(delays.map((delay) => {
                return wait(delay * tick)
                    .then(() => batcher.getResult(undefined))
                    .then(() => Date.now() - start);
            })).then((results) => {
                expectTimes(results, [2, 2, 5], "Timing Results");
                chai_1.expect(runCount).to.equal(2, "runCount");
            });
        });
        it("Delay After Hitting Queuing Threshold", () => {
            let runCount = 0;
            const batcher = new batcher_1.Batcher({
                generator: (input) => {
                    runCount++;
                    return wait(3 * tick).then(() => new Array(input.length));
                },
                queuingDelay: tick,
                queuingThresholds: [1, Infinity],
            });
            const start = Date.now();
            return Promise.all([
                batcher.getResult(undefined).then(() => {
                    return batcher.getResult(undefined);
                }),
                wait(2 * tick).then(() => batcher.getResult(undefined)),
            ].map((promise) => promise.then(() => Date.now() - start))).then((results) => {
                expectTimes(results, [8, 8], "Timing Results");
                chai_1.expect(runCount).to.equal(2, "runCount");
            });
        });
        describe("queueingThresholds", () => {
            it("Core Functionality", () => {
                let runCount = 0;
                const batcher = new batcher_1.Batcher({
                    generator: (input) => {
                        runCount++;
                        return wait(5 * tick).then(() => new Array(input.length));
                    },
                    queuingThresholds: [1, 2],
                });
                const delays = [0, 1, 2, 3, 4];
                const start = Date.now();
                return Promise.all(delays.map((delay) => {
                    return wait(delay * tick)
                        .then(() => batcher.getResult(undefined))
                        .then(() => Date.now() - start);
                })).then((results) => {
                    expectTimes(results, [5, 7, 7, 9, 9], "Timing Results");
                    chai_1.expect(runCount).to.equal(3, "runCount");
                });
            });
            it("Should Trigger On Task Completion", () => {
                const batcher = new batcher_1.Batcher({
                    generator: (input) => {
                        return wait(2 * tick).then(() => new Array(input.length));
                    },
                    queuingThresholds: [1, 2],
                });
                const delays = [0, 1];
                const start = Date.now();
                return Promise.all(delays.map((delay) => {
                    return wait(delay * tick)
                        .then(() => batcher.getResult(undefined))
                        .then(() => Date.now() - start);
                })).then((results) => {
                    expectTimes(results, [2, 4], "Timing Results");
                });
            });
        });
        describe("Error Handling", () => {
            it("Single Rejection", () => {
                const batcher = new batcher_1.Batcher({
                    generator: (input) => {
                        return wait(tick).then(() => input.map((value) => {
                            return value === "error" ? new Error("test") : undefined;
                        }));
                    },
                });
                const inputs = ["a", "error", "b"];
                return Promise.all(inputs.map((input) => {
                    return batcher.getResult(input).then(() => true).catch((err) => {
                        chai_1.expect(err.message).to.equal("test");
                        return false;
                    });
                })).then((results) => {
                    chai_1.expect(results).to.deep.equal([true, false, true]);
                });
            });
            it("Synchronous Generator Exception Followed By Success", () => {
                const batcher = new batcher_1.Batcher({
                    generator: (input) => {
                        input.forEach((value) => {
                            if (value === 0) {
                                throw new Error("test");
                            }
                        });
                        return wait(1).then(() => new Array(input.length));
                    },
                    maxBatchSize: 2,
                });
                const inputs = [0, 1, 2];
                return Promise.all(inputs.map((input) => {
                    return batcher.getResult(input).then(() => true).catch((err) => {
                        chai_1.expect(err.message).to.equal("test");
                        return false;
                    });
                })).then((results) => {
                    chai_1.expect(results).to.deep.equal([false, false, true]);
                });
            });
            it("Asynchronous Generator Exception Followed By Success", () => {
                const batcher = new batcher_1.Batcher({
                    generator: (input) => {
                        return wait(1).then(() => {
                            input.forEach((value) => {
                                if (value === 0) {
                                    throw new Error("test");
                                }
                            });
                            return new Array(input.length);
                        });
                    },
                    maxBatchSize: 2,
                });
                return Promise.all([0, 1].map((input) => {
                    const promise = batcher.getResult(input);
                    if (input !== 2) {
                        return chai_1.expect(promise).to.be.rejectedWith(Error, "test");
                    }
                    return promise;
                }));
            });
            it("Synchronous Delay Exception Followed By Success", () => __awaiter(this, void 0, void 0, function* () {
                let runCount = 0;
                const batcher = new batcher_1.Batcher({
                    delayFunction: () => {
                        runCount++;
                        if (runCount < 2) {
                            throw new Error("test");
                        }
                    },
                    generator: (input) => {
                        return wait(1).then(() => input);
                    },
                    maxBatchSize: 2,
                });
                return Promise.all([0, 1].map((input, index) => {
                    return chai_1.expect(batcher.getResult(undefined)).to.be.rejectedWith(Error, "test");
                })).then(() => batcher.getResult(undefined));
            }));
            it("Asynchronous Delay Exception Followed By Success", () => {
                let runCount = 0;
                const batcher = new batcher_1.Batcher({
                    delayFunction: () => {
                        return wait(1).then(() => {
                            runCount++;
                            if (runCount < 2) {
                                throw new Error("test");
                            }
                        });
                    },
                    generator: (input) => {
                        return wait(1).then(() => input);
                    },
                    maxBatchSize: 2,
                });
                return Promise.all([0, 1].map((input, index) => {
                    return chai_1.expect(batcher.getResult(undefined)).to.be.rejectedWith(Error, "test");
                })).then(() => batcher.getResult(undefined));
            });
            it("Invalid Output Length", () => {
                const batcher = new batcher_1.Batcher({
                    generator: (input) => {
                        // Respond with an array larger than the input
                        return wait(1).then(() => new Array(input.length + 1));
                    },
                });
                const inputs = [0, 1, 2];
                return Promise.all(inputs.map((input) => {
                    return batcher.getResult(input).then(() => true).catch(() => false);
                })).then((results) => {
                    chai_1.expect(results).to.deep.equal([false, false, false]);
                });
            });
        });
    });
});
