"use strict";
var __importDefault =
	(this && this.__importDefault) ||
	function (mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromisePoolTaskPrivate = void 0;
const p_defer_1 = __importDefault(require("p-defer"));
const util_1 = __importDefault(require("util"));
const task_1 = require("../public/task");
const utils_1 = require("./utils");
const debug = util_1.default.debuglog("promise-pool-executor:task");
class PromisePoolTaskPrivate {
	constructor(privateOptions, options) {
		this._invocations = 0;
		this._result = [];
		this._deferreds = [];
		debug("Creating task");
		this._pool = privateOptions.pool;
		this._triggerCallback = privateOptions.triggerNowCallback;
		this._detachCallback = privateOptions.detach;
		this._resultConverter = options.resultConverter;
		this._state = options.paused ? task_1.TaskState.Paused : task_1.TaskState.Active;
		this.invocationLimit = (0, utils_1.isNull)(options.invocationLimit) ? Infinity : options.invocationLimit;
		this._taskGroup = privateOptions.pool.addGroup(options);
		this._groups = [privateOptions.globalGroup, this._taskGroup];
		if (options.groups) {
			const groups = options.groups;
			for (const group of groups) {
				if (group._pool !== this._pool) {
					throw new Error("options.groups contains a group belonging to a different pool");
				}
			}
			this._groups.push(...groups);
		}
		this._generator = options.generator;
		if (!(0, utils_1.isNull)(options.invocationLimit) && options.invocationLimit <= 0) {
			this.end();
			return;
		}
		for (const group of this._groups) {
			group._incrementTasks();
		}
	}
	get activePromiseCount() {
		return this._taskGroup._activePromiseCount;
	}
	get invocations() {
		return this._invocations;
	}
	get invocationLimit() {
		return this._invocationLimit;
	}
	set invocationLimit(v) {
		var _a;
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error("Invalid invocationLimit: " + v);
		}
		this._invocationLimit = v;
		if (this._invocations >= this._invocationLimit) {
			this.end();
		}
		(_a = this._triggerCallback) === null || _a === void 0 ? void 0 : _a.call(this);
	}
	get concurrencyLimit() {
		return this._taskGroup.concurrencyLimit;
	}
	set concurrencyLimit(v) {
		this._taskGroup.concurrencyLimit = v;
	}
	get frequencyLimit() {
		return this._taskGroup.frequencyLimit;
	}
	set frequencyLimit(v) {
		this._taskGroup.frequencyLimit = v;
	}
	get frequencyWindow() {
		return this._taskGroup.frequencyWindow;
	}
	set frequencyWindow(v) {
		this._taskGroup.frequencyWindow = v;
	}
	get freeSlots() {
		let freeSlots = this._invocationLimit - this._invocations;
		for (const group of this._groups) {
			const slots = group.freeSlots;
			if (slots < freeSlots) {
				freeSlots = slots;
			}
		}
		return freeSlots;
	}
	get state() {
		return this._state;
	}
	async promise() {
		if (this._rejection) {
			return this._rejection;
		} else if (this._state === task_1.TaskState.Terminated) {
			return this._returnResult;
		}
		const deferred = (0, p_defer_1.default)();
		this._deferreds.push(deferred);
		return deferred.promise;
	}
	pause() {
		if (this._state === task_1.TaskState.Active) {
			debug("State: %o", "Paused");
			this._state = task_1.TaskState.Paused;
		}
	}
	resume() {
		if (this._state === task_1.TaskState.Paused) {
			debug("State: %o", "Active");
			this._state = task_1.TaskState.Active;
			this._triggerCallback();
		}
	}
	end() {
		if (this._state < task_1.TaskState.Exhausted) {
			debug("State: %o", "Exhausted");
			this._state = task_1.TaskState.Exhausted;
			if (this._taskGroup._activeTaskCount > 0) {
				this._detachCallback();
			}
		}
		if (!this._generating && this._state < task_1.TaskState.Terminated && this._taskGroup._activePromiseCount <= 0) {
			debug("State: %o", "Terminated");
			this._state = task_1.TaskState.Terminated;
			if (this._taskGroup._activeTaskCount > 0) {
				for (const group of this._groups) {
					group._decrementTasks();
				}
			}
			this._resolve();
		}
	}
	_busyTime() {
		if (this._state !== task_1.TaskState.Active) {
			return Infinity;
		}
		let time = 0;
		for (const group of this._groups) {
			const busyTime = group._busyTime();
			if (busyTime > time) {
				time = busyTime;
			}
		}
		return time;
	}
	_cleanFrequencyStarts(now) {
		const groups = this._groups.values();
		groups.next();
		for (const group of groups) {
			group._cleanFrequencyStarts(now);
		}
	}
	_run() {
		if (this._generating) {
			throw new Error("Internal Error: Task is already being run");
		}
		if (this._invocations >= this._invocationLimit) {
			this.end();
			return;
		}
		debug("Running generator");
		let promise;
		this._generating = true;
		try {
			promise = this._generator.call(this, this._invocations);
		} catch (err) {
			this._generating = false;
			this._reject(err);
			return;
		}
		this._generating = false;
		if ((0, utils_1.isNull)(promise)) {
			if (this._state !== task_1.TaskState.Paused) {
				this.end();
			}
			return;
		}
		for (const group of this._groups) {
			group._activePromiseCount++;
			if (group._frequencyLimit !== Infinity) {
				group._frequencyStarts.push(Date.now());
			}
		}
		const resultIndex = this._invocations;
		this._invocations++;
		if (this._invocations >= this._invocationLimit) {
			this.end();
		}
		(async () => {
			let result;
			try {
				result = await promise;
			} catch (err) {
				this._reject(err);
			} finally {
				debug("Promise ended.");
				for (const group of this._groups) {
					group._activePromiseCount--;
				}
				debug("Promise Count: %o", this._taskGroup._activePromiseCount);
				if (result !== undefined && this._result) {
					this._result[resultIndex] = result;
				}
				if (this._state >= task_1.TaskState.Exhausted && this._taskGroup._activePromiseCount <= 0) {
					this.end();
				}
				this._triggerCallback();
			}
		})();
	}
	_resolve() {
		if (this._rejection || !this._result) {
			return;
		}
		this._result.length = this._invocations;
		this._state = task_1.TaskState.Terminated;
		if (this._resultConverter) {
			try {
				this._returnResult = this._resultConverter(this._result);
			} catch (err) {
				this._reject(err);
				return;
			}
		} else {
			this._returnResult = this._result;
		}
		this._result = undefined;
		if (this._deferreds.length) {
			for (const deferred of this._deferreds) {
				deferred.resolve(this._returnResult);
			}
			this._deferreds.length = 0;
		}
	}
	_reject(err) {
		if (this._rejection) {
			debug("This task already failed. Redundant error: %O", err);
			return;
		}
		const promise = Promise.reject(err);
		this._rejection = promise;
		this.end();
		if (this._deferreds.length) {
			for (const deferred of this._deferreds) {
				deferred.resolve(promise);
			}
			this._deferreds.length = 0;
		}
		for (const group of this._groups) {
			group._reject(promise);
		}
	}
}
exports.PromisePoolTaskPrivate = PromisePoolTaskPrivate;
