"use strict";
var __importDefault =
	(this && this.__importDefault) ||
	function (mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromisePoolExecutor = void 0;
const next_tick_1 = __importDefault(require("next-tick"));
const util_1 = __importDefault(require("util"));
const group_1 = require("../private/group");
const persistent_batch_1 = require("../private/persistent-batch");
const task_1 = require("../private/task");
const utils_1 = require("../private/utils");
const task_2 = require("./task");
const debug = util_1.default.debuglog("promise-pool-executor:pool");
debug("booting %o", "promise-pool-executor");
class PromisePoolExecutor {
	constructor(options) {
		this._tasks = [];
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
	set concurrencyLimit(val) {
		this._globalGroup.concurrencyLimit = val;
	}
	get frequencyLimit() {
		return this._globalGroup.frequencyLimit;
	}
	set frequencyLimit(val) {
		this._globalGroup.frequencyLimit = val;
	}
	get frequencyWindow() {
		return this._globalGroup.frequencyWindow;
	}
	set frequencyWindow(val) {
		this._globalGroup.frequencyWindow = val;
	}
	get activeTaskCount() {
		return this._globalGroup.activeTaskCount;
	}
	get activePromiseCount() {
		return this._globalGroup.activePromiseCount;
	}
	get freeSlots() {
		return this._globalGroup._concurrencyLimit - this._globalGroup._activePromiseCount;
	}
	addGroup(options) {
		return new group_1.PromisePoolGroupPrivate(this, () => this._triggerNextTick(), options);
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
			this._tasks.push(task);
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
			throw new Error("Invalid batch size: " + options.batchSize);
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
						return Promise.reject(new Error("Invalid batch size: " + batchSize));
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
	_cleanFrequencyStarts() {
		const now = Date.now();
		this._globalGroup._cleanFrequencyStarts(now);
		this._tasks.forEach((task) => {
			task._cleanFrequencyStarts(now);
		});
	}
	_clearTriggerTimeout() {
		if (this._nextTriggerTimeout) {
			clearTimeout(this._nextTriggerTimeout);
			this._nextTriggerTimeout = undefined;
		}
		this._nextTriggerTime = undefined;
	}
	_triggerNextTick() {
		if (this._nextTriggerTime === -1) {
			return;
		}
		this._clearTriggerTimeout();
		this._nextTriggerTime = -1;
		(0, next_tick_1.default)(() => {
			if (this._nextTriggerTime === -1) {
				this._nextTriggerTime = undefined;
				this._triggerNow();
			}
		});
	}
	_triggerNow() {
		if (this._triggering) {
			debug("Setting triggerAgain flag.");
			this._triggerAgain = true;
			return;
		}
		this._triggering = true;
		this._triggerAgain = false;
		debug("Trigger promises");
		this._cleanFrequencyStarts();
		this._clearTriggerTimeout();
		let taskIndex = 0;
		let task;
		let soonest = Infinity;
		let busyTime;
		while (taskIndex < this._tasks.length) {
			task = this._tasks[taskIndex];
			busyTime = task._busyTime();
			debug("BusyTime: %o", busyTime);
			if (!busyTime) {
				task._run();
			} else {
				taskIndex++;
				if (busyTime < soonest) {
					soonest = busyTime;
				}
			}
		}
		this._triggering = false;
		if (this._triggerAgain) {
			return this._triggerNow();
		}
		let time;
		if (soonest !== Infinity) {
			time = Date.now();
			if (time >= soonest) {
				return this._triggerNow();
			}
			this._nextTriggerTime = soonest;
			this._nextTriggerTimeout = setTimeout(() => {
				this._nextTriggerTimeout = undefined;
				this._nextTriggerTime = 0;
				this._triggerNow();
			}, soonest - time);
		}
	}
	_removeTask(task) {
		const i = this._tasks.indexOf(task);
		if (i !== -1) {
			debug("Task removed");
			this._tasks.splice(i, 1);
		}
	}
}
exports.PromisePoolExecutor = PromisePoolExecutor;
