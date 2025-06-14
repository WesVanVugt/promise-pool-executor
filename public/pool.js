"use strict";
var __importDefault =
	(this && this.__importDefault) ||
	function (mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromisePoolExecutor = void 0;
const util_1 = __importDefault(require("util"));
const group_1 = require("../private/group");
const persistent_batch_1 = require("../private/persistent-batch");
const task_1 = require("../private/task");
const utils_1 = require("../private/utils");
const task_2 = require("./task");
const debug = util_1.default.debuglog("promise-pool-executor:pool");
debug("booting %o", "promise-pool-executor");
let warnedThrottle = false;
class PromisePoolExecutor {
	constructor(options) {
		this._nextTriggerTime = Infinity;
		this._tasks = new Set();
		let groupOptions;
		if (!(0, utils_1.isNull)(options)) {
			if (typeof options === "object") {
				groupOptions = options;
			} else {
				groupOptions = {
					concurrencyLimit: options,
				};
			}
		} else {
			groupOptions = {};
		}
		this._globalGroup = this.addGroup(groupOptions);
	}
	get concurrencyLimit() {
		return this._globalGroup.concurrencyLimit;
	}
	set concurrencyLimit(v) {
		this._globalGroup.concurrencyLimit = v;
	}
	get frequencyLimit() {
		return this._globalGroup.frequencyLimit;
	}
	set frequencyLimit(v) {
		this._globalGroup.frequencyLimit = v;
	}
	get frequencyWindow() {
		return this._globalGroup.frequencyWindow;
	}
	set frequencyWindow(v) {
		this._globalGroup.frequencyWindow = v;
	}
	get activeTaskCount() {
		return this._globalGroup.activeTaskCount;
	}
	get activePromiseCount() {
		return this._globalGroup.activePromiseCount;
	}
	get freeSlots() {
		return this._globalGroup.freeSlots;
	}
	addGroup(options) {
		return new group_1.PromisePoolGroupPrivate(this, () => this._triggerImmediate(), options);
	}
	addGenericTask(options) {
		const task = new task_1.PromisePoolTaskPrivate(
			{
				detach: () => {
					this._removeTask(task);
				},
				globalGroup: this._globalGroup,
				pool: this,
				triggerNowCallback: () => this._triggerNow(),
			},
			options,
		);
		if (task.state <= task_2.TaskState.Paused) {
			this._tasks.add(task);
		}
		this._triggerNow();
		return task;
	}
	addSingleTask(options) {
		const data = options.data;
		const generator = options.generator;
		return this.addGenericTask({
			generator() {
				return generator.call(this, data);
			},
			groups: options.groups,
			invocationLimit: 1,
			paused: options.paused,
			resultConverter: (result) => result[0],
		});
	}
	addLinearTask(options) {
		return this.addGenericTask({
			concurrencyLimit: 1,
			frequencyLimit: options.frequencyLimit,
			frequencyWindow: options.frequencyWindow,
			generator: options.generator,
			groups: options.groups,
			invocationLimit: options.invocationLimit,
			paused: options.paused,
		});
	}
	addBatchTask(options) {
		let index = 0;
		if (
			!options.batchSize ||
			(typeof options.batchSize !== "function" && (typeof options.batchSize !== "number" || options.batchSize <= 0))
		) {
			throw new Error(`Invalid batchSize: ${options.batchSize}`);
		}
		const data = options.data;
		const generator = options.generator;
		const batchSizeOption = options.batchSize;
		return this.addGenericTask({
			concurrencyLimit: options.concurrencyLimit,
			frequencyLimit: options.frequencyLimit,
			frequencyWindow: options.frequencyWindow,
			generator(invocation) {
				if (index >= data.length) {
					return;
				}
				const oldIndex = index;
				if (typeof batchSizeOption === "function") {
					const batchSize = batchSizeOption(data.length - oldIndex, this.freeSlots);
					if (!batchSize || typeof batchSize !== "number" || batchSize <= 0) {
						throw new Error(`Invalid batchSize: ${batchSize}`);
					}
					index += batchSize;
				} else {
					index += batchSizeOption;
				}
				if (index >= data.length) {
					this.end();
				}
				return generator.call(this, data.slice(oldIndex, index), oldIndex, invocation);
			},
			groups: options.groups,
			invocationLimit: options.invocationLimit,
			paused: options.paused,
		});
	}
	addEachTask(options) {
		const data = options.data;
		return this.addGenericTask({
			concurrencyLimit: options.concurrencyLimit,
			frequencyLimit: options.frequencyLimit,
			frequencyWindow: options.frequencyWindow,
			groups: options.groups,
			paused: options.paused,
			generator(index) {
				if (index >= data.length - 1) {
					if (index >= data.length) {
						return;
					}
					this.end();
				}
				return options.generator.call(this, data[index], index);
			},
		});
	}
	addPersistentBatchTask(options) {
		return new persistent_batch_1.PersistentBatchTaskPrivate(this, options);
	}
	waitForIdle() {
		return this._globalGroup.waitForIdle();
	}
	_cleanFrequencyStarts(now) {
		this._globalGroup._cleanFrequencyStarts(now);
		for (const task of this._tasks) {
			task._cleanFrequencyStarts(now);
		}
	}
	_triggerImmediate() {
		var _a;
		if (this._nextTriggerTime === -1) {
			return;
		}
		(_a = this._nextTriggerClear) === null || _a === void 0 ? void 0 : _a.call(this);
		this._nextTriggerTime = -1;
		const immediate = setImmediate(() => {
			this._nextTriggerClear = undefined;
			this._nextTriggerTime = Infinity;
			this._triggerNow();
		});
		this._nextTriggerClear = () => {
			clearImmediate(immediate);
		};
	}
	_triggerNow() {
		var _a;
		if (this._triggering) {
			debug("Setting triggerAgain flag.");
			this._triggerAgain = true;
			return;
		}
		this._triggering = true;
		this._triggerAgain = false;
		debug("Trigger promises");
		const now = Date.now();
		this._cleanFrequencyStarts(now);
		let soonest = this._nextTriggerTime;
		let lastTask;
		for (const task of this._tasks) {
			for (;;) {
				const busyTime = task._busyTime();
				debug("BusyTime: %o", busyTime);
				if (!busyTime) {
					if (task.activePromiseCount > 100000) {
						if (lastTask === task) {
							soonest = -1;
							if (!warnedThrottle) {
								warnedThrottle = true;
								console.warn(
									"[PromisePoolExecutor] Throttling task with activePromiseCount %o.",
									task.activePromiseCount,
								);
							}
							break;
						}
						lastTask = task;
					}
					task._run();
				} else {
					if (busyTime < soonest) {
						soonest = busyTime;
					}
					break;
				}
			}
		}
		this._triggering = false;
		if (this._triggerAgain) {
			debug("TriggerAgain");
			return this._triggerNow();
		}
		debug("Soonest: %o", soonest);
		if (soonest !== this._nextTriggerTime) {
			switch (soonest) {
				case -1:
					this._triggerImmediate();
					break;
				case Infinity:
					this._nextTriggerClear();
					this._nextTriggerClear = undefined;
					this._nextTriggerTime = soonest;
					break;
				default:
					(_a = this._nextTriggerClear) === null || _a === void 0 ? void 0 : _a.call(this);
					this._nextTriggerTime = soonest;
					const timeout = setTimeout(() => {
						this._nextTriggerClear = undefined;
						this._nextTriggerTime = Infinity;
						this._triggerNow();
					}, soonest - now);
					this._nextTriggerClear = () => {
						clearTimeout(timeout);
					};
			}
		}
	}
	_removeTask(task) {
		if (this._tasks.delete(task)) {
			debug("Task removed");
		}
	}
}
exports.PromisePoolExecutor = PromisePoolExecutor;
