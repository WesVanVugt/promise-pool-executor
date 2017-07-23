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

beforeEach(() => {
    process.removeAllListeners("unhandledRejection");
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
        }).promise().then((results) => {
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
        }).promise().then((results) => {
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
        }).promise().then((results) => {
            expectTimes(results, [1, 1, 2], "Timing Results");
        });
    });

    it("Group Limit", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        const group: Pool.PromisePoolGroup = pool.addGroup({
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
            }).promise().then((results) => {
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
            }).promise().then((results) => {
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
            }).promise().then((results) => {
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
                expectTimes(results, [3, 3, 4], "Timing Results 2");
            });
        });
    });

    it("Group Limit", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        let group: Pool.PromisePoolGroup = pool.addGroup({
            frequencyLimit: 2,
            frequencyWindow: tick,
        });

        let start: number = Date.now();
        return pool.addGenericTask({
            generator: () => {
                return Promise.resolve(Date.now() - start);
            },
            groups: [group],
            invocationLimit: 3,
        }).promise().then((results) => {
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
        }).promise().catch((err) => {
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
        }).promise().catch((err) => {
            expect(err).to.equal(error);
            caught = true;
        }).then((results) => {
            expect(caught).to.equal(true, "Must throw an error");
        });
    });

    describe("Invalid Configuration", () => {
        it("Invalid Parameters", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            expect(() => pool.addGenericTask({
                generator: () => {
                    return Promise.resolve();
                },
                concurrencyLimit: 0, // invalid
            })).to.throw();
        });

        it("Group From Another Pool", () => {
            const pool1: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
            const pool2: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            expect(() => pool1.addGenericTask({
                generator: () => {
                    return Promise.resolve();
                },
                groups: [pool2.addGroup({
                    concurrencyLimit: 1,
                })],
            })).to.throw();
        });
    })

    describe("Unhandled Rejection", () => {
        it("Generator Function (synchronous)", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let error: Error = new Error();
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
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
            });
            return expectUnhandledRejection(error);
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
            }).promise().catch((err) => {
                caught = err;
            });
            return expectUnhandledRejection(
                errors[1], tick * 2,
            ).then(() => {
                expect(caught).to.equal(errors[0]);
            });
        });
    })

    describe("pool.waitForIdle", () => {
        it("Generator Function (synchronous)", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let error: Error = new Error();
            let caught: boolean = false;
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
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
            });
            return pool.waitForIdle(
            ).catch((err) => {
                expect(err).to.equal(error);
                caught = true;
            }).then(() => {
                expect(caught).to.equal(true, "Must throw an error");
            });
        });

        describe("Clearing After Delay", () => {
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
                }).promise().catch((err) => {
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
        });
    });

    describe("group.waitForIdle", () => {
        it("Generator Function (synchronous)", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let error: Error = new Error();
            let caught: boolean = false;
            let group: Pool.PromisePoolGroup = pool.addGroup({});
            pool.addGenericTask({
                groups: [group],
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
            });
            return group.waitForIdle(
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
            let group: Pool.PromisePoolGroup = pool.addGroup({});
            pool.addGenericTask({
                groups: [group],
                generator: () => {
                    return wait(1).then(() => {
                        throw error;
                    });
                },
                invocationLimit: 1,
            });
            return group.waitForIdle(
            ).catch((err) => {
                expect(err).to.equal(error);
                caught = true;
            }).then((results) => {
                expect(caught).to.equal(true, "Must throw an error");
            });
        });
    });
});

describe("Miscellaneous Features", () => {
    it("End Task", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        return pool.addGenericTask({
            generator: function (index) {
                if (index >= 2) {
                    this.end();
                }
                return wait(tick)
                    .then(() => {
                        return Date.now() - start;
                    });
            }
        }).promise().then((results) => {
            // The task must return the expected non-array result
            expectTimes(results, [1, 1, 1], "Timing Results");
        });
    });

    it("Pause/Resume Task", () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const start: number = Date.now();
        let paused: boolean = false;
        const task = pool.addGenericTask({
            invocationLimit: 3,
            generator: function (index) {
                if (index === 1 && !paused) {
                    paused = true;
                    this.pause();
                    return null;
                }
                return wait(tick)
                    .then(() => {
                        return Date.now() - start;
                    });
            },
        });
        wait(tick).then(() => {
            task.resume();
        })
        return task.promise().then((results) => {
            // The task must return the expected non-array result
            expectTimes(results, [1, 2, 2], "Timing Results");
        });
    });

    it("Get Task Status", () => {
        let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        let start: number = Date.now();
        return pool.addGenericTask({
            generator: function (index) {
                return wait(tick)
                    .then(() => {
                        return this.getStatus();
                    });
            },
            invocationLimit: 1,
            concurrencyLimit: 5,
            frequencyLimit: 5,
            frequencyWindow: 1000,
        }).promise().then((status) => {
            const expectedStatus: Pool.TaskStatus = {
                activeTaskCount: 1,
                activePromiseCount: 1,
                concurrencyLimit: 5,
                invocations: 1,
                invocationLimit: 1,
                frequencyLimit: 5,
                frequencyWindow: 1000,
                freeSlots: 0,
            };
            expect(status[0]).to.deep.equal(expectedStatus);
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
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            return pool.waitForIdle();
        });
    });

    describe("waitForGroupIdle", () => {
        it("Simple", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
            let group = pool.addGroup({});
            pool.addGenericTask({
                groups: [group],
                generator: () => {
                    return wait(tick);
                },
                invocationLimit: 1,
            });
            return group.waitForIdle()
                .then(() => {
                    expectTimes([Date.now() - start], [1], "Timing Results");
                });
        });

        it("Child Task", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
            let group = pool.addGroup({});
            pool.addGenericTask({
                groups: [group],
                generator: () => {
                    return wait(tick).then(() => {
                        pool.addGenericTask({
                            groups: [group],
                            generator: () => {
                                return wait(tick);
                            },
                            invocationLimit: 1,
                        });
                    });
                },
                invocationLimit: 1,
            });
            return group.waitForIdle()
                .then(() => {
                    expectTimes([Date.now() - start], [2], "Timing Results");
                });
        });
    });

    describe("Configure Group", () => {
        it("triggerPromises", () => {
            let pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            let start: number = Date.now();
            let group = pool.addGroup({
                frequencyLimit: 1,
                frequencyWindow: tick * 2,
            });
            wait(tick).then(() => {
                group.configure({
                    frequencyLimit: 1,
                    frequencyWindow: 1,
                });
            });
            return pool.addGenericTask({
                groups: [group],
                generator: () => {
                    return Promise.resolve(Date.now() - start);
                },
                invocationLimit: 2,
            }).promise().then((results) => {
                expectTimes(results, [0, 1], "Timing Results");
            });
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
        }).promise().then((result) => {
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
        }).promise().then((results) => {
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
        }).promise().then((results) => {
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
            }).promise().then((results) => {
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
            }).promise().then((results) => {
                expectTimes(results, [2, 4], "Timing Results");
            });
        });
    });
});