"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskState = void 0;
var TaskState;
(function (TaskState) {
	TaskState[(TaskState["Active"] = 0)] = "Active";
	TaskState[(TaskState["Paused"] = 1)] = "Paused";
	TaskState[(TaskState["Exhausted"] = 2)] = "Exhausted";
	TaskState[(TaskState["Terminated"] = 3)] = "Terminated";
})(TaskState || (exports.TaskState = TaskState = {}));
