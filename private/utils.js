"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Debug = require("debug");
exports.debug = Debug("promise-pool-executor");
class ResolvablePromise {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}
exports.ResolvablePromise = ResolvablePromise;
function isNull(val) {
    return val === undefined || val === null;
}
exports.isNull = isNull;
