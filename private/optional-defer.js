"use strict";
var __importDefault =
	(this && this.__importDefault) ||
	function (mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OptionalDeferredPromise = void 0;
const p_defer_1 = __importDefault(require("p-defer"));
class OptionalDeferredPromise {
	constructor() {
		this.results = [];
	}
	promise() {
		if (!this.deferred) {
			this.deferred = (0, p_defer_1.default)();
			if (this.results.length) {
				this.settled = true;
				this.deferred.resolve(this.results[0]);
				Promise.all(this.results).catch(() => {});
				this.results.length = 0;
			}
		}
		return this.deferred.promise;
	}
	resolve(value) {
		if (!this.deferred) {
			this.results.push(value);
		} else if (!this.settled) {
			this.settled = true;
			this.deferred.resolve(value);
		} else {
			Promise.resolve(value).catch(() => {});
		}
	}
}
exports.OptionalDeferredPromise = OptionalDeferredPromise;
