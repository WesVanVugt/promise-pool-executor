"use strict";
var __importDefault =
	(this && this.__importDefault) ||
	function (mod) {
		return mod && mod.__esModule ? mod : { default: mod };
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromisePoolGroupPrivate = void 0;
const p_defer_1 = __importDefault(require("p-defer"));
const utils_1 = require("./utils");
class PromisePoolGroupPrivate {
	constructor(pool, triggerNextCallback, options) {
		this._frequencyStarts = [];
		this._activeTaskCount = 0;
		this._activePromiseCount = 0;
		this._deferreds = [];
		this._recentRejection = false;
		this._locallyHandled = false;
		this._secondaryRejections = [];
		this._pool = pool;
		if (!options) {
			options = {};
		}
		this.concurrencyLimit = (0, utils_1.isNull)(options.concurrencyLimit) ? Infinity : options.concurrencyLimit;
		this.frequencyLimit = (0, utils_1.isNull)(options.frequencyLimit) ? Infinity : options.frequencyLimit;
		this.frequencyWindow = (0, utils_1.isNull)(options.frequencyWindow) ? 1000 : options.frequencyWindow;
		this._triggerNextCallback = triggerNextCallback;
	}
	get activeTaskCount() {
		return this._activeTaskCount;
	}
	get activePromiseCount() {
		return this._activePromiseCount;
	}
	get concurrencyLimit() {
		return this._concurrencyLimit;
	}
	set concurrencyLimit(v) {
		var _a;
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error(`Invalid concurrencyLimit: ${v}`);
		}
		this._concurrencyLimit = v;
		(_a = this._triggerNextCallback) === null || _a === void 0 ? void 0 : _a.call(this);
	}
	get frequencyLimit() {
		return this._frequencyLimit;
	}
	set frequencyLimit(v) {
		var _a;
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error(`Invalid frequencyLimit: ${v}`);
		}
		this._frequencyLimit = v;
		(_a = this._triggerNextCallback) === null || _a === void 0 ? void 0 : _a.call(this);
	}
	get frequencyWindow() {
		return this._frequencyWindow;
	}
	set frequencyWindow(v) {
		var _a;
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error(`Invalid frequencyWindow: ${v}`);
		}
		this._frequencyWindow = v;
		(_a = this._triggerNextCallback) === null || _a === void 0 ? void 0 : _a.call(this);
	}
	get freeSlots() {
		if (this._frequencyLimit !== Infinity) {
			this._cleanFrequencyStarts(Date.now());
		}
		return this._getFreeSlots();
	}
	_getFreeSlots() {
		return Math.min(
			this._concurrencyLimit - this._activePromiseCount,
			this._frequencyLimit - this._frequencyStarts.length,
		);
	}
	_cleanFrequencyStarts(now) {
		if (this._frequencyStarts.length > 0) {
			const time = now - this._frequencyWindow;
			let i = 0;
			while (i < this._frequencyStarts.length && this._frequencyStarts[i] <= time) {
				i++;
			}
			if (i > 0) {
				this._frequencyStarts.splice(0, i);
			}
		}
	}
	_busyTime() {
		if (this._activePromiseCount >= this._concurrencyLimit) {
			return Infinity;
		} else if (this._frequencyLimit && this._frequencyStarts.length >= this._frequencyLimit) {
			return this._frequencyStarts[0] + this._frequencyWindow;
		}
		return 0;
	}
	_resolve() {
		if (!this._rejection && this._deferreds.length) {
			for (const deferred of this._deferreds) {
				deferred.resolve();
			}
			this._deferreds.length = 0;
		}
	}
	_reject(promise) {
		if (this._rejection) {
			if (this._locallyHandled) {
				(0, utils_1.handleRejection)(promise);
			}
			this._secondaryRejections.push(promise);
			return;
		}
		this._rejection = promise;
		if (this._deferreds.length) {
			this._locallyHandled = true;
			for (const deferred of this._deferreds) {
				deferred.resolve(promise);
			}
			this._deferreds.length = 0;
		}
		this._recentRejection = true;
		setImmediate(() => {
			this._recentRejection = false;
			if (this._activeTaskCount < 1) {
				this._rejection = undefined;
				this._locallyHandled = false;
				if (this._secondaryRejections.length) {
					this._secondaryRejections.length = 0;
				}
			}
		});
	}
	waitForIdle() {
		if (this._rejection) {
			this._locallyHandled = true;
			if (this._secondaryRejections.length) {
				for (const rejection of this._secondaryRejections) {
					(0, utils_1.handleRejection)(rejection);
				}
				this._secondaryRejections.length = 0;
			}
			return this._rejection;
		}
		if (this._activeTaskCount <= 0) {
			return Promise.resolve();
		}
		const deferred = (0, p_defer_1.default)();
		this._deferreds.push(deferred);
		return deferred.promise;
	}
	_incrementTasks() {
		this._activeTaskCount++;
	}
	_decrementTasks() {
		this._activeTaskCount--;
		if (this._activeTaskCount > 0) {
			return;
		}
		if (this._rejection && !this._recentRejection) {
			this._rejection = undefined;
			this._locallyHandled = false;
		} else {
			this._resolve();
		}
	}
}
exports.PromisePoolGroupPrivate = PromisePoolGroupPrivate;
