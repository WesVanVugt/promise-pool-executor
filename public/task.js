"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var TaskState;
(function (TaskState) {
    /**
     * The task is active and promises will be generated according to the limits set.
     */
    TaskState[TaskState["Active"] = 0] = "Active";
    /**
     * The task is paused and may be ended or resumed later. Any outstanding promises will continue to run.
     */
    TaskState[TaskState["Paused"] = 1] = "Paused";
    /**
     * The task has no more work to do and will terminate when all outstanding promises have ended.
     */
    TaskState[TaskState["Exhausted"] = 2] = "Exhausted";
    /**
     * All outstanding promises have ended and the result has been returned or an error thrown.
     */
    TaskState[TaskState["Terminated"] = 3] = "Terminated";
})(TaskState = exports.TaskState || (exports.TaskState = {}));
