"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromisePoolGroupPrivate = void 0;
const optional_defer_1 = require("./optional-defer");
const utils_1 = require("./utils");
class PromisePoolGroupPrivate {
	_pool;
	_concurrencyLimit;
	_frequencyLimit;
	_frequencyWindow;
	_frequencyStarts = [];
	_activeTaskCount = 0;
	_activePromiseCount = 0;
	_deferred;
	_recentRejection = false;
	_triggerNextCallback;
	constructor(pool, triggerNextCallback, options) {
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
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error(`Invalid concurrencyLimit: ${v}`);
		}
		this._concurrencyLimit = v;
		this._triggerNextCallback?.();
	}
	get frequencyLimit() {
		return this._frequencyLimit;
	}
	set frequencyLimit(v) {
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error(`Invalid frequencyLimit: ${v}`);
		}
		this._frequencyLimit = v;
		this._triggerNextCallback?.();
	}
	get frequencyWindow() {
		return this._frequencyWindow;
	}
	set frequencyWindow(v) {
		if (typeof v !== "number" || isNaN(v)) {
			throw new Error(`Invalid frequencyWindow: ${v}`);
		}
		this._frequencyWindow = v;
		this._triggerNextCallback?.();
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
	_reject(promise) {
		if (!this._deferred) {
			if (this._activeTaskCount <= 0) {
				return;
			}
			this._deferred = new optional_defer_1.OptionalDeferredPromise();
		}
		this._deferred.resolve(promise);
		if (this._recentRejection) {
			return;
		}
		this._recentRejection = true;
		setImmediate(() => {
			this._recentRejection = false;
			if (this._activeTaskCount <= 0) {
				this._deferred = undefined;
			}
		});
	}
	waitForIdle() {
		if (!this._deferred) {
			if (this._activeTaskCount <= 0) {
				return Promise.resolve();
			}
			this._deferred = new optional_defer_1.OptionalDeferredPromise();
		}
		return this._deferred.promise();
	}
	_incrementTasks() {
		this._activeTaskCount++;
	}
	_decrementTasks() {
		this._activeTaskCount--;
		if (this._activeTaskCount <= 0 && this._deferred && !this._recentRejection) {
			this._deferred.resolve(undefined);
			this._deferred = undefined;
		}
	}
}
exports.PromisePoolGroupPrivate = PromisePoolGroupPrivate;
