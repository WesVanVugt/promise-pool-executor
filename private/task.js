"use strict";
var __importDefault =
	(this && this.__importDefault) ||
	function (mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromisePoolTaskPrivate = void 0;
const strict_1 = __importDefault(require("assert/strict"));
const util_1 = __importDefault(require("util"));
const task_1 = require("../public/task");
const optional_defer_1 = require("./optional-defer");
const utils_1 = require("./utils");
const debug = util_1.default.debuglog("promise-pool-executor:task");
class PromisePoolTaskPrivate {
	_groups;
	_generator;
	_result = [];
	_taskGroup;
	_invocations = 0;
	_invocationLimit;
	_state;
	_generating;
	_deferred = new optional_defer_1.OptionalDeferredPromise();
	_pool;
	_triggerCallback;
	_detachCallback;
	_resultConverter;
	constructor(privateOptions, options) {
		debug("Creating task");
		this._pool = privateOptions.pool;
		this._resultConverter = options.resultConverter;
		this._state = options.paused ? task_1.TaskState.Paused : task_1.TaskState.Active;
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
		this.invocationLimit = (0, utils_1.isNull)(options.invocationLimit) ? Infinity : options.invocationLimit;
		if (this._state !== task_1.TaskState.Terminated) {
			for (const group of this._groups) {
				group._incrementTasks();
			}
		}
		this._detachCallback = privateOptions.detach;
		this._triggerCallback = privateOptions.triggerNowCallback;
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
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error("Invalid invocationLimit: " + v);
		}
		this._invocationLimit = v;
		if (this._invocations >= this._invocationLimit) {
			this.end();
		}
		this._triggerCallback?.();
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
		return this._deferred.promise();
	}
	pause() {
		if (this._state === task_1.TaskState.Active) {
			debug("State: %o", "Paused");
			this._state = task_1.TaskState.Paused;
		}
	}
	resume() {
		if (this._state <= task_1.TaskState.Paused) {
			debug("State: %o", "Active");
			this._state = task_1.TaskState.Active;
			this._triggerCallback();
		}
	}
	end() {
		if (this._state < task_1.TaskState.Exhausted) {
			debug("State: %o", "Exhausted");
			this._state = task_1.TaskState.Exhausted;
			this._detachCallback?.();
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
		(0, strict_1.default)(!this._generating, "Internal Error: Task is already being run");
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
				if (result !== undefined) {
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
		this._result.length = this._invocations;
		this._state = task_1.TaskState.Terminated;
		let returnResult;
		if (this._resultConverter) {
			try {
				returnResult = this._resultConverter(this._result);
			} catch (err) {
				this._reject(err);
				return;
			}
		} else {
			returnResult = this._result;
		}
		this._deferred.resolve(returnResult);
	}
	_reject(err) {
		const promise = Promise.reject(err);
		this._deferred.resolve(promise);
		for (const group of this._groups) {
			group._reject(promise);
		}
		this.end();
	}
}
exports.PromisePoolTaskPrivate = PromisePoolTaskPrivate;
