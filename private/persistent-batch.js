"use strict";
var __importDefault =
	(this && this.__importDefault) ||
	function (mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersistentBatchTaskPrivate = void 0;
const p_defer_1 = __importDefault(require("p-defer"));
const promise_batcher_1 = require("promise-batcher");
const task_1 = require("../public/task");
class PersistentBatchTaskPrivate {
	constructor(pool, options) {
		let immediate;
		let delayDeferred;
		let taskDeferred;
		this._generator = options.generator;
		this._batcher = new promise_batcher_1.Batcher({
			batchingFunction: (inputs) => {
				if (!taskDeferred) {
					throw new Error("Expected taskPromise to be set (internal error).");
				}
				const localTaskDeferred = taskDeferred;
				taskDeferred = undefined;
				return (async () => {
					try {
						return await this._generator(inputs);
					} finally {
						localTaskDeferred.resolve();
					}
				})();
			},
			delayFunction: () => {
				if (delayDeferred) {
					throw new Error("Expected delayDeferred not to be set (internal error).");
				}
				if (this._task.state >= task_1.TaskState.Exhausted) {
					throw new Error("This task has ended and cannot process more items");
				}
				immediate = false;
				this._task.resume();
				if (immediate) {
					if (immediate !== true) {
						throw immediate;
					}
					return;
				}
				delayDeferred = (0, p_defer_1.default)();
				return delayDeferred.promise;
			},
			maxBatchSize: options.maxBatchSize,
			queuingDelay: options.queuingDelay,
			queuingThresholds: options.queuingThresholds,
		});
		this._task = pool.addGenericTask({
			concurrencyLimit: options.concurrencyLimit,
			frequencyLimit: options.frequencyLimit,
			frequencyWindow: options.frequencyWindow,
			generator: () => {
				this._task.pause();
				if (taskDeferred) {
					immediate = new Error("Expected taskDeferred not to be set (internal error).");
					return;
				}
				taskDeferred = (0, p_defer_1.default)();
				if (delayDeferred) {
					const localDelayDefered = delayDeferred;
					delayDeferred = undefined;
					localDelayDefered.resolve();
				} else {
					immediate = true;
				}
				return taskDeferred.promise;
			},
			paused: true,
		});
	}
	get activePromiseCount() {
		return this._task.activePromiseCount;
	}
	get concurrencyLimit() {
		return this._task.concurrencyLimit;
	}
	set concurrencyLimit(val) {
		this._task.concurrencyLimit = val;
	}
	get frequencyLimit() {
		return this._task.frequencyLimit;
	}
	set frequencyLimit(val) {
		this._task.frequencyLimit = val;
	}
	get frequencyWindow() {
		return this._task.frequencyWindow;
	}
	set frequencyWindow(val) {
		this._task.frequencyWindow = val;
	}
	get freeSlots() {
		return this._task.freeSlots;
	}
	get state() {
		return this._task.state;
	}
	getResult(input) {
		if (this._task.state >= task_1.TaskState.Exhausted) {
			return Promise.reject(new Error("This task has ended and cannot process more items"));
		}
		return this._batcher.getResult(input);
	}
	send() {
		this._batcher.send();
	}
	end() {
		this._task.end();
	}
}
exports.PersistentBatchTaskPrivate = PersistentBatchTaskPrivate;
