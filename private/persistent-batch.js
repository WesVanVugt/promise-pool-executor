"use strict";
var __importDefault =
	(this && this.__importDefault) ||
	function (mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersistentBatchTaskPrivate = void 0;
const strict_1 = __importDefault(require("assert/strict"));
const p_defer_1 = __importDefault(require("p-defer"));
const promise_batcher_1 = require("promise-batcher");
const task_1 = require("../public/task");
class PersistentBatchTaskPrivate {
	constructor(pool, options) {
		let synchronousResult = false;
		let waitForTask;
		let waitForBatcher;
		this._generator = options.generator;
		this._batcher = new promise_batcher_1.Batcher({
			batchingFunction: async (inputs) => {
				(0, strict_1.default)(waitForBatcher, "Expected taskPromise to be set");
				const localWaitForBatcher = waitForBatcher;
				waitForBatcher = undefined;
				try {
					return await this._generator(inputs);
				} finally {
					localWaitForBatcher.resolve();
				}
			},
			delayFunction: () => {
				(0, strict_1.default)(!waitForTask, "Expected waitForTask not to be set");
				if (this._task.state >= task_1.TaskState.Exhausted) {
					throw new Error("This task has ended and cannot process more items");
				}
				synchronousResult = false;
				this._task.resume();
				if (synchronousResult) {
					return;
				}
				waitForTask = (0, p_defer_1.default)();
				return waitForTask.promise;
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
				(0, strict_1.default)(!waitForBatcher, "Expected taskDeferred not to be set.");
				waitForBatcher = (0, p_defer_1.default)();
				if (waitForTask) {
					waitForTask.resolve();
					waitForTask = undefined;
				} else {
					synchronousResult = true;
				}
				return waitForBatcher.promise;
			},
			paused: true,
		});
	}
	get activePromiseCount() {
		return this._task.activePromiseCount;
	}
	get invocations() {
		return this._task.invocations;
	}
	get concurrencyLimit() {
		return this._task.concurrencyLimit;
	}
	set concurrencyLimit(v) {
		this._task.concurrencyLimit = v;
	}
	get frequencyLimit() {
		return this._task.frequencyLimit;
	}
	set frequencyLimit(v) {
		this._task.frequencyLimit = v;
	}
	get frequencyWindow() {
		return this._task.frequencyWindow;
	}
	set frequencyWindow(v) {
		this._task.frequencyWindow = v;
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
