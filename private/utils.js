"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Debug = require("debug");
exports.debug = Debug("promise-pool-executor");
function isNull(val) {
    return val === undefined || val === null;
}
exports.isNull = isNull;
