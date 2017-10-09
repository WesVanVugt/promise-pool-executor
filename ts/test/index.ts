import * as chai from "chai";
import { expect } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as Debug from "debug";
import * as Pool from "../index";

const debug = Debug("promise-pool-executor:test");
chai.use(chaiAsPromised);

// Verify that the types needed can be imported
const typingImportTest: Pool.PromisePoolExecutor
    // Group
    | Pool.PromisePoolGroup
    | Pool.PromisePoolGroupOptions
    // General Tasks
    | Pool.PromisePoolTask<any>
    | Pool.GenericTaskOptions<any>
    | Pool.GenericTaskConvertedOptions<any, any>
    | Pool.SingleTaskOptions<any, any>
    | Pool.LinearTaskOptions<any>
    | Pool.BatchTaskOptions<any, any>
    | Pool.EachTaskOptions<any, any>
    | Pool.TaskState
    // Persistent Batch Task
    | Pool.PersistentBatchTask<any, any>
    | Pool.PersistentBatchTaskOptions<any, any> = undefined as any;

if (typingImportTest) {
    // satisfy TypeScript's need to use the variable
}

/**
 * Milliseconds per tick.
 */
const tick: number = 100;
/**
 * Milliseconds tolerance for tests above the target.
 */
const tolerance: number = 60;

/**
 * Returns a promise which waits the specified amount of time before resolving.
 */
function wait(time: number): Promise<void> {
    if (time <= 0) {
        return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
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
        expect(val).to.be.within(
            targetTicks[i] * tick - 1, targetTicks[i] * tick + tolerance, message + " (" + i + ")",
        );
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
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const start: number = Date.now();
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
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor(2);

        const start: number = Date.now();
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
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const start: number = Date.now();
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
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        const group: Pool.PromisePoolGroup = pool.addGroup({
            concurrencyLimit: 2,
        });

        const start: number = Date.now();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor({
                frequencyLimit: 2,
                frequencyWindow: tick,
            });

            const start: number = Date.now();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor({
                concurrencyLimit: 1,
                frequencyLimit: 2,
                frequencyWindow: tick * 3,
            });

            const start: number = Date.now();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor({
                frequencyLimit: 2,
                frequencyWindow: tick,
            });

            const start: number = Date.now();
            return pool.addGenericTask({
                generator: () => {
                    return Promise.resolve(Date.now() - start);
                },
                invocationLimit: 3,
            }).promise().then((results) => {
                debug(results);
                expectTimes(results, [0, 0, 1], "Timing Results 1");
                return wait(tick * 2);
            }).then(() => {
                return pool.addGenericTask({
                    generator: () => {
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
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        const group: Pool.PromisePoolGroup = pool.addGroup({
            frequencyLimit: 2,
            frequencyWindow: tick,
        });

        const start: number = Date.now();
        return pool.addGenericTask({
            generator: () => {
                return Promise.resolve(Date.now() - start);
            },
            groups: [group],
            invocationLimit: 3,
        }).promise().then((results) => {
            expectTimes(results, [0, 0, 1], "Timing Results");
            expect((group as any)._frequencyStarts).to.have.length.of.at.least(1);
        });
    });

    it("Should Not Collect Timestamps If Not Set", () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        return pool.addGenericTask({
            generator: () => Promise.resolve(),
            invocationLimit: 1,
        }).promise().then(() => {
            expect((pool as any)._globalGroup._frequencyStarts).to.have.lengthOf(0);
        });
    });
});

describe("Exception Handling", () => {
    it("Generator Function (synchronous)", () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const error: Error = new Error();
        let caught: boolean = false;
        return pool.addGenericTask({
            generator: () => {
                throw error;
            },
        }).promise().catch((err) => {
            expect(err).to.equal(error);
            caught = true;
        }).then(() => {
            expect(caught).to.equal(true, "Must throw an error");
        });
    });

    it("Promise Rejection", () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const error: Error = new Error();
        let caught: boolean = false;
        return pool.addGenericTask({
            generator: () => {
                return wait(1).then(() => {
                    throw error;
                });
            },
            invocationLimit: 1,
        }).promise().catch((err) => {
            expect(err).to.equal(error);
            caught = true;
        }).then(() => {
            expect(caught).to.equal(true, "Must throw an error");
        });
    });

    describe("Invalid Configuration", () => {
        it("Invalid Parameters", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            expect(() => pool.addGenericTask({
                concurrencyLimit: 0, // invalid
                generator: () => {
                    return Promise.resolve();
                },
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
    });

    describe("Unhandled Rejection", () => {
        it("Generator Function (synchronous)", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
            });
            return expectUnhandledRejection(error);
        });

        it("Promise Rejection", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const errors: Error[] = [new Error("First"), new Error("Second")];
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
    });

    describe("pool.waitForIdle", () => {
        it("Generator Function (synchronous)", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
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
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const error: Error = new Error();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
            let caught: boolean = false;
            const group: Pool.PromisePoolGroup = pool.addGroup({});
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                groups: [group],
                invocationLimit: 1,
            });
            return group.waitForIdle(
            ).catch((err) => {
                expect(err).to.equal(error);
                caught = true;
            }).then(() => {
                expect(caught).to.equal(true, "Must throw an error");
            });
        });

        it("Promise Rejection", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
            let caught: boolean = false;
            const group: Pool.PromisePoolGroup = pool.addGroup({});
            pool.addGenericTask({
                generator: () => {
                    return wait(1).then(() => {
                        throw error;
                    });
                },
                groups: [group],
                invocationLimit: 1,
            });
            return group.waitForIdle(
            ).catch((err) => {
                expect(err).to.equal(error);
                caught = true;
            }).then(() => {
                expect(caught).to.equal(true, "Must throw an error");
            });
        });
    });
});

describe("Miscellaneous Features", () => {
    describe("End Task", () => {
        it("From Generator With No Promise", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            return pool.addGenericTask({
                generator() {
                    this.end();
                },
            }).promise().then((results) => {
                expect(results).to.have.lengthOf(0);
            });
        });

        it("From Generator With Promise", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            return pool.addGenericTask({
                generator() {
                    this.end();
                    // Add one final promise after ending the task
                    return Promise.resolve(1);
                },
            }).promise().then((results) => {
                expect(results).to.deep.equal([1]);
            });
        });
    });

    it("Generator Recursion Prevention", () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        let runCount: number = 0;

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
            expect(runCount).to.equal(1, "runCount");
        });
    });

    it("Pause/Resume Task", () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const start: number = Date.now();
        const task = pool.addGenericTask({
            generator(index) {
                if (index === 0) {
                    this.pause();
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
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        return pool.addGenericTask({
            concurrencyLimit: 5,
            frequencyLimit: 5,
            frequencyWindow: 1000,
            generator() {
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
            expect(status[0]).to.deep.equal({
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const start: number = Date.now();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor(1);

            expect(pool.concurrencyLimit).to.equal(1);
            pool.concurrencyLimit = 2;
            expect(pool.concurrencyLimit).to.equal(2);
        });

        it("Child Task", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const start: number = Date.now();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            return pool.waitForIdle();
        });
    });

    describe("waitForGroupIdle", () => {
        it("Simple", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const start: number = Date.now();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const start: number = Date.now();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const start: number = Date.now();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const start: number = Date.now();
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
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const start: number = Date.now();
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
            },
        }).promise().then((result) => {
            debug(`Test result: ${result} (${typeof result})`);
            // The task must return the expected non-array result
            expectTimes([result], [1], "Timing Results");
        });
    });

    it("Linear Task", () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const start: number = Date.now();
        return pool.addLinearTask({
            generator: () => {
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
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const start: number = Date.now();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const start: number = Date.now();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const start: number = Date.now();
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
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
            let runCount: number = 0;
            const task = pool.addPersistentBatchTask<number, string>({
                generator: (input) => {
                    runCount++;
                    return wait(tick).then(() => input.map(String));
                },
            });
            const inputs = [1, 5, 9];
            const start: number = Date.now();
            return Promise.all(inputs.map((input) => {
                return task.getResult(input).then((output) => {
                    expect(output).to.equal(String(input), "Outputs");
                    expectTimes([Date.now() - start], [1], "Timing Results");
                });
            })).then(() => {
                expect(runCount).to.equal(1, "runCount");
                // Verify that the task is not storing the results, which would waste memory.
                expect((task as any)._task._result.length).to.equal(0);
            });
        });
        it("Offset Batches", () => {
            // Runs two batches of requests, offset so the seconds starts while the first is half finished.
            // The second batch should start before the first finishes.
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
            const start: number = Date.now();
            let runCount: number = 0;
            const task = pool.addPersistentBatchTask<number, string>({
                generator: (input) => {
                    runCount++;
                    return wait(tick * 2).then(() => input.map(String));
                },
            });
            const inputs = [[1, 9], [5, 7]];
            return Promise.all(inputs.map((input, index) => {
                return wait(index * tick).then(() => Promise.all(input.map((value, index2) => {
                    return task.getResult(value).then((result) => {
                        expect(result).to.equal(String(value));
                        expectTimes([Date.now() - start], [index + 2], `Timing result (${index},${index2})`);
                    });
                })));
            })).then(() => {
                expect(runCount).to.equal(2, "runCount");
            });
        });
        describe("maxBatchSize", () => {
            it("Core Functionality", () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let runCount: number = 0;
                const task = pool.addPersistentBatchTask<number, string>({
                    generator: (input) => {
                        runCount++;
                        return wait(tick).then(() => input.map(String));
                    },
                    maxBatchSize: 2,
                });
                const inputs = [1, 5, 9];
                const start: number = Date.now();
                return Promise.all(inputs.map((input) => {
                    return task.getResult(input).then((output) => {
                        expect(output).to.equal(String(input), "Outputs");
                        expectTimes([Date.now() - start], [1], "Timing Results");
                    });
                })).then(() => {
                    expect(runCount).to.equal(2, "runCount");
                });
            });
            it("Instant Start", () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let runCount: number = 0;
                const task = pool.addPersistentBatchTask<undefined, undefined>({
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
                    expect(runCount).to.equal(expectedRunCount);
                    return promise;
                }));
            });
        });
        it("queuingDelay", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
            let runCount: number = 0;
            const task = pool.addPersistentBatchTask<undefined, undefined>({
                generator: (input) => {
                    runCount++;
                    return Promise.resolve(new Array(input.length));
                },
                queuingDelay: tick * 2,
            });
            const delays = [0, 1, 3];
            const start: number = Date.now();
            return Promise.all(delays.map((delay) => {
                return wait(delay * tick)
                    .then(() => task.getResult(undefined))
                    .then(() => Date.now() - start);
            })).then((results) => {
                expectTimes(results, [2, 2, 5], "Timing Results");
                expect(runCount).to.equal(2, "runCount");
            });
        });
        it("Delay After Hitting Concurrency Limit", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
            let runCount: number = 0;
            const task = pool.addPersistentBatchTask<undefined, undefined>({
                concurrencyLimit: 1,
                generator: (input) => {
                    runCount++;
                    return wait(3 * tick).then(() => new Array(input.length));
                },
                queuingDelay: tick,
                queuingThresholds: [1, Infinity],
            });
            const start: number = Date.now();
            return Promise.all([
                task.getResult(undefined).then(() => {
                    return task.getResult(undefined);
                }),
                wait(2 * tick).then(() => task.getResult(undefined)),
            ].map((promise) => promise.then(() => Date.now() - start))).then((results) => {
                expectTimes(results, [8, 8], "Timing Results");
                expect(runCount).to.equal(2, "runCount");
            });
        });
        describe("queueingThresholds", () => {
            it("Core Functionality", () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let runCount: number = 0;
                const task = pool.addPersistentBatchTask<undefined, undefined>({
                    generator: (input) => {
                        runCount++;
                        return wait(5 * tick).then(() => new Array(input.length));
                    },
                    queuingThresholds: [1, 2],
                });
                const delays = [0, 1, 2, 3, 4];
                const start: number = Date.now();
                return Promise.all(delays.map((delay) => {
                    return wait(delay * tick)
                        .then(() => task.getResult(undefined))
                        .then(() => Date.now() - start);
                })).then((results) => {
                    expectTimes(results, [5, 7, 7, 9, 9], "Timing Results");
                    expect(runCount).to.equal(3, "runCount");
                });
            });
            it("Should Trigger On Task Completion", () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<undefined, undefined>({
                    generator: (input) => {
                        return wait(2 * tick).then(() => new Array(input.length));
                    },
                    queuingThresholds: [1, 2],
                });
                const delays = [0, 1];
                const start: number = Date.now();
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
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<string, undefined>({
                    generator: (input) => {
                        return wait(tick).then(() => input.map((value) => {
                            return value === "error" ? new Error("test") : undefined;
                        }));
                    },
                });

                const inputs = ["a", "error", "b"];
                return Promise.all(inputs.map((input) => {
                    return task.getResult(input).then(() => true).catch((err: Error) => {
                        expect(err.message).to.equal("test");
                        return false;
                    });
                })).then((results) => {
                    expect(results).to.deep.equal([true, false, true]);
                });
            });
            it("Synchronous Generator Exception Followed By Success", () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<number, undefined>({
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
                    return task.getResult(input).then(() => true).catch((err: Error) => {
                        expect(err.message).to.equal("test");
                        return false;
                    });
                })).then((results) => {
                    expect(results).to.deep.equal([false, false, true]);
                });
            });
            it("Asynchronous Generator Exception Followed By Success", () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<number, undefined>({
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
                    return task.getResult(input).then(() => true).catch((err: Error) => {
                        expect(err.message).to.equal("test");
                        return false;
                    });
                })).then((results) => {
                    expect(results).to.deep.equal([false, false, true]);
                });
            });
            it("Invalid Output Length", () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<number, undefined>({
                    generator: (input) => {
                        // Respond with an array larger than the input
                        return wait(1).then(() => new Array(input.length + 1));
                    },
                });

                const inputs = [0, 1, 2];
                return Promise.all(inputs.map((input) => {
                    return task.getResult(input).then(() => true).catch(() => false);
                })).then((results) => {
                    expect(results).to.deep.equal([false, false, false]);
                });
            });
            it("End Task", () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<undefined, undefined>({
                    generator: () => {
                        return wait(tick).then(() => []);
                    },
                });
                const firstPromise = task.getResult(undefined);
                task.end();
                expect(task.state === Pool.TaskState.Terminated, "State should be terminated");

                return Promise.all([firstPromise, task.getResult(undefined)].map((promise) => {
                    return expect(promise).to.be.rejectedWith(Error);
                }));
            });
        });
    });
});
