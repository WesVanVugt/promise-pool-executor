"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chai = __importStar(require("chai"));
const chai_1 = require("chai");
const chai_as_promised_1 = __importDefault(require("chai-as-promised"));
const debug_1 = __importDefault(require("debug"));
const time_span_1 = __importDefault(require("time-span"));
const Pool = __importStar(require("../index"));
const debug = debug_1.default("promise-pool-executor:test");
chai.use(chai_as_promised_1.default);
// Verify that the types needed can be imported
const typingImportTest = undefined;
if (typingImportTest) {
    // satisfy TypeScript's need to use the variable
}
/**
 * Milliseconds per tick.
 */
const tick = 80;
/**
 * Milliseconds tolerance for tests above the target.
 */
const tolerance = 70;
/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
function wait(time) {
    if (time <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
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
        chai_1.expect(val).to.be.within(targetTicks[i] * tick - 1, targetTicks[i] * tick + tolerance, message + " (" + i + ")");
    });
}
function waitForUnhandledRejection(delay = tick * 2) {
    process.removeListener("unhandledRejection", unhandledRejectionListener);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            resetUnhandledRejectionListener();
            resolve();
        }, delay);
        process.prependOnceListener("unhandledRejection", (err) => {
            clearTimeout(timeout);
            debug("Caught unhandledRejection");
            resetUnhandledRejectionListener();
            reject(err);
        });
    });
}
function expectHandledRejection(delay = tick * 2) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            resetHandledRejectionListener();
            reject(new Error("Rejection Not Handled"));
        }, delay);
        process.removeAllListeners("rejectionHandled");
        process.prependOnceListener("rejectionHandled", () => {
            clearTimeout(timeout);
            debug("rejectionHandled");
            resetHandledRejectionListener();
            resolve();
        });
    });
}
/**
 * Expects an unhandled promise rejection.
 * @param expectedError The error expected to be received with the rejection (optional).
 */
function expectUnhandledRejection(expectedError, delay = tick * 2) {
    return __awaiter(this, void 0, void 0, function* () {
        yield chai_1.expect(waitForUnhandledRejection(delay)).to.be.rejectedWith(expectedError);
    });
}
/**
 * Returns the sum of an array of numbers.
 */
function sum(nums) {
    return nums.reduce((a, b) => a + b, 0);
}
function unhandledRejectionListener(err) {
    debug("unhandledRejectionListener: %O", err);
    // Fail the test
    throw err;
}
function rejectionHandledListener() {
    debug("Unexpected rejectionHandled event");
    // Fail the test
    throw new Error("Unexpected rejectionHandled event");
}
function resetUnhandledRejectionListener() {
    process.removeAllListeners("unhandledRejection");
    process.addListener("unhandledRejection", unhandledRejectionListener);
}
function resetHandledRejectionListener() {
    process.removeAllListeners("rejectionHandled");
    process.addListener("rejectionHandled", rejectionHandledListener);
}
beforeEach(() => {
    resetUnhandledRejectionListener();
    resetHandledRejectionListener();
});
describe("Concurrency", () => {
    it("No Limit", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        const end = time_span_1.default();
        const results = yield pool
            .addGenericTask({
            generator: () => __awaiter(this, void 0, void 0, function* () {
                yield wait(tick);
                return end();
            }),
            invocationLimit: 3,
        })
            .promise();
        expectTimes(results, [1, 1, 1], "Timing Results");
    }));
    it("Global Limit", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor(2);
        const end = time_span_1.default();
        const results = yield pool
            .addGenericTask({
            generator: () => __awaiter(this, void 0, void 0, function* () {
                yield wait(tick);
                return end();
            }),
            invocationLimit: 3,
        })
            .promise();
        expectTimes(results, [1, 1, 2], "Timing Results");
    }));
    it("Task Limit", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        const end = time_span_1.default();
        const results = yield pool
            .addGenericTask({
            concurrencyLimit: 2,
            generator: () => __awaiter(this, void 0, void 0, function* () {
                yield wait(tick);
                return end();
            }),
            invocationLimit: 3,
        })
            .promise();
        expectTimes(results, [1, 1, 2], "Timing Results");
    }));
    it("Group Limit", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        const group = pool.addGroup({
            concurrencyLimit: 2,
        });
        const end = time_span_1.default();
        const results = yield pool
            .addGenericTask({
            generator: () => __awaiter(this, void 0, void 0, function* () {
                yield wait(tick);
                return end();
            }),
            groups: [group],
            invocationLimit: 3,
        })
            .promise();
        expectTimes(results, [1, 1, 2], "Timing Results");
    }));
});
describe("Frequency", () => {
    describe("Global Limit", () => {
        it("Steady Work", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor({
                frequencyLimit: 2,
                frequencyWindow: tick,
            });
            const end = time_span_1.default();
            const results = yield pool
                .addGenericTask({
                generator: () => {
                    return Promise.resolve(end());
                },
                invocationLimit: 3,
            })
                .promise();
            expectTimes(results, [0, 0, 1], "Timing Results");
        }));
        it("Offset Calls", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor({
                concurrencyLimit: 1,
                frequencyLimit: 2,
                frequencyWindow: tick * 3,
            });
            const end = time_span_1.default();
            const results = yield pool
                .addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(tick);
                    return end();
                }),
                invocationLimit: 4,
            })
                .promise();
            expectTimes(results, [1, 2, 4, 5], "Timing Results");
        }));
        it("Work Gap", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor({
                frequencyLimit: 2,
                frequencyWindow: tick,
            });
            const end = time_span_1.default();
            const results = yield pool
                .addGenericTask({
                generator: () => {
                    return Promise.resolve(end());
                },
                invocationLimit: 3,
            })
                .promise();
            debug(results);
            expectTimes(results, [0, 0, 1], "Timing Results 1");
            yield wait(tick * 2);
            const results2 = yield pool
                .addGenericTask({
                generator: () => {
                    return Promise.resolve(end());
                },
                invocationLimit: 3,
            })
                .promise();
            debug(results2);
            expectTimes(results2, [3, 3, 4], "Timing Results 2");
        }));
    });
    it("Group Limit", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        const group = pool.addGroup({
            frequencyLimit: 2,
            frequencyWindow: tick,
        });
        const end = time_span_1.default();
        const results = yield pool
            .addGenericTask({
            generator: () => {
                return Promise.resolve(end());
            },
            groups: [group],
            invocationLimit: 3,
        })
            .promise();
        expectTimes(results, [0, 0, 1], "Timing Results");
        chai_1.expect(group._frequencyStarts).to.have.length.of.at.least(1);
    }));
    it("Should Not Collect Timestamps If Not Set", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        yield pool
            .addGenericTask({
            generator: () => Promise.resolve(),
            invocationLimit: 1,
        })
            .promise();
        chai_1.expect(pool._globalGroup._frequencyStarts).to.have.lengthOf(0);
    }));
});
describe("Exception Handling", () => {
    it("Generator Function (synchronous)", () => {
        const pool = new Pool.PromisePoolExecutor();
        const error = new Error();
        return chai_1.expect(pool
            .addGenericTask({
            generator: () => {
                throw error;
            },
        })
            .promise()).to.be.rejectedWith(error);
    });
    it("Promise Rejection", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        const error = new Error();
        yield chai_1.expect(pool
            .addGenericTask({
            generator: () => __awaiter(this, void 0, void 0, function* () {
                yield wait(1);
                throw error;
            }),
            invocationLimit: 1,
        })
            .promise()).to.be.rejectedWith(error);
    }));
    it("Multi-rejection", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        const errors = [new Error("First"), new Error("Second")];
        yield chai_1.expect(pool
            .addGenericTask({
            generator: (i) => __awaiter(this, void 0, void 0, function* () {
                yield wait(i ? tick : 1);
                throw errors[i];
            }),
            invocationLimit: 2,
        })
            .promise()).to.be.rejectedWith(errors[0]);
        // Wait to ensure that the second rejection happens within the scope of this test without issue
        yield wait(tick * 2);
    }));
    describe("Invalid Configuration", () => {
        it("Invalid Parameters", () => {
            const pool = new Pool.PromisePoolExecutor();
            chai_1.expect(() => pool.addGenericTask({
                concurrencyLimit: 0,
                generator: () => {
                    return Promise.resolve();
                },
            })).to.throw(Error, /^Invalid concurrency limit: 0$/);
            // TODO: Test error message
        });
        it("Group From Another Pool", () => {
            const pool1 = new Pool.PromisePoolExecutor();
            const pool2 = new Pool.PromisePoolExecutor();
            chai_1.expect(() => pool1.addGenericTask({
                generator: () => {
                    return Promise.resolve();
                },
                groups: [
                    pool2.addGroup({
                        concurrencyLimit: 1,
                    }),
                ],
            })).to.throw(Error, /^options\.groups contains a group belonging to a different pool$/);
        });
    });
    describe("Unhandled Rejection", () => {
        it("Generator Function (synchronous)", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
            });
            yield expectUnhandledRejection(error);
        }));
        it("Promise Rejection", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            pool.addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(1);
                    throw error;
                }),
                invocationLimit: 1,
            });
            yield expectUnhandledRejection(error);
        }));
        it("Late Rejection Handling", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            const task = pool.addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(1);
                    throw error;
                }),
                invocationLimit: 1,
            });
            yield expectUnhandledRejection(error);
            yield Promise.all([expectHandledRejection(), chai_1.expect(task.promise()).to.be.rejectedWith(error)]);
        }));
        it("Multi-rejection", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const errors = [new Error("first"), new Error("second")];
            errors.forEach((err, i) => {
                // Create a task which fails without the test handling the error
                pool.addGenericTask({
                    generator: () => __awaiter(this, void 0, void 0, function* () {
                        yield wait(i ? tick : 1);
                        throw err;
                    }),
                    invocationLimit: 1,
                });
            });
            yield expectUnhandledRejection(errors[0]);
            yield expectUnhandledRejection(errors[1]);
        }));
        // This scenario creates two tasks at the same time
        // The first task rejects but is handled, while the second remains unhandled.
        it("Handled Rejection Followed By Unhandled Rejection", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const errors = [new Error("first"), new Error("second")];
            // Create a task which will reject later without being handled
            pool.addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(tick);
                    throw errors[1];
                }),
                invocationLimit: 1,
            });
            yield chai_1.expect(pool
                .addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(1);
                    throw errors[0];
                }),
                invocationLimit: 1,
            })
                .promise()).to.be.rejectedWith(errors[0]);
            yield expectUnhandledRejection(errors[1]);
        }));
        it("Unhandled Followed By Rejection With pool.waitForIdle", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const errors = [new Error("first"), new Error("second")];
            pool.addGenericTask({
                generator: () => Promise.reject(errors[0]),
                invocationLimit: 1,
            });
            // Keep the global group busy so the error will not clear
            pool.addGenericTask({
                generator: () => wait(tick),
                invocationLimit: 1,
            });
            yield expectUnhandledRejection(errors[0]);
            pool.addGenericTask({
                generator: () => {
                    throw errors[1];
                },
                invocationLimit: 1,
            });
            yield Promise.all([expectHandledRejection(), chai_1.expect(pool.waitForIdle()).to.be.rejectedWith(errors[0])]);
            // Wait to ensure the task does not throw an unhandled rejection
            yield wait(tick);
        }));
    });
    describe("pool.waitForIdle", () => {
        it("Generator Function (synchronous)", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
            });
            yield chai_1.expect(pool.waitForIdle()).to.be.rejectedWith(error);
        }));
        it("Promise Rejection", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            pool.addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(1);
                    throw error;
                }),
                invocationLimit: 1,
            });
            yield chai_1.expect(pool.waitForIdle()).to.be.rejectedWith(error);
        }));
        // In this scenario, a child task fails after its parent does. In this case, only the first error should
        // be received, and the second should be handled by the pool.
        it("Child Task Rejection Shadowed By Parent Rejection", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error("Parent error");
            let thrown = false;
            const end = time_span_1.default();
            pool.addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(tick);
                    pool.addGenericTask({
                        generator: () => __awaiter(this, void 0, void 0, function* () {
                            yield wait(tick);
                            thrown = true;
                            throw new Error("Child task error");
                        }),
                        invocationLimit: 1,
                    });
                    debug("About to throw");
                    throw error;
                }),
                invocationLimit: 1,
            });
            yield chai_1.expect(pool.waitForIdle()).to.be.rejectedWith(error);
            expectTimes([end()], [1], "Timing Results");
            chai_1.expect(thrown).to.equal(false, "Child task must throw yet");
            yield wait(tick * 2);
            chai_1.expect(thrown).to.equal(true, "Child task must throw error");
        }));
        describe("Clearing After Delay", () => {
            it("Promise Rejection", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                const error = new Error();
                yield Promise.all([
                    chai_1.expect(pool
                        .addGenericTask({
                        generator: () => __awaiter(this, void 0, void 0, function* () {
                            yield wait(1);
                            throw error;
                        }),
                        invocationLimit: 1,
                    })
                        .promise()).to.be.rejectedWith(error),
                    (() => __awaiter(this, void 0, void 0, function* () {
                        yield wait(tick);
                        try {
                            yield pool.waitForIdle();
                        }
                        catch (err) {
                            throw new Error("Error did not clear");
                        }
                    }))(),
                ]);
            }));
        });
    });
    describe("group.waitForIdle", () => {
        it("Generator Function (synchronous)", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            const group = pool.addGroup({});
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                groups: [group],
                invocationLimit: 1,
            });
            yield chai_1.expect(group.waitForIdle()).to.be.rejectedWith(error);
        }));
        it("Promise Rejection", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const error = new Error();
            const group = pool.addGroup({});
            pool.addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(1);
                    throw error;
                }),
                groups: [group],
                invocationLimit: 1,
            });
            yield chai_1.expect(group.waitForIdle()).to.be.rejectedWith(error);
        }));
    });
});
describe("Miscellaneous Features", () => {
    describe("End Task", () => {
        it("From Generator With No Promise", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const results = yield pool
                .addGenericTask({
                generator() {
                    this.end();
                },
            })
                .promise();
            chai_1.expect(results).to.have.lengthOf(0);
        }));
        it("From Generator With Promise", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const results = yield pool
                .addGenericTask({
                generator() {
                    this.end();
                    // Add one final promise after ending the task
                    return Promise.resolve(1);
                },
            })
                .promise();
            chai_1.expect(results).to.deep.equal([1]);
        }));
    });
    it("Generator Recursion Prevention", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        let runCount = 0;
        yield pool
            .addGenericTask({
            generator() {
                runCount++;
                // Add a task, triggering it to run
                pool.addGenericTask({
                    generator: () => {
                        // do nothing
                    },
                });
            },
        })
            .promise();
        chai_1.expect(runCount).to.equal(1, "runCount");
    }));
    it("Pause/Resume Task", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        const end = time_span_1.default();
        const task = pool.addGenericTask({
            generator(index) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (index === 0) {
                        this.pause();
                    }
                    yield wait(tick);
                    return end();
                });
            },
            invocationLimit: 3,
        });
        wait(tick).then(() => {
            task.resume();
        });
        const results = yield task.promise();
        // The task must return the expected non-array result
        expectTimes(results, [1, 2, 2], "Timing Results");
    }));
    it("Get Task Status", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        const status = yield pool
            .addGenericTask({
            concurrencyLimit: 5,
            frequencyLimit: 5,
            frequencyWindow: 1000,
            generator() {
                return __awaiter(this, void 0, void 0, function* () {
                    yield wait(tick);
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
        })
            .promise();
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
    }));
    describe("waitForIdle", () => {
        it("Simple", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const end = time_span_1.default();
            pool.addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(tick);
                }),
                invocationLimit: 1,
            });
            yield pool.waitForIdle();
            expectTimes([end()], [1], "Timing Results");
        }));
        it("Set concurrencyLimit", () => {
            const pool = new Pool.PromisePoolExecutor(1);
            chai_1.expect(pool.concurrencyLimit).to.equal(1);
            pool.concurrencyLimit = 2;
            chai_1.expect(pool.concurrencyLimit).to.equal(2);
        });
        it("Child Task", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const end = time_span_1.default();
            pool.addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(tick);
                    pool.addGenericTask({
                        generator: () => __awaiter(this, void 0, void 0, function* () {
                            yield wait(tick);
                        }),
                        invocationLimit: 1,
                    });
                }),
                invocationLimit: 1,
            });
            yield pool.waitForIdle();
            expectTimes([end()], [2], "Timing Results");
        }));
        it("No Task", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            yield pool.waitForIdle();
        }));
    });
    describe("waitForGroupIdle", () => {
        it("Simple", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const end = time_span_1.default();
            const group = pool.addGroup({});
            pool.addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(tick);
                }),
                groups: [group],
                invocationLimit: 1,
            });
            yield group.waitForIdle();
            expectTimes([end()], [1], "Timing Results");
        }));
        it("Child Task", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const end = time_span_1.default();
            const group = pool.addGroup({});
            pool.addGenericTask({
                generator: () => __awaiter(this, void 0, void 0, function* () {
                    yield wait(tick);
                    pool.addGenericTask({
                        generator: () => __awaiter(this, void 0, void 0, function* () {
                            yield wait(tick);
                        }),
                        groups: [group],
                        invocationLimit: 1,
                    });
                }),
                groups: [group],
                invocationLimit: 1,
            });
            yield group.waitForIdle();
            expectTimes([end()], [2], "Timing Results");
        }));
    });
    describe("Configure Task", () => {
        it("Invocation Limit Triggers Completion", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const end = time_span_1.default();
            const task = pool.addGenericTask({
                frequencyLimit: 1,
                frequencyWindow: tick * 2,
                generator: () => {
                    return Promise.resolve(end());
                },
                invocationLimit: 2,
            });
            wait(tick).then(() => {
                task.invocationLimit = 1;
            });
            const results = yield task.promise();
            expectTimes([...results, end()], [0, 1], "Timing Results");
        }));
    });
    describe("Configure Group", () => {
        it("Triggers Promises", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const end = time_span_1.default();
            const group = pool.addGroup({
                frequencyLimit: 1,
                frequencyWindow: tick * 2,
            });
            wait(tick).then(() => {
                group.frequencyWindow = 1;
                group.frequencyLimit = 1;
            });
            const results = yield pool
                .addGenericTask({
                generator: () => {
                    return Promise.resolve(end());
                },
                groups: [group],
                invocationLimit: 2,
            })
                .promise();
            expectTimes(results, [0, 1], "Timing Results");
        }));
    });
});
describe("Task Secializations", () => {
    it("Single Task", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        const end = time_span_1.default();
        let iteration = 0;
        const result = yield pool
            .addSingleTask({
            data: "test",
            generator: (data) => __awaiter(this, void 0, void 0, function* () {
                chai_1.expect(data).to.equal("test");
                // The task cannot run more than once
                chai_1.expect(iteration++).to.equal(0);
                yield wait(tick);
                return end();
            }),
        })
            .promise();
        debug(`Test result: ${result} (${typeof result})`);
        // The task must return the expected non-array result
        expectTimes([result], [1], "Timing Results");
    }));
    it("Linear Task", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        const end = time_span_1.default();
        const results = yield pool
            .addLinearTask({
            generator: () => __awaiter(this, void 0, void 0, function* () {
                yield wait(tick);
                return end();
            }),
            invocationLimit: 3,
        })
            .promise();
        expectTimes(results, [1, 2, 3], "Timing Results");
    }));
    it("Each Task", () => __awaiter(this, void 0, void 0, function* () {
        const pool = new Pool.PromisePoolExecutor();
        const end = time_span_1.default();
        const results = yield pool
            .addEachTask({
            concurrencyLimit: Infinity,
            data: [3, 2, 1],
            generator: (element) => __awaiter(this, void 0, void 0, function* () {
                yield wait(tick * element);
                return end();
            }),
        })
            .promise();
        expectTimes(results, [3, 2, 1], "Timing Results");
    }));
    describe("Batch Task", () => {
        it("Static Batch Size", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const end = time_span_1.default();
            const results = yield pool
                .addBatchTask({
                // Groups the data as [[3, 1], [2]]
                batchSize: 2,
                data: [3, 1, 2],
                generator: (data) => __awaiter(this, void 0, void 0, function* () {
                    yield wait(tick * sum(data));
                    return end();
                }),
            })
                .promise();
            expectTimes(results, [4, 2], "Timing Results");
        }));
        it("Dynamic Batch Size", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            const end = time_span_1.default();
            const results = yield pool
                .addBatchTask({
                batchSize: (elements, freeSlots) => {
                    // Groups the data as [[2], [1, 3]]
                    return Math.floor(elements / freeSlots);
                },
                concurrencyLimit: 2,
                data: [2, 1, 3],
                generator: (data) => __awaiter(this, void 0, void 0, function* () {
                    yield wait(tick * sum(data));
                    return end();
                }),
            })
                .promise();
            expectTimes(results, [2, 4], "Timing Results");
        }));
    });
    describe("Persistent Batch Task", () => {
        it("Core Functionality", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            let runCount = 0;
            const task = pool.addPersistentBatchTask({
                generator: (input) => __awaiter(this, void 0, void 0, function* () {
                    runCount++;
                    yield wait(tick);
                    return input.map(String);
                }),
            });
            const inputs = [1, 5, 9];
            const end = time_span_1.default();
            yield Promise.all(inputs.map((input) => __awaiter(this, void 0, void 0, function* () {
                const output = yield task.getResult(input);
                chai_1.expect(output).to.equal(String(input), "Outputs");
                expectTimes([end()], [1], "Timing Results");
            })));
            chai_1.expect(runCount).to.equal(1, "runCount");
            // Verify that the task is not storing the results, which would waste memory.
            chai_1.expect(task._task._result.length).to.equal(0);
        }));
        it("Offset Batches", () => __awaiter(this, void 0, void 0, function* () {
            // Runs two batches of requests, offset so the second starts while the first is half finished.
            const pool = new Pool.PromisePoolExecutor();
            const end = time_span_1.default();
            let runCount = 0;
            const task = pool.addPersistentBatchTask({
                generator: (input) => __awaiter(this, void 0, void 0, function* () {
                    runCount++;
                    yield wait(tick * 2);
                    return input.map(String);
                }),
                queuingDelay: tick,
            });
            const results = yield Promise.all([[1, 9], [5, 7]].map((input, index) => __awaiter(this, void 0, void 0, function* () {
                yield wait(2 * index * tick);
                return Promise.all(input.map((value) => __awaiter(this, void 0, void 0, function* () {
                    const result = yield task.getResult(value);
                    chai_1.expect(result).to.equal(String(value));
                    return end();
                })));
            })));
            expectTimes([].concat(...results), [3, 3, 5, 5], "Timing Results");
            chai_1.expect(runCount).to.equal(2, "runCount");
        }));
        describe("maxBatchSize", () => __awaiter(this, void 0, void 0, function* () {
            it("Core Functionality", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const task = pool.addPersistentBatchTask({
                    generator: (input) => __awaiter(this, void 0, void 0, function* () {
                        runCount++;
                        yield wait(tick);
                        return input.map(String);
                    }),
                    maxBatchSize: 2,
                    queuingDelay: tick,
                });
                const end = time_span_1.default();
                const results = yield Promise.all([1, 5, 9].map((input) => __awaiter(this, void 0, void 0, function* () {
                    const output = yield task.getResult(input);
                    chai_1.expect(output).to.equal(String(input), "Outputs");
                    return end();
                })));
                expectTimes(results, [1, 1, 2], "Timing Results");
                chai_1.expect(runCount).to.equal(2, "runCount");
            }));
            it("Instant Start", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const task = pool.addPersistentBatchTask({
                    generator: (input) => __awaiter(this, void 0, void 0, function* () {
                        runCount++;
                        yield wait(tick);
                        return input;
                    }),
                    maxBatchSize: 2,
                });
                yield Promise.all([0, 1, 1].map((expectedRunCount) => __awaiter(this, void 0, void 0, function* () {
                    // The generator should be triggered instantly when the max batch size is reached
                    const promise = task.getResult(undefined);
                    chai_1.expect(runCount).to.equal(expectedRunCount);
                    yield promise;
                })));
            }));
        }));
        it("queuingDelay", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            let runCount = 0;
            const task = pool.addPersistentBatchTask({
                generator: (input) => __awaiter(this, void 0, void 0, function* () {
                    runCount++;
                    return new Array(input.length);
                }),
                queuingDelay: tick * 2,
            });
            const end = time_span_1.default();
            const results = yield Promise.all([0, 1, 3].map((delay) => __awaiter(this, void 0, void 0, function* () {
                yield wait(delay * tick);
                yield task.getResult(undefined);
                return end();
            })));
            expectTimes(results, [2, 2, 5], "Timing Results");
            chai_1.expect(runCount).to.equal(2, "runCount");
        }));
        it("Delay After Hitting Concurrency Limit", () => __awaiter(this, void 0, void 0, function* () {
            const pool = new Pool.PromisePoolExecutor();
            let runCount = 0;
            const task = pool.addPersistentBatchTask({
                concurrencyLimit: 1,
                generator: (input) => __awaiter(this, void 0, void 0, function* () {
                    runCount++;
                    yield wait(3 * tick);
                    return new Array(input.length);
                }),
                queuingDelay: tick,
                queuingThresholds: [1, Infinity],
            });
            const end = time_span_1.default();
            const results = yield Promise.all([
                (() => __awaiter(this, void 0, void 0, function* () {
                    yield task.getResult(undefined);
                    yield task.getResult(undefined);
                    return end();
                }))(),
                (() => __awaiter(this, void 0, void 0, function* () {
                    yield wait(2 * tick);
                    yield task.getResult(undefined);
                    return end();
                }))(),
            ]);
            expectTimes(results, [8, 8], "Timing Results");
            chai_1.expect(runCount).to.equal(2, "runCount");
        }));
        describe("queueingThresholds", () => {
            it("Core Functionality", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const task = pool.addPersistentBatchTask({
                    generator: (input) => __awaiter(this, void 0, void 0, function* () {
                        runCount++;
                        yield wait(7 * tick);
                        return new Array(input.length);
                    }),
                    queuingThresholds: [1, 2],
                    queuingDelay: tick,
                });
                const end = time_span_1.default();
                const results = yield Promise.all([0, 2, 3, 5, 6].map((delay) => __awaiter(this, void 0, void 0, function* () {
                    yield wait(delay * tick);
                    yield task.getResult(undefined);
                    return end();
                })));
                expectTimes(results, [8, 11, 11, 14, 14], "Timing Results");
                chai_1.expect(runCount).to.equal(3, "runCount");
            }));
            it("Should Trigger On Task Completion", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: (input) => __awaiter(this, void 0, void 0, function* () {
                        yield wait(2 * tick);
                        return new Array(input.length);
                    }),
                    queuingThresholds: [1, Infinity],
                    queuingDelay: tick,
                });
                const end = time_span_1.default();
                const results = yield Promise.all([0, 2].map((delay) => __awaiter(this, void 0, void 0, function* () {
                    yield wait(delay * tick);
                    yield task.getResult(undefined);
                    return end();
                })));
                expectTimes(results, [3, 6], "Timing Results");
            }));
        });
        describe("Retries", () => {
            it("Full", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const batcher = pool.addPersistentBatchTask({
                    generator: (inputs) => __awaiter(this, void 0, void 0, function* () {
                        runCount++;
                        yield wait(tick);
                        if (runCount < 2) {
                            return inputs.map(() => Pool.BATCHER_RETRY_TOKEN);
                        }
                        return inputs.map((input) => input + 1);
                    }),
                    queuingDelay: tick,
                });
                const end = time_span_1.default();
                const results = yield Promise.all([1, 2].map((input) => __awaiter(this, void 0, void 0, function* () {
                    const output = yield batcher.getResult(input);
                    chai_1.expect(output).to.equal(input + 1, "getResult output");
                    return end();
                })));
                expectTimes(results, [4, 4], "Timing Results");
                chai_1.expect(runCount).to.equal(2, "runCount");
            }));
            it("Partial", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const batcher = pool.addPersistentBatchTask({
                    generator: (inputs) => __awaiter(this, void 0, void 0, function* () {
                        runCount++;
                        yield wait(tick);
                        return inputs.map((input, index) => {
                            return runCount < 2 && index < 1 ? Pool.BATCHER_RETRY_TOKEN : input + 1;
                        });
                    }),
                    queuingDelay: tick,
                });
                const end = time_span_1.default();
                const results = yield Promise.all([1, 2].map((input) => __awaiter(this, void 0, void 0, function* () {
                    const output = yield batcher.getResult(input);
                    chai_1.expect(output).to.equal(input + 1, "getResult output");
                    return end();
                })));
                expectTimes(results, [4, 2], "Timing Results");
                chai_1.expect(runCount).to.equal(2, "runCount");
            }));
            it("Ordering", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                const batchInputs = [];
                const batcher = pool.addPersistentBatchTask({
                    generator: (inputs) => __awaiter(this, void 0, void 0, function* () {
                        batchInputs.push(inputs);
                        yield wait(tick);
                        return inputs.map((input, index) => {
                            return batchInputs.length < 2 && index < 2 ? Pool.BATCHER_RETRY_TOKEN : input + 1;
                        });
                    }),
                    maxBatchSize: 3,
                    queuingThresholds: [1, Infinity],
                });
                const end = time_span_1.default();
                const results = yield Promise.all([1, 2, 3, 4].map((input) => __awaiter(this, void 0, void 0, function* () {
                    const output = yield batcher.getResult(input);
                    chai_1.expect(output).to.equal(input + 1, "getResult output");
                    return end();
                })));
                expectTimes(results, [2, 2, 1, 2], "Timing Results");
                chai_1.expect(batchInputs).to.deep.equal([[1, 2, 3], [1, 2, 4]], "batchInputs");
            }));
        });
        describe("Send Method", () => {
            it("Single Use", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const batcher = pool.addPersistentBatchTask({
                    generator: (inputs) => __awaiter(this, void 0, void 0, function* () {
                        runCount++;
                        yield wait(tick);
                        return inputs;
                    }),
                    queuingDelay: tick,
                    queuingThresholds: [1, Infinity],
                });
                const end = time_span_1.default();
                const results = yield Promise.all([1, 2, 3].map((_, index) => __awaiter(this, void 0, void 0, function* () {
                    const promise = batcher.getResult(undefined);
                    if (index === 1) {
                        chai_1.expect(runCount).to.equal(0, "runCount before");
                        batcher.send();
                        chai_1.expect(runCount).to.equal(1, "runCount after");
                    }
                    yield promise;
                    return end();
                })));
                expectTimes(results, [1, 1, 3], "Timing Results");
            }));
            it("Effect Delayed By queuingThreshold", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const batcher = pool.addPersistentBatchTask({
                    generator: (inputs) => __awaiter(this, void 0, void 0, function* () {
                        runCount++;
                        yield wait(tick);
                        return inputs;
                    }),
                    queuingDelay: tick,
                    queuingThresholds: [1, Infinity],
                });
                const end = time_span_1.default();
                const results = yield Promise.all([1, 2, 3].map((_, index) => __awaiter(this, void 0, void 0, function* () {
                    const promise = batcher.getResult(undefined);
                    if (index === 1) {
                        chai_1.expect(runCount).to.equal(0, "runCount before");
                        batcher.send();
                        chai_1.expect(runCount).to.equal(1, "runCount after");
                    }
                    else if (index === 2) {
                        batcher.send();
                        chai_1.expect(runCount).to.equal(1, "runCount after second");
                    }
                    yield promise;
                    return end();
                })));
                expectTimes(results, [1, 1, 2], "Timing Results");
            }));
            it("Interaction With Retries", () => __awaiter(this, void 0, void 0, function* () {
                // This tests that the effect of the send method lasts even after a retry
                const pool = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const batcher = pool.addPersistentBatchTask({
                    generator: (inputs) => __awaiter(this, void 0, void 0, function* () {
                        runCount++;
                        yield wait(tick);
                        return runCount === 1 ? inputs.map(() => Pool.BATCHER_RETRY_TOKEN) : inputs;
                    }),
                    queuingDelay: tick,
                    queuingThresholds: [1, Infinity],
                });
                const end = time_span_1.default();
                const results = yield Promise.all([1, 2, 3].map((_, index) => __awaiter(this, void 0, void 0, function* () {
                    const promise = batcher.getResult(undefined);
                    if (index >= 1) {
                        batcher.send();
                    }
                    yield promise;
                    return end();
                })));
                chai_1.expect(runCount).to.equal(2, "runCount");
                expectTimes(results, [2, 2, 2], "Timing Results");
            }));
        });
        describe("Error Handling", () => {
            it("Single Rejection", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: (input) => __awaiter(this, void 0, void 0, function* () {
                        yield wait(tick);
                        return input.map((value) => {
                            return value === "error" ? new Error("test") : undefined;
                        });
                    }),
                });
                const results = yield Promise.all(["a", "error", "b"].map((input) => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield task.getResult(input);
                        return true;
                    }
                    catch (err) {
                        chai_1.expect(err.message).to.equal("test");
                        return false;
                    }
                })));
                chai_1.expect(results).to.deep.equal([true, false, true]);
            }));
            it("Synchronous Generator Exception Followed By Success", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: (input) => __awaiter(this, void 0, void 0, function* () {
                        input.forEach((value) => {
                            if (value === 0) {
                                throw new Error("test");
                            }
                        });
                        yield wait(1);
                        return new Array(input.length);
                    }),
                    maxBatchSize: 2,
                });
                yield Promise.all([0, 1].map((input) => __awaiter(this, void 0, void 0, function* () {
                    yield chai_1.expect(task.getResult(input)).to.be.rejectedWith(Error, /^test$/);
                })));
                yield task.getResult(2);
            }));
            it("Asynchronous Generator Exception Followed By Success", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: (input) => __awaiter(this, void 0, void 0, function* () {
                        yield wait(1);
                        input.forEach((value) => {
                            if (value === 0) {
                                throw new Error("test");
                            }
                        });
                        return new Array(input.length);
                    }),
                    maxBatchSize: 2,
                });
                yield Promise.all([0, 1].map((input) => __awaiter(this, void 0, void 0, function* () {
                    yield chai_1.expect(task.getResult(input)).to.be.rejectedWith(Error, /^test$/);
                })));
                yield task.getResult(1);
            }));
            it("Invalid Output Length", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: (input) => __awaiter(this, void 0, void 0, function* () {
                        // Respond with an array larger than the input
                        yield wait(1);
                        return new Array(input.length + 1);
                    }),
                });
                yield Promise.all([0, 1, 2].map((input) => __awaiter(this, void 0, void 0, function* () {
                    chai_1.expect(task.getResult(input)).to.be.rejectedWith(Error, /^batchingFunction output length does not equal the input length$/);
                })));
            }));
            it("End Task", () => __awaiter(this, void 0, void 0, function* () {
                const pool = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask({
                    generator: () => __awaiter(this, void 0, void 0, function* () {
                        yield wait(tick);
                        return [];
                    }),
                });
                const firstPromise = task.getResult(undefined);
                task.end();
                chai_1.expect(task.state === Pool.TaskState.Terminated, "State should be terminated");
                yield Promise.all([firstPromise, task.getResult(undefined)].map((promise) => {
                    return chai_1.expect(promise).to.be.rejectedWith(Error, /^This task has ended and cannot process more items$/);
                }));
            }));
        });
    });
});
