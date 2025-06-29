"use strict";
var __importDefault =
	(this && this.__importDefault) ||
	function (mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNull = exports.debug = void 0;
const util_1 = __importDefault(require("util"));
exports.debug = util_1.default.debuglog("promise-pool-executor");
const isNull = (val) => val === undefined || val === null;
exports.isNull = isNull;
