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
        expect(val).to.be.within(b[i] * tick - tolerance, b[i] * tick + tolerance, message);
    });
}

describe("Concurrency Test", () => {
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