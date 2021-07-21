import chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import Debug from "debug";
import timeSpan from "time-span";
import * as Pool from "../index";

const debug = Debug("promise-pool-executor:test");
chai.use(chaiAsPromised);

// Verify that the types needed can be imported
const typingImportTest:
    | Pool.PromisePoolExecutor
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
    | Pool.PersistentBatchTaskOptions<any, any>
    | Pool.BatchingResult<any> = undefined as any;

if (typingImportTest) {
    // satisfy TypeScript's need to use the variable
}

/**
 * Milliseconds per tick.
 */
const tick: number = 90;
/**
 * Milliseconds tolerance for tests above the target.
 */
const tolerance: number = 80;

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
            targetTicks[i] * tick - 1,
            targetTicks[i] * tick + tolerance,
            message + " (" + i + ")",
        );
    });
}

function waitForUnhandledRejection(delay: number): Promise<void> {
    process.removeListener("unhandledRejection", unhandledRejectionListener);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            // istanbul ignore next
            () => {
                resetUnhandledRejectionListener();
                resolve();
            },
            delay,
        );

        process.prependOnceListener("unhandledRejection", (err) => {
            clearTimeout(timeout);
            debug("Caught unhandledRejection");
            resetUnhandledRejectionListener();
            reject(err);
        });
    });
}

function expectHandledRejection(delay: number = tick * 2): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            // istanbul ignore next
            () => {
                resetHandledRejectionListener();
                reject(new Error("Rejection Not Handled"));
            },
            delay,
        );

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
async function expectUnhandledRejection(expectedError: any, delay: number = tick * 2): Promise<void> {
    await expect(waitForUnhandledRejection(delay)).to.be.rejectedWith(expectedError);
}

/**
 * Returns the sum of an array of numbers.
 */
function sum(nums: number[]): number {
    return nums.reduce((a, b) => a + b, 0);
}

// istanbul ignore next
function unhandledRejectionListener(err: any) {
    debug("unhandledRejectionListener: %O", err);
    // Fail the test
    throw err;
}

// istanbul ignore next
function rejectionHandledListener() {
    debug("Unexpected rejectionHandled event");
    // Fail the test
    throw new Error("Unexpected rejectionHandled event");
}

function resetUnhandledRejectionListener(): void {
    process.removeAllListeners("unhandledRejection");
    process.addListener("unhandledRejection", unhandledRejectionListener);
}

function resetHandledRejectionListener(): void {
    process.removeAllListeners("rejectionHandled");
    process.addListener("rejectionHandled", rejectionHandledListener);
}

beforeEach(() => {
    resetUnhandledRejectionListener();
    resetHandledRejectionListener();
});

describe("Concurrency", () => {
    it("No Limit", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const end = timeSpan();
        const results = await pool
            .addGenericTask({
                generator: async () => {
                    await wait(tick);
                    return end();
                },
                invocationLimit: 3,
            })
            .promise();
        expectTimes(results, [1, 1, 1], "Timing Results");
    });

    it("Global Limit", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor(2);

        const end = timeSpan();
        const results = await pool
            .addGenericTask({
                generator: async () => {
                    await wait(tick);
                    return end();
                },
                invocationLimit: 3,
            })
            .promise();
        expectTimes(results, [1, 1, 2], "Timing Results");
    });

    it("Task Limit", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const end = timeSpan();
        const results = await pool
            .addGenericTask({
                concurrencyLimit: 2,
                generator: async () => {
                    await wait(tick);
                    return end();
                },
                invocationLimit: 3,
            })
            .promise();
        expectTimes(results, [1, 1, 2], "Timing Results");
    });

    it("Group Limit", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        const group: Pool.PromisePoolGroup = pool.addGroup({
            concurrencyLimit: 2,
        });

        const end = timeSpan();
        const results = await pool
            .addGenericTask({
                generator: async () => {
                    await wait(tick);
                    return end();
                },
                groups: [group],
                invocationLimit: 3,
            })
            .promise();
        expectTimes(results, [1, 1, 2], "Timing Results");
    });
});

describe("Frequency", () => {
    describe("Global Limit", () => {
        it("Steady Work", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor({
                frequencyLimit: 2,
                frequencyWindow: tick,
            });

            const end = timeSpan();
            const results = await pool
                .addGenericTask({
                    generator: () => {
                        return Promise.resolve(end());
                    },
                    invocationLimit: 3,
                })
                .promise();
            expectTimes(results, [0, 0, 1], "Timing Results");
        });

        it("Offset Calls", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor({
                concurrencyLimit: 1,
                frequencyLimit: 2,
                frequencyWindow: tick * 3,
            });

            const end = timeSpan();
            const results = await pool
                .addGenericTask({
                    generator: async () => {
                        await wait(tick);
                        return end();
                    },
                    invocationLimit: 4,
                })
                .promise();
            expectTimes(results, [1, 2, 4, 5], "Timing Results");
        });

        it("Work Gap", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor({
                frequencyLimit: 2,
                frequencyWindow: tick,
            });

            const end = timeSpan();
            const results = await pool
                .addGenericTask({
                    generator: () => {
                        return Promise.resolve(end());
                    },
                    invocationLimit: 3,
                })
                .promise();
            debug(results);
            expectTimes(results, [0, 0, 1], "Timing Results 1");
            await wait(tick * 2);
            const results2 = await pool
                .addGenericTask({
                    generator: () => {
                        return Promise.resolve(end());
                    },
                    invocationLimit: 3,
                })
                .promise();
            debug(results2);
            expectTimes(results2, [3, 3, 4], "Timing Results 2");
        });
    });

    it("Group Limit", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        const group: Pool.PromisePoolGroup = pool.addGroup({
            frequencyLimit: 2,
            frequencyWindow: tick,
        });

        const end = timeSpan();
        const results = await pool
            .addGenericTask({
                generator: () => {
                    return Promise.resolve(end());
                },
                groups: [group],
                invocationLimit: 3,
            })
            .promise();
        expectTimes(results, [0, 0, 1], "Timing Results");
        expect((group as any)._frequencyStarts).to.have.length.of.at.least(1);
    });

    it("Should Not Collect Timestamps If Not Set", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        await pool
            .addGenericTask({
                generator: () => Promise.resolve(),
                invocationLimit: 1,
            })
            .promise();
        expect((pool as any)._globalGroup._frequencyStarts).to.have.lengthOf(0);
    });
});

describe("Exception Handling", () => {
    it("Generator Function (synchronous)", () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const error: Error = new Error();
        return expect(
            pool
                .addGenericTask({
                    generator: () => {
                        throw error;
                    },
                })
                .promise(),
        ).to.be.rejectedWith(error);
    });

    it("Promise Rejection", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const error: Error = new Error();
        await expect(
            pool
                .addGenericTask({
                    generator: async () => {
                        await wait(1);
                        throw error;
                    },
                    invocationLimit: 1,
                })
                .promise(),
        ).to.be.rejectedWith(error);
    });

    it("Multi-rejection", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const errors: Error[] = [new Error("First"), new Error("Second")];
        await expect(
            pool
                .addGenericTask({
                    generator: async (i) => {
                        await wait(i ? tick : 1);
                        throw errors[i];
                    },
                    invocationLimit: 2,
                })
                .promise(),
        ).to.be.rejectedWith(errors[0]);
        // Wait to ensure that the second rejection happens within the scope of this test without issue
        await wait(tick * 2);
    });

    describe("Invalid Configuration", () => {
        it("Invalid concurrencyLimit", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            expect(() =>
                pool.addGenericTask({
                    concurrencyLimit: 0, // invalid
                    generator: undefined as any,
                }),
            ).to.throw(Error, /^Invalid concurrency limit: 0$/);
        });

        it("Invalid frequencyLimit", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            expect(() =>
                pool.addGenericTask({
                    frequencyLimit: 0, // invalid
                    generator: undefined as any,
                }),
            ).to.throw(Error, /^Invalid frequency limit: 0$/);
        });

        it("Invalid frequencyWindow", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            expect(() =>
                pool.addGenericTask({
                    frequencyWindow: 0, // invalid
                    generator: undefined as any,
                }),
            ).to.throw(Error, /^Invalid frequency window: 0$/);
        });

        it("Group From Another Pool", () => {
            const pool1: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
            const pool2: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            expect(() =>
                pool1.addGenericTask({
                    generator: undefined as any,
                    groups: [
                        pool2.addGroup({
                            concurrencyLimit: 1,
                        }),
                    ],
                }),
            ).to.throw(Error, /^options\.groups contains a group belonging to a different pool$/);
        });
    });

    describe("Unhandled Rejection", () => {
        it("Generator Function (synchronous)", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
            });
            await expectUnhandledRejection(error);
        });

        it("Promise Rejection", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
            pool.addGenericTask({
                generator: async () => {
                    await wait(1);
                    throw error;
                },
                invocationLimit: 1,
            });
            await expectUnhandledRejection(error);
        });

        it("Late Rejection Handling", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
            const task = pool.addGenericTask({
                generator: async () => {
                    await wait(1);
                    throw error;
                },
                invocationLimit: 1,
            });
            await expectUnhandledRejection(error);
            await Promise.all([expectHandledRejection(), expect(task.promise()).to.be.rejectedWith(error)]);
        });

        it("Multi-rejection", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const errors = [new Error("first"), new Error("second")];
            errors.forEach((err, i) => {
                // Create a task which fails without the test handling the error
                pool.addGenericTask({
                    generator: async () => {
                        await wait(i ? tick : 1);
                        throw err;
                    },
                    invocationLimit: 1,
                });
            });
            await expectUnhandledRejection(errors[0]);
            await expectUnhandledRejection(errors[1]);
        });

        // This scenario creates two tasks at the same time
        // The first task rejects but is handled, while the second remains unhandled.
        it("Handled Rejection Followed By Unhandled Rejection", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const errors = [new Error("first"), new Error("second")];
            // Create a task which will reject later without being handled
            pool.addGenericTask({
                generator: async () => {
                    await wait(tick);
                    throw errors[1];
                },
                invocationLimit: 1,
            });

            await expect(
                pool
                    .addGenericTask({
                        generator: async () => {
                            await wait(1);
                            throw errors[0];
                        },
                        invocationLimit: 1,
                    })
                    .promise(),
            ).to.be.rejectedWith(errors[0]);
            await expectUnhandledRejection(errors[1]);
        });

        it("Unhandled Followed By Rejection With pool.waitForIdle", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

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
            await expectUnhandledRejection(errors[0]);
            pool.addGenericTask({
                generator: () => {
                    throw errors[1];
                },
                invocationLimit: 1,
            });
            await Promise.all([expectHandledRejection(), expect(pool.waitForIdle()).to.be.rejectedWith(errors[0])]);
            // Wait to ensure the task does not throw an unhandled rejection
            await wait(tick);
        });
    });

    describe("pool.waitForIdle", () => {
        it("Generator Function (synchronous)", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                invocationLimit: 1,
            });
            await expect(pool.waitForIdle()).to.be.rejectedWith(error);
        });

        it("Promise Rejection", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
            pool.addGenericTask({
                generator: async () => {
                    await wait(1);
                    throw error;
                },
                invocationLimit: 1,
            });
            await expect(pool.waitForIdle()).to.be.rejectedWith(error);
        });

        // In this scenario, a child task fails after its parent does. In this case, only the first error should
        // be received, and the second should be handled by the pool.
        it("Child Task Rejection Shadowed By Parent Rejection", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error = new Error("Parent error");
            let thrown = false;
            const end = timeSpan();
            pool.addGenericTask({
                generator: async () => {
                    await wait(tick);
                    pool.addGenericTask({
                        generator: async () => {
                            await wait(tick);
                            thrown = true;
                            throw new Error("Child task error");
                        },
                        invocationLimit: 1,
                    });
                    debug("About to throw");
                    throw error;
                },
                invocationLimit: 1,
            });
            await expect(pool.waitForIdle()).to.be.rejectedWith(error);
            expectTimes([end()], [1], "Timing Results");
            expect(thrown).to.equal(false, "Child task must throw yet");
            await wait(tick * 2);
            expect(thrown).to.equal(true, "Child task must throw error");
        });

        describe("Clearing After Delay", () => {
            it("Promise Rejection", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const error: Error = new Error();
                await Promise.all([
                    expect(
                        pool
                            .addGenericTask({
                                generator: async () => {
                                    await wait(1);
                                    throw error;
                                },
                                invocationLimit: 1,
                            })
                            .promise(),
                    ).to.be.rejectedWith(error),
                    (async () => {
                        await wait(tick);
                        try {
                            await pool.waitForIdle();
                        } catch (err) {
                            // istanbul ignore next
                            throw new Error("Error did not clear");
                        }
                    })(),
                ]);
            });
        });
    });

    describe("group.waitForIdle", () => {
        it("Generator Function (synchronous)", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
            const group: Pool.PromisePoolGroup = pool.addGroup({});
            pool.addGenericTask({
                generator: () => {
                    throw error;
                },
                groups: [group],
                invocationLimit: 1,
            });
            await expect(group.waitForIdle()).to.be.rejectedWith(error);
        });

        it("Promise Rejection", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const error: Error = new Error();
            const group: Pool.PromisePoolGroup = pool.addGroup({});
            pool.addGenericTask({
                generator: async () => {
                    await wait(1);
                    throw error;
                },
                groups: [group],
                invocationLimit: 1,
            });
            await expect(group.waitForIdle()).to.be.rejectedWith(error);
        });
    });
});

describe("Miscellaneous Features", () => {
    describe("End Task", () => {
        it("From Generator With No Promise", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const results = await pool
                .addGenericTask({
                    generator() {
                        this.end();
                    },
                })
                .promise();
            expect(results).to.have.lengthOf(0);
        });

        it("From Generator With Promise", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const results = await pool
                .addGenericTask({
                    generator() {
                        this.end();
                        // Add one final promise after ending the task
                        return Promise.resolve(1);
                    },
                })
                .promise();
            expect(results).to.deep.equal([1]);
        });
    });

    it("Generator Recursion Prevention", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
        let runCount: number = 0;

        await pool
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
        expect(runCount).to.equal(1, "runCount");
    });

    it("Pause/Resume Task", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const end = timeSpan();
        const task = pool.addGenericTask({
            async generator(index) {
                if (index === 0) {
                    this.pause();
                }
                await wait(tick);
                return end();
            },
            invocationLimit: 3,
        });
        wait(tick).then(() => {
            task.resume();
        });
        const results = await task.promise();
        // The task must return the expected non-array result
        expectTimes(results, [1, 2, 2], "Timing Results");
    });

    it("Get Pool Status", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor({
            concurrencyLimit: 5,
            frequencyLimit: 5,
            frequencyWindow: 1000,
        });

        const task = pool.addGenericTask({
            async generator() {
                await wait(tick);
            },
            invocationLimit: 1,
        });
        pool.addGenericTask({
            async generator() {
                await wait(tick);
            },
            invocationLimit: 2,
        });

        expect({
            concurrencyLimit: pool.concurrencyLimit,
            frequencyLimit: pool.frequencyLimit,
            frequencyWindow: pool.frequencyWindow,
            freeSlots: pool.freeSlots,
            activePromiseCount: pool.activePromiseCount,
            activeTaskCount: pool.activeTaskCount,
        }).to.deep.equal({
            concurrencyLimit: 5,
            frequencyLimit: 5,
            frequencyWindow: 1000,
            freeSlots: 2,
            activePromiseCount: 3,
            activeTaskCount: 2,
        });

        await task.promise();
        expect({
            freeSlots: pool.freeSlots,
            activePromiseCount: pool.activePromiseCount,
            activeTaskCount: pool.activeTaskCount,
        }).to.deep.equal({
            freeSlots: 3,
            activePromiseCount: 2,
            activeTaskCount: 1,
        });

        await pool.waitForIdle();
    });

    it("Get Task Status", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const status = await pool
            .addGenericTask({
                concurrencyLimit: 5,
                frequencyLimit: 5,
                frequencyWindow: 1000,
                async generator() {
                    await wait(tick);
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
                },
                invocationLimit: 1,
            })
            .promise();
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

    describe("waitForIdle", () => {
        it("Simple", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const end = timeSpan();
            pool.addGenericTask({
                generator: async () => {
                    await wait(tick);
                },
                invocationLimit: 1,
            });
            await pool.waitForIdle();
            expectTimes([end()], [1], "Timing Results");
        });

        it("Set concurrencyLimit", () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor(1);

            expect(pool.concurrencyLimit).to.equal(1);
            pool.concurrencyLimit = 2;
            expect(pool.concurrencyLimit).to.equal(2);
        });

        it("Child Task", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const end = timeSpan();
            pool.addGenericTask({
                generator: async () => {
                    await wait(tick);
                    pool.addGenericTask({
                        generator: async () => {
                            await wait(tick);
                        },
                        invocationLimit: 1,
                    });
                },
                invocationLimit: 1,
            });
            await pool.waitForIdle();
            expectTimes([end()], [2], "Timing Results");
        });

        it("No Task", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            await pool.waitForIdle();
        });
    });

    describe("waitForGroupIdle", () => {
        it("Simple", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const end = timeSpan();
            const group = pool.addGroup({});
            pool.addGenericTask({
                generator: async () => {
                    await wait(tick);
                },
                groups: [group],
                invocationLimit: 1,
            });
            await group.waitForIdle();
            expectTimes([end()], [1], "Timing Results");
        });

        it("Child Task", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const end = timeSpan();
            const group = pool.addGroup({});
            pool.addGenericTask({
                generator: async () => {
                    await wait(tick);
                    pool.addGenericTask({
                        generator: async () => {
                            await wait(tick);
                        },
                        groups: [group],
                        invocationLimit: 1,
                    });
                },
                groups: [group],
                invocationLimit: 1,
            });
            await group.waitForIdle();
            expectTimes([end()], [2], "Timing Results");
        });
    });

    describe("Configure Task", () => {
        it("Invocation Limit Triggers Completion", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const end = timeSpan();
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
            const results = await task.promise();
            expectTimes([...results, end()], [0, 1], "Timing Results");
        });
    });

    describe("Configure Group", () => {
        it("Triggers Promises", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const end = timeSpan();
            const group = pool.addGroup({
                frequencyLimit: 1,
                frequencyWindow: tick * 2,
            });
            wait(tick).then(() => {
                group.frequencyWindow = 1;
                group.frequencyLimit = 1;
            });
            const results = await pool
                .addGenericTask({
                    generator: () => {
                        return Promise.resolve(end());
                    },
                    groups: [group],
                    invocationLimit: 2,
                })
                .promise();
            expectTimes(results, [0, 1], "Timing Results");
        });
    });
});

describe("Task Secializations", () => {
    it("Single Task", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const end = timeSpan();
        let iteration: number = 0;
        const result = await pool
            .addSingleTask({
                data: "test",
                generator: async (data) => {
                    expect(data).to.equal("test");
                    // The task cannot run more than once
                    expect(iteration++).to.equal(0);
                    await wait(tick);
                    return end();
                },
            })
            .promise();
        debug(`Test result: ${result} (${typeof result})`);
        // The task must return the expected non-array result
        expectTimes([result], [1], "Timing Results");
    });

    it("Linear Task", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const end = timeSpan();
        const results = await pool
            .addLinearTask({
                generator: async () => {
                    await wait(tick);
                    return end();
                },
                invocationLimit: 3,
            })
            .promise();
        expectTimes(results, [1, 2, 3], "Timing Results");
    });

    it("Each Task", async () => {
        const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

        const end = timeSpan();
        const results = await pool
            .addEachTask({
                concurrencyLimit: Infinity,
                data: [3, 2, 1],
                generator: async (element) => {
                    await wait(tick * element);
                    return end();
                },
            })
            .promise();
        expectTimes(results, [3, 2, 1], "Timing Results");
    });

    describe("Batch Task", () => {
        it("Static Batch Size", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const end = timeSpan();
            const results = await pool
                .addBatchTask({
                    // Groups the data as [[3, 1], [2]]
                    batchSize: 2,
                    data: [3, 1, 2],
                    generator: async (data) => {
                        await wait(tick * sum(data));
                        return end();
                    },
                })
                .promise();
            expectTimes(results, [4, 2], "Timing Results");
        });

        it("Dynamic Batch Size", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();

            const end = timeSpan();
            const results = await pool
                .addBatchTask({
                    batchSize: (elements, freeSlots) => {
                        // Groups the data as [[2], [1, 3]]
                        return Math.floor(elements / freeSlots);
                    },
                    concurrencyLimit: 2,
                    data: [2, 1, 3],
                    generator: async (data) => {
                        await wait(tick * sum(data));
                        return end();
                    },
                })
                .promise();
            expectTimes(results, [2, 4], "Timing Results");
        });
    });

    describe("Persistent Batch Task", () => {
        it("Core Functionality", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
            let runCount: number = 0;
            const task = pool.addPersistentBatchTask<number, string>({
                generator: async (input) => {
                    runCount++;
                    await wait(tick);
                    return input.map(String);
                },
            });
            const inputs = [1, 5, 9];
            const end = timeSpan();
            await Promise.all(
                inputs.map(async (input) => {
                    const output = await task.getResult(input);
                    expect(output).to.equal(String(input), "Outputs");
                    expectTimes([end()], [1], "Timing Results");
                }),
            );
            expect(runCount).to.equal(1, "runCount");
            // Verify that the task is not storing the results, which would waste memory.
            expect((task as any)._task._result.length).to.equal(0);
        });
        it("Offset Batches", async () => {
            // Runs two batches of requests, offset so the second starts while the first is half finished.
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
            const end = timeSpan();
            let runCount: number = 0;
            const task = pool.addPersistentBatchTask<number, string>({
                generator: async (input) => {
                    runCount++;
                    await wait(tick * 2);
                    return input.map(String);
                },
                queuingDelay: tick,
            });
            const results = await Promise.all(
                [
                    [1, 9],
                    [5, 7],
                ].map(async (input, index) => {
                    await wait(2 * index * tick);
                    return Promise.all(
                        input.map(async (value) => {
                            const result = await task.getResult(value);
                            expect(result).to.equal(String(value));
                            return end();
                        }),
                    );
                }),
            );
            expectTimes(([] as number[]).concat(...results), [3, 3, 5, 5], "Timing Results");
            expect(runCount).to.equal(2, "runCount");
        });
        describe("maxBatchSize", async () => {
            it("Core Functionality", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let runCount: number = 0;
                const task = pool.addPersistentBatchTask<number, string>({
                    generator: async (input) => {
                        runCount++;
                        await wait(tick);
                        return input.map(String);
                    },
                    maxBatchSize: 2,
                    queuingDelay: tick,
                });
                const end = timeSpan();
                const results = await Promise.all(
                    [1, 5, 9].map(async (input) => {
                        const output = await task.getResult(input);
                        expect(output).to.equal(String(input), "Outputs");
                        return end();
                    }),
                );
                expectTimes(results, [1, 1, 2], "Timing Results");
                expect(runCount).to.equal(2, "runCount");
            });
            it("Instant Start", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let runCount: number = 0;
                const task = pool.addPersistentBatchTask<undefined, undefined>({
                    generator: async (input) => {
                        runCount++;
                        await wait(tick);
                        return input;
                    },
                    maxBatchSize: 2,
                });

                await Promise.all(
                    [0, 1, 1].map(async (expectedRunCount) => {
                        // The generator should be triggered instantly when the max batch size is reached
                        const promise = task.getResult(undefined);
                        expect(runCount).to.equal(expectedRunCount);
                        await promise;
                    }),
                );
            });
        });
        it("queuingDelay", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
            let runCount: number = 0;
            const task = pool.addPersistentBatchTask<undefined, undefined>({
                generator: async (input) => {
                    runCount++;
                    return new Array(input.length);
                },
                queuingDelay: tick * 2,
            });
            const end = timeSpan();
            const results = await Promise.all(
                [0, 1, 3].map(async (delay) => {
                    await wait(delay * tick);
                    await task.getResult(undefined);
                    return end();
                }),
            );
            expectTimes(results, [2, 2, 5], "Timing Results");
            expect(runCount).to.equal(2, "runCount");
        });
        it("Delay After Hitting Concurrency Limit", async () => {
            const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
            let runCount: number = 0;
            const task = pool.addPersistentBatchTask<undefined, undefined>({
                concurrencyLimit: 1,
                generator: async (input) => {
                    runCount++;
                    await wait(3 * tick);
                    return new Array(input.length);
                },
                queuingDelay: tick,
                queuingThresholds: [1, Infinity],
            });
            const end = timeSpan();
            const results = await Promise.all([
                (async () => {
                    await task.getResult(undefined);
                    await task.getResult(undefined);
                    return end();
                })(),
                (async () => {
                    await wait(2 * tick);
                    await task.getResult(undefined);
                    return end();
                })(),
            ]);
            expectTimes(results, [8, 8], "Timing Results");
            expect(runCount).to.equal(2, "runCount");
        });
        describe("queueingThresholds", () => {
            it("Core Functionality", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let runCount: number = 0;
                const task = pool.addPersistentBatchTask<undefined, undefined>({
                    generator: async (input) => {
                        runCount++;
                        await wait(7 * tick);
                        return new Array(input.length);
                    },
                    queuingThresholds: [1, 2],
                    queuingDelay: tick,
                });
                const end = timeSpan();
                const results = await Promise.all(
                    [0, 2, 3, 5, 6].map(async (delay) => {
                        await wait(delay * tick);
                        await task.getResult(undefined);
                        return end();
                    }),
                );
                expectTimes(results, [8, 11, 11, 14, 14], "Timing Results");
                expect(runCount).to.equal(3, "runCount");
            });
            it("Should Trigger On Task Completion", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<undefined, undefined>({
                    generator: async (input) => {
                        await wait(2 * tick);
                        return new Array(input.length);
                    },
                    queuingThresholds: [1, Infinity],
                    queuingDelay: tick,
                });
                const end = timeSpan();
                const results = await Promise.all(
                    [0, 2].map(async (delay) => {
                        await wait(delay * tick);
                        await task.getResult(undefined);
                        return end();
                    }),
                );
                expectTimes(results, [3, 6], "Timing Results");
            });
        });
        describe("Retries", () => {
            it("Full", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const batcher = pool.addPersistentBatchTask<number, number>({
                    generator: async (inputs) => {
                        runCount++;
                        await wait(tick);
                        if (runCount < 2) {
                            return inputs.map(() => Pool.BATCHER_RETRY_TOKEN);
                        }
                        return inputs.map((input) => input + 1);
                    },
                    queuingDelay: tick,
                });
                const end = timeSpan();
                const results = await Promise.all(
                    [1, 2].map(async (input) => {
                        const output = await batcher.getResult(input);
                        expect(output).to.equal(input + 1, "getResult output");
                        return end();
                    }),
                );
                expectTimes(results, [4, 4], "Timing Results");
                expect(runCount).to.equal(2, "runCount");
            });
            it("Partial", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const batcher = pool.addPersistentBatchTask<number, number>({
                    generator: async (inputs) => {
                        runCount++;
                        await wait(tick);
                        return inputs.map((input, index) => {
                            return runCount < 2 && index < 1 ? Pool.BATCHER_RETRY_TOKEN : input + 1;
                        });
                    },
                    queuingDelay: tick,
                });
                const end = timeSpan();
                const results = await Promise.all(
                    [1, 2].map(async (input) => {
                        const output = await batcher.getResult(input);
                        expect(output).to.equal(input + 1, "getResult output");
                        return end();
                    }),
                );
                expectTimes(results, [4, 2], "Timing Results");
                expect(runCount).to.equal(2, "runCount");
            });
            it("Ordering", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const batchInputs: number[][] = [];
                const batcher = pool.addPersistentBatchTask<number, number>({
                    generator: async (inputs) => {
                        batchInputs.push(inputs.slice());
                        await wait(tick);
                        return inputs.map((input, index) => {
                            return batchInputs.length < 2 && index < 2 ? Pool.BATCHER_RETRY_TOKEN : input + 1;
                        });
                    },
                    maxBatchSize: 3,
                    queuingThresholds: [1, Infinity],
                });
                const end = timeSpan();
                const results = await Promise.all(
                    [1, 2, 3, 4].map(async (input) => {
                        const output = await batcher.getResult(input);
                        expect(output).to.equal(input + 1, "getResult output");
                        return end();
                    }),
                );
                expectTimes(results, [2, 2, 1, 2], "Timing Results");
                expect(batchInputs).to.deep.equal(
                    [
                        [1, 2, 3],
                        [1, 2, 4],
                    ],
                    "batchInputs",
                );
            });
        });
        describe("Send Method", () => {
            it("Single Use", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const batcher = pool.addPersistentBatchTask<undefined, undefined>({
                    generator: async (inputs) => {
                        runCount++;
                        await wait(tick);
                        return inputs;
                    },
                    queuingDelay: tick,
                    queuingThresholds: [1, Infinity],
                });
                const end = timeSpan();
                const results = await Promise.all(
                    [1, 2, 3].map(async (_, index) => {
                        const promise = batcher.getResult(undefined);
                        if (index === 1) {
                            expect(runCount).to.equal(0, "runCount before");
                            batcher.send();
                            expect(runCount).to.equal(1, "runCount after");
                        }
                        await promise;
                        return end();
                    }),
                );
                expectTimes(results, [1, 1, 3], "Timing Results");
            });
            it("Effect Delayed By queuingThreshold", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const batcher = pool.addPersistentBatchTask<undefined, undefined>({
                    generator: async (inputs) => {
                        runCount++;
                        await wait(tick);
                        return inputs;
                    },
                    queuingDelay: tick,
                    queuingThresholds: [1, Infinity],
                });
                const end = timeSpan();
                const results = await Promise.all(
                    [1, 2, 3].map(async (_, index) => {
                        const promise = batcher.getResult(undefined);
                        if (index === 1) {
                            expect(runCount).to.equal(0, "runCount before");
                            batcher.send();
                            expect(runCount).to.equal(1, "runCount after");
                        } else if (index === 2) {
                            batcher.send();
                            expect(runCount).to.equal(1, "runCount after second");
                        }
                        await promise;
                        return end();
                    }),
                );
                expectTimes(results, [1, 1, 2], "Timing Results");
            });
            it("Interaction With Retries", async () => {
                // This tests that the effect of the send method lasts even after a retry
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                let runCount = 0;
                const batcher = pool.addPersistentBatchTask<undefined, undefined>({
                    generator: async (inputs) => {
                        runCount++;
                        await wait(tick);
                        return runCount === 1 ? inputs.map(() => Pool.BATCHER_RETRY_TOKEN) : inputs;
                    },
                    queuingDelay: tick,
                    queuingThresholds: [1, Infinity],
                });
                const end = timeSpan();
                const results = await Promise.all(
                    [1, 2, 3].map(async (_, index) => {
                        const promise = batcher.getResult(undefined);
                        if (index >= 1) {
                            batcher.send();
                        }
                        await promise;
                        return end();
                    }),
                );
                expect(runCount).to.equal(2, "runCount");
                expectTimes(results, [2, 2, 2], "Timing Results");
            });
        });
        describe("Error Handling", () => {
            it("Single Rejection", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<string, undefined>({
                    generator: async (input) => {
                        await wait(tick);
                        return input.map((value) => {
                            return value === "error" ? new Error("test") : undefined;
                        });
                    },
                });

                const results = await Promise.all(
                    ["a", "error", "b"].map(async (input) => {
                        try {
                            await task.getResult(input);
                            return true;
                        } catch (err) {
                            expect(err.message).to.equal("test");
                            return false;
                        }
                    }),
                );
                expect(results).to.deep.equal([true, false, true]);
            });
            it("Synchronous Generator Exception Followed By Success", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<number, undefined>({
                    generator: async (input) => {
                        input.forEach((value) => {
                            if (value === 0) {
                                throw new Error("test");
                            }
                        });
                        await wait(1);
                        return new Array(input.length);
                    },
                    maxBatchSize: 2,
                });

                await Promise.all(
                    [0, 1].map(async (input) => {
                        await expect(task.getResult(input)).to.be.rejectedWith(Error, /^test$/);
                    }),
                );
                await task.getResult(2);
            });
            it("Asynchronous Generator Exception Followed By Success", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<number, undefined>({
                    generator: async (input) => {
                        await wait(1);
                        input.forEach((value) => {
                            if (value === 0) {
                                throw new Error("test");
                            }
                        });
                        return new Array(input.length);
                    },
                    maxBatchSize: 2,
                });

                await Promise.all(
                    [0, 1].map(async (input) => {
                        await expect(task.getResult(input)).to.be.rejectedWith(Error, /^test$/);
                    }),
                );
                await task.getResult(1);
            });
            it("Invalid Output Length", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<number, undefined>({
                    generator: async (input) => {
                        // Respond with an array larger than the input
                        await wait(1);
                        return new Array(input.length + 1);
                    },
                });

                await Promise.all(
                    [0, 1, 2].map(async (input) => {
                        expect(task.getResult(input)).to.be.rejectedWith(
                            Error,
                            /^batchingFunction output length does not equal the input length$/,
                        );
                    }),
                );
            });
            it("End Task", async () => {
                const pool: Pool.PromisePoolExecutor = new Pool.PromisePoolExecutor();
                const task = pool.addPersistentBatchTask<undefined, undefined>({
                    generator: undefined as any,
                });
                const firstPromise = task.getResult(undefined);
                task.end();
                expect(task.state === Pool.TaskState.Terminated, "State should be terminated");

                await Promise.all(
                    [firstPromise, task.getResult(undefined)].map((promise) => {
                        return expect(promise).to.be.rejectedWith(
                            Error,
                            /^This task has ended and cannot process more items$/,
                        );
                    }),
                );
            });
        });
    });
});
