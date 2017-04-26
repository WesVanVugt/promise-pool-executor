import { expect } from "chai";
import * as Pool from "../index";

/**
 * Milliseconds per tick.
 */
const tick: number = 50;
/**
 * Milliseconds tolerance for tests, above or below the target.
 */
const tolerance: number = 20;

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
 * Expects an unhandled promise rejection.
 * @param expectedError The error expected to be received with the rejection (optional).
 */
function expectUnhandledRejection(expectedError?: any, delay?: number): Promise<void> {
    process.removeListener("unhandledRejection", unhandledRejectionListener);

    let reAdded: boolean = false;
    let error: any;
    process.prependOnceListener("unhandledRejection", (err: any) => {
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
            expect(error).to.equal(expectedError);
        } else {
            expect(error).to.be.instanceof(Error);
        }
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

function unhandledRejectionListener(err: any) {
    // Fail the test
    throw new Error("UnhandledPromiseRejection: " + err.message);
}

before(() => {
    process.addListener("unhandledRejection", unhandledRejectionListener);
});

describe("Concurrency", () => {
    it("No Limit", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
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
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor(2);

        let start: number = Date.now();
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
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
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

    it("Group Limit", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        let groupId: any = Symbol();
        pool.configureGroup({
            groupId: groupId,
            concurrencyLimit: 2,
        });

        let start: number = Date.now();
        return pool.addGenericTask({
            generator: () => {
                return wait(tick)
                    .then(() => {
                        return Date.now() - start;
                    });
            },
            groupIds: [groupId],
            invocationLimit: 3,
        }).then((results) => {
            expectTimes(results, [1, 1, 2], "Timing Results");
        });
    });
});

describe("Frequency", () => {
    describe("Global Limit", () => {
        it("Steady Work", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor({
                frequencyLimit: 2,
                frequencyWindow: tick,
            });

            let start: number = Date.now();
            return pool.addGenericTask({
                generator: () => {
                    return Promise.resolve(Date.now() - start);
                },
                invocationLimit: 3,
            }).then((results) => {
                expectTimes(results, [0, 0, 1], "Timing Results");
            });
        });

        it("Offset Calls", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor({
                concurrencyLimit: 1,
                frequencyLimit: 2,
                frequencyWindow: tick * 3,
            });

            let start: number = Date.now();
            return pool.addGenericTask({
                generator: () => {
                    return wait(tick).then(() => Date.now() - start);
                },
                invocationLimit: 4,
            }).then((results) => {
                expectTimes(results, [1, 2, 4, 5], "Timing Results");
            });
        });

        it("Work Gap", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor({
                frequencyLimit: 2,
                frequencyWindow: tick,
            });

            let start: number = Date.now();
            return pool.addGenericTask({
                generator: (i) => {
                    return Promise.resolve(Date.now() - start);
                },
                invocationLimit: 3,
            }).then((results) => {
                expectTimes(results, [0, 0, 1], "Timing Results 1");
                return wait(tick * 2);
            }).then(() => {
                return pool.addGenericTask({
                    generator: (i) => {
                        return Promise.resolve(Date.now() - start);
                    },
                    invocationLimit: 3,
                });
            }).then((results) => {
                expectTimes(results, [3, 3, 4], "Timing Results 2");
            });
        });
    });

    it("Group Limit", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        let groupId: any = Symbol();
        pool.configureGroup({
            groupId: groupId,
            frequencyLimit: 2,
            frequencyWindow: tick,
        });

        let start: number = Date.now();
        return pool.addGenericTask({
            generator: () => {
                return Promise.resolve(Date.now() - start);
            },
            groupIds: [groupId],
            invocationLimit: 3,
        }).then((results) => {
            expectTimes(results, [0, 0, 1], "Timing Results");
        });
    });
});

describe("Exception Handling", () => {
    it("Generator Function (synchronous)", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let error: Error = new Error();
        let caught: boolean = false;
        return pool.addGenericTask({
            generator: () => {
                throw error;
            }
        }).catch((err) => {
            expect(err).to.equal(error);
            caught = true;
        }).then((results) => {
            expect(caught).to.equal(true, "Must throw an error");
        });
    })

    it("Promise Rejection", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let error: Error = new Error();
        let caught: boolean = false;
        return pool.addGenericTask({
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
        });
    });

    describe("Unhandled Rejection", () => {
        it("Generator Function (synchronous)", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let error: Error = new Error();
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
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let error: Error = new Error();
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
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            pool.addGenericTask({
                generator: () => {
                    return Promise.resolve();
                },
                concurrencyLimit: 0, // invalid
                noPromise: true,
            });
            return expectUnhandledRejection();
        });

        it("Multi-rejection", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let errors: Error[] = [new Error("First"), new Error("Second")];
            let caught: Error;
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
            return expectUnhandledRejection(
                errors[1], tick * 2,
            ).then(() => {
                expect(caught).to.equal(errors[0]);
            });
        });
    })

    describe("waitForIdle", () => {
        it("Generator Function (synchronous)", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let error: Error = new Error();
            let caught: boolean = false;
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return pool.waitForIdle(
            ).catch((err) => {
                expect(err).to.equal(error);
                caught = true;
            }).then(() => {
                expect(caught).to.equal(true, "Must throw an error");
            });
        });

        it("Promise Rejection", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let error: Error = new Error();
            let caught: boolean = false;
            pool.addGenericTask({
                generator: () => {
                    return wait(1).then(() => {
                        throw error;
                    });
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return pool.waitForIdle(
            ).catch((err) => {
                expect(err).to.equal(error);
                caught = true;
            }).then(() => {
                expect(caught).to.equal(true, "Must throw an error");
            });
        });

        it("Invalid Parameters", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let error: Error = new Error();
            let caught: boolean = false;
            pool.addGenericTask({
                generator: () => {
                    return Promise.resolve();
                },
                concurrencyLimit: 0, // invalid
                noPromise: true,
            });
            return pool.waitForIdle(
            ).catch((err) => {
                caught = true;
            }).then(() => {
                expect(caught).to.equal(true, "Must throw an error");
            });
        });

        describe("Clearing After Delay", () => {
            it("Promise Rejection", function () {
                let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let error: Error = new Error();
                let caught: boolean = false;
                pool.addGenericTask({
                    generator: () => {
                        return wait(1).then(() => {
                            throw error;
                        });
                    },
                    invocationLimit: 1,
                }).catch((err) => {
                    expect(err).to.equal(error);
                    caught = true;
                });
                return wait(tick).then(() => {
                    return pool.waitForIdle();
                }).catch(() => {
                    throw new Error("Error did not clear");
                }).then(() => {
                    expect(caught).to.equal(true, "Must throw an error");
                });
            });

            it("Invalid Parameters", function () {
                let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let caught: boolean = false;
                pool.addGenericTask({
                    generator: () => {
                        return null;
                    },
                    concurrencyLimit: 0, // Invalid
                }).catch((err) => {
                    expect(err).to.be.instanceof(Error);
                    caught = true;
                });
                return wait(tick).then(() => {
                    return pool.waitForIdle();
                }).catch(() => {
                    throw new Error("Error did not clear");
                }).then(() => {
                    expect(caught).to.equal(true, "Must throw an error");
                });
            });
        });
    });

    describe("waitForGroupIdle", () => {
        it("Generator Function (synchronous)", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let error: Error = new Error();
            let caught: boolean = false;
            let groupId: any = Symbol();
            pool.addGenericTask({
                groupIds: [groupId],
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
                noPromise: true,
            });
            return pool.waitForGroupIdle(groupId
            ).catch((err) => {
                expect(err).to.equal(error);
                caught = true;
            }).then((results) => {
                expect(caught).to.equal(true, "Must throw an error");
            });
        });

        it("Promise Rejection", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let error: Error = new Error();
            let caught: boolean = false;
            let groupId: any = Symbol();
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
            return pool.waitForGroupIdle(groupId
            ).catch((err) => {
                expect(err).to.equal(error);
                caught = true;
            }).then((results) => {
                expect(caught).to.equal(true, "Must throw an error");
            });
        });

        it("Invalid Parameters", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let error: Error = new Error();
            let caught: boolean = false;
            let groupId: any = Symbol();
            pool.addGenericTask({
                groupIds: [groupId],
                generator: () => {
                    return Promise.resolve();
                },
                concurrencyLimit: 0, // invalid
                noPromise: true,
            });
            return pool.waitForGroupIdle(groupId
            ).catch((err) => {
                caught = true;
            }).then((results) => {
                expect(caught).to.equal(true, "Must throw an error");
            });
        });
    });
});

describe("Miscellaneous Features", () => {
    it("Stop Task", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        let id: Symbol = Symbol();
        return pool.addGenericTask({
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
        });
    });

    it("Get Task Status", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        let id: Symbol = Symbol();

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
            expect(status[0]).to.deep.equal({
                id: id,
                activeCount: 1,
                concurrencyLimit: 5,
                invocations: 1,
                invocationLimit: 1,
                freeSlots: 0,
            } as Pool.TaskStatus);
        });
    });

    describe("waitForIdle", () => {
        it("Simple", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
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
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor(1);

            expect(pool.concurrencyLimit).to.equal(1);
            pool.concurrencyLimit = 2;
            expect(pool.concurrencyLimit).to.equal(2);
        });

        it("Child Task", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
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
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            return pool.waitForIdle();
        });
    });

    describe("waitForGroupIdle", () => {
        it("Simple", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
            let groupId: any = Symbol();
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
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
            let groupId: any = Symbol();
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
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            return pool.waitForGroupIdle(Symbol());
        });
    });

    describe("configureGroup", () => {
        it("triggerPromises", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
            let groupId: any = Symbol();
            pool.configureGroup({
                groupId: groupId,
                frequencyLimit: 1,
                frequencyWindow: tick * 2,
            });
            wait(tick).then(() => {
                pool.configureGroup({
                    groupId: groupId,
                    frequencyLimit: 1,
                    frequencyWindow: 1,
                });
            });
            return pool.addGenericTask({
                groupIds: [groupId],
                generator: () => {
                    return Promise.resolve(Date.now() - start);
                },
                invocationLimit: 2,
            }).then((results) => {
                expectTimes(results, [0, 1], "Timing Results");
            });
        });
    });

    describe("deleteGroupConfiguration", () => {
        it("triggerPromises", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
            let groupId: any = Symbol();
            pool.configureGroup({
                groupId: groupId,
                frequencyLimit: 1,
                frequencyWindow: tick * 2,
            });
            wait(tick).then(() => {
                pool.deleteGroupConfiguration(groupId);
            });
            return pool.addGenericTask({
                groupIds: [groupId],
                generator: () => {
                    return Promise.resolve(Date.now() - start);
                },
                invocationLimit: 2,
            }).then((results) => {
                expectTimes(results, [0, 1], "Timing Results");
            });
        });

        it("Forget Inactive Group", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let groupId: any = Symbol();
            pool.configureGroup({
                groupId: groupId,
                frequencyLimit: 1,
                frequencyWindow: tick * 2,
            });
            let groupCount: number = (pool as any)._groupMap.size;
            pool.deleteGroupConfiguration(groupId);
            expect((pool as any)._groupMap.size).to.equal(groupCount - 1);
        });
    });

    it("Forget Unconfigured Group", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let groupId: any = Symbol();
        let groupCount: number;
        process.nextTick(() => {
            groupCount = (pool as any)._groupMap.size;
        });
        return pool.addGenericTask({
            groupIds: [groupId],
            generator: () => wait(1),
            invocationLimit: 1,
        }).then(() => {
            // 2 groups are used - 1 for the task, another for groupId
            expect((pool as any)._groupMap.size).to.equal(groupCount - 2);
        });
    });
});

describe("Task Secializations", () => {
    it("Single Task", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        let iteration: number = 0;
        return pool.addSingleTask({
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
        });
    });

    it("Linear Task", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
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
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
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
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
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
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
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