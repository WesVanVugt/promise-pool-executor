"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug_1 = __importDefault(require("debug"));
exports.debug = debug_1.default("promise-pool-executor");
function isNull(val) {
    return val === undefined || val === null;
}
exports.isNull = isNull;
