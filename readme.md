# promise-pool-executor

A module for managing ES6 promise concurrency, frequency, and efficiency.

For release notes, see the [CHANGELOG](https://github.com/baudzilla/promise-pool-executor/blob/master/CHANGELOG.md).

If you are upgrading from version 0.x to 1.0, please see the [UPGRADING](https://github.com/baudzilla/promise-pool-executor/blob/master/UPGRADING.md) notes for information on how to migrate existing code to work with the new major version.

## Installation

npm install promise-pool-executor

## Examples

Promises can be added to the pool in the form of tasks. Tasks use a "generator" function to create promises which fill the task's pool. Limits on the number of promises created can be imposed for the entire pool, an individual task, or a group of tasks.

### pool.addEachTask

This type of task creates a promise for each element in an array.
```javascript
const PromisePool = require('promise-pool-executor');
// Create a pool with a concurrency limit of 2
const pool = new PromisePool.PromisePoolExecutor({
    concurrencyLimit: 2
});
pool.addEachTask({
    data: [1, 2, 3],
    generator: (element, i) => {
        return Promise.resolve(element + 1);
    }
}).promise().then((results) => {
    console.log(results); // [ 2, 3, 4]
});
```

### pool.addSingleTask

This type of task creates a single promise.
```javascript
const PromisePool = require('promise-pool-executor');
// Create a pool with a no limits set
const pool = new PromisePool.PromisePoolExecutor();
pool.addSingleTask({
    generator: () => {
        return Promise.resolve('finished');
    }
}).promise().then((result) => {
    console.log(result); // finished
});
```

### pool.addGenericTask

Add a general-purpose task.
```javascript
const PromisePool = require('promise-pool-executor');
// Create a pool with a frequency limit of 1 promise per second
const pool = new PromisePool.PromisePoolExecutor({
    frequencyLimit: 1,
    frequencyWindow: 1000,
});
pool.addGenericTask({
    generator: (i) => {
        if (i > 3) {
            return; // end the task
        } else {
            return Promise.resolve(i);
        }
    }
}).promise().then((results) => {
    console.log(results); // [ 0, 1, 2, 3 ]
});
```

### pool.addPersistentBatchTask

This type of task can be used to combine requests into batches with the aim of improving efficiency.
Typically this would be used to combine requests to a website or database to reduce the time required to complete the requests.
```javascript
const PromisePool = require('promise-pool-executor');
// Create a pool with no limits set
const pool = new PromisePool.PromisePoolExecutor();
let runCount = 0;
const persistentBatchTask = pool.addPersistentBatchTask({
    generator: (data) => {
        runCount++;
        return Promise.resolve(data.map((n) => {
            return n + 1;
        }));
    }
});
// Send the batch of requests. This step is optional.
batcher.send();
const inputs = [1, 3, 5, 7];
// Start a series of individual requests
const promises = inputs.map((input) => persistentBatchTask.getResult(input));
// Wait for all the requests to complete
Promise.all(promises).then((results) => {
    console.log(results); // [ 2, 4, 6, 8 ]
    // The requests were still done in a single run
    console.log(runCount); // 1
});
```

## API Reference

### Object: PromisePoolExecutor

A pool to add tasks and groups to.

#### Constructor

**new PromisePoolExecutor(options)** - Creates a new promise pool.
  * options.**concurrencyLimit** - The maximum number of promises allowed to be active simultaneously in the pool *(optional)*.
  * options.**frequencyLimit** - The maximum number promises allowed to be generated within the time window specified by pool.frequencyWindow *(optional)*.
  * options.**frequencyWindow** - The time window in milliseconds to use for pool.frequencyLimit *(optional)*.

#### Properties

* pool.**activePromiseCount** - The number of promises active in the pool *(read-only)*.
* pool.**activeTaskCount** - The number of tasks active in the pool *(read-only)*.
* pool.**concurrencyLimit** - The maximum number of promises allowed to be active simultaneously in the pool.
* pool.**freeSlots** - The number of promises which can be created before reaching the pool's configured limits *(read-only)*.
* pool.**frequencyLimit** - The maximum number promises allowed to be generated within the time window specified by pool.frequencyWindow.
* pool.**frequencyWindow** - The time window in milliseconds to use for pool.frequencyLimit.

#### Methods

* pool.**addBatchTask(options)** - Adds a task which generates a promise for batches of elements from an array. Returns a [PromisePoolTask object](#object-promisepooltask), which can be resolved to an array containing the results of the task by using task.promise().
  * options.**batchSize** - Either a number indicating the number of elements in each batch, or a function which returns the number of elements in each batch. If using batchSize as a function, parameters are passed to the function for the current array index and the number of free slots.
  * options.**concurrencyLimit** - The maximum number of promises allowed to be active simultaneously for the task *(optional)*.
  * options.**data** - An array containing data to be divided into batches and passed to the generator function.
  * options.**frequencyLimit** - The maximum number promises allowed to be generated within the time window specified by options.frequencyWindow *(optional)*.
  * options.**frequencyWindow** - The time window in milliseconds to use for options.frequencyLimit *(optional)*.
  * options.**generator** - A function which returns a new promise or undefined each time it is run. If the function returns undefined, the task will be flagged as completed unless it is in a paused state. Called with "this" set as the PromisePoolTask object and passed arguments for the current elements of options.data, the first element's index, and the invocation number.
  * options.**groups** - An array of groups to assign the task to. Groups are created using pool.addGroup(options) *(optional)*.
  * options.**invocationLimit** - The maximum number of times the task can be invoked *(optional)*.
  * options.**paused** - Starts the task in a paused state *(optional)*.
* pool.**addEachTask(options)** - Adds a task which generates a promise for each element in an array. Returns a [PromisePoolTask object](#object-promisepooltask), which can be resolved to an array containing the results of the task by using task.promise().
  * options.**concurrencyLimit** - The maximum number of promises allowed to be active simultaneously for the task *(optional)*.
  * options.**data** - An array, each element of which will be passed to the generator function.
  * options.**frequencyLimit** - The maximum number promises allowed to be generated within the time window specified by options.frequencyWindow *(optional)*.
  * options.**frequencyWindow** - The time window in milliseconds to use for options.frequencyLimit *(optional)*.
  * options.**generator** - A function which returns a new promise or undefined each time it is run. If the function returns undefined, the task will be flagged as completed unless it is in a paused state. Called with "this" set as the PromisePoolTask object and passed arguments for the current element of options.data, and the element's index.
  * options.**groups** - An array of groups to assign the task to. Groups are created using pool.addGroup(options) *(optional)*.
  * options.**paused** - Starts the task in a paused state *(optional)*.
* pool.**addGenericTask(options)** - Adds a general-purpose task to the pool. Returns a [PromisePoolTask object](#object-promisepooltask), which can be resolved to an array containing the results of the task by using task.promise(). If options.resultConverter is provided, the results may be modified before being returned.
  * options.**concurrencyLimit** - The maximum number of promises allowed to be active simultaneously for the task *(optional)*.
  * options.**frequencyLimit** - The maximum number of times a promise can be invoked within the time window specified by options.frequencyWindow *(optional)*.
  * options.**frequencyWindow** - The time window in milliseconds to use for options.frequencyLimit *(optional)*.
  * options.**generator** - A function which returns a new promise or undefined each time it is run. If the function returns undefined, the task will be flagged as completed unless it is in a paused state. Called with "this" set as the PromisePoolTask object and passed an argument for the invocation number.
  * options.**groups** - An array of groups to assign the task to. Groups are created using pool.addGroup(options) *(optional)*.
  * options.**invocationLimit** - The maximum number of times the task can be invoked *(optional)*.
  * options.**paused** - Starts the task in a paused state *(optional)*.
  * options.**resultConverter** - A function which converts the results of the task upon completion *(optional)*.
* pool.**addGroup(options)** - Adds a group to the pool, returning a [PromisePoolGroup object](#object-promisepoolgroup). Groups can be used to specify limits for how often a subset of tasks can be invoked, or to respond when a subset of tasks has completed.
  * options.**concurrencyLimit** - The maximum number of promises allowed to be active simultaneously in the group *(optional)*.
  * options.**frequencyLimit** - The maximum number promises allowed to be generated within the time window specified by options.frequencyWindow *(optional)*.
  * options.**frequencyWindow** - The time window in milliseconds to use for options.frequencyLimit *(optional)*.
* pool.**addLinearTask(options)** - Adds a task with a concurrency limit of 1. Returns a PromisePoolTask object which can be resolved to an array containing the results of the task by using task.promise().
  * options.**generator** - A function which returns a new promise or undefined each time it is run. If the function returns undefined, the task will be flagged as completed unless it is in a paused state. Called with "this" set as the PromisePoolTask object and passed an argument for the invocation number.
  * options.**groups** - An array of groups to assign the task to. Groups are created using pool.addGroup(options) *(optional)*.
  * options.**invocationLimit** - The maximum number of times the task can be invoked *(optional)*.
  * options.**paused** - Starts the task in a paused state *(optional)*.
* pool.**addPersistentBatchTask(options)** - Returns a [PersistentBatchTask object](#object-persistentbatchtask), which can be used to combine multiple requests into batches to improve efficiency.
  * options.**concurrencyLimit** - The maximum number of promises allowed to be active simultaneously for the task *(optional)*.
  * options.**frequencyLimit** - The maximum number promises allowed to be generated within the time window specified by options.frequencyWindow *(optional)*.
  * options.**frequencyWindow** - The time window in milliseconds to use for options.frequencyLimit *(optional)*.
  * options.**generator** - A function which is passed an array of request values, returning a promise which resolves to an array of response values. The request and response arrays must be of equal length. To reject an individual request, return an Error object (or class which extends Error) at the corresponding element in the response array. To retry an individual request, return the BATCHER\_RETRY\_TOKEN in the response array.
  * options.**maxBatchSize** - The maximum number of requests that can be combined in a single batch *(optional)*.
  * options.**queuingDelay** - The number of milliseconds to wait before running a batch of requests. This is used to allow time for the requests to queue up. Defaults to 1ms. This delay does not apply if the limit set by options.maxBatchSize is reached, or if the task's send method is called. Note that since the setTimeout to perform this delay, batches delayed by this will only be run when Node.js is idle, even if that means a longer delay *(optional)*.
  * options.**queuingThresholds** - An array containing the number of requests that must be queued in order to trigger a batch request at each level of concurrency. For example [1, 5], would require at least 1 queued request when no batch requests are active, and 5 queued requests when 1 (or more) batch requests are active. Defaults to [1]. Note that the delay imposed by options.queuingDelay still applies when a batch request is triggered *(optional)*.
* pool.**addSingleTask(options)** - Adds a task with a single promise. Returns a [PromisePoolTask object](#object-promisepooltask), which can be resolved to the result of the task by using task.promise().
  * options.**generator** - A function which returns a promise. Is passed the value of options.data as the first argument.
  * options.**data** - A variable which gets passed as the first argument to the generator function *(optional)*.
  * options.**groups** - An array of groups to assign the task to. Groups are created using pool.addGroup(options) *(optional)*.
  * options.**paused** - Starts the task in a paused state *(optional)*.
* pool.**waitForIdle()** - Returns a promise which resolves when no tasks are active (or paused) in the pool.

### Object: PromisePoolGroup
A group that tasks can be assigned to. Groups can impose limits on tasks assigned to them, give information about the tasks as a group, or respond to the completion of the tasks. Created using the pool.addGroup() method.

#### Properties

* group.**activePromiseCount** - The number of promises active in the group *(read-only)*.
* group.**activeTaskCount** - The number of tasks active in the group *(read-only)*.
* group.**concurrencyLimit** - The maximum number of promises allowed to be active simultaneously for the task.
* group.**freeSlots** - The number of promises which can be created before reaching the group's configured limits *(read-only)*.
* group.**frequencyLimit** - The maximum number promises allowed to be generated within the time window specified by group.frequencyWindow.
* group.**frequencyWindow** - The time window in milliseconds to use for group.frequencyLimit.

#### Methods

* pool.**waitForIdle()** - Returns a promise which resolves when no tasks are active (or paused) in the pool.

### Object: PromisePoolTask
A task which can generate promises within a pool. Created using the pool.addGenericTask(), pool.addSingleTask(), pool.addEachTask(), pool.addLinearTask(), and pool.addBatchTask() methods.

#### Properties

* task.**activePromiseCount** - The number of promises active in the task *(read-only)*.
* task.**concurrencyLimit** - The maximum number of promises allowed to be active simultaneously for the task.
* task.**freeSlots** - The number of promises which can be created before reaching the task's configured limits *(read-only)*.
* task.**frequencyLimit** - The maximum number promises allowed to be generated within the time window specified by task.frequencyWindow.
* task.**frequencyWindow** - The time window in milliseconds to use for task.frequencyLimit.
* task.**invocationLimit** - The maximum number of times the task can be invoked.
* task.**invocations** - The number of times the task has been invoked *(read-only)*.
* task.**state** - An enumeration representing the current state of the task *(read-only)*.
  * TaskState.**Active** - The task is active and promises will be generated according to the configured limits.
  * TaskState.**Paused** - The task is paused and may be ended or resumed later. Any outstanding promises will continue to run.
  * TaskState.**Exhausted** - The task has no more work to do and will terminate when all outstanding promises have ended.
  * TaskState.**Terminated** - All outstanding promises have ended and the result has been returned or an error thrown.

#### Methods

* task.**end()** - Ends the task, preventing the generator function from being called again.
* task.**pause()** - Puts the task in a paused state.
* task.**promise()** - Returns a promise which resolves to the result of the task upon completion, or rejects on error.
* task.**resume()** - Resumes a paused task.

### Object: PersistentBatchTask
A task which can be used to combine multiple individual requests into batch requests to improve efficiency. Typical uses would include combining single web API or database calls into batch calls. Created using the pool.addPersistentBatchTask() method.

#### Properties

*Same properties as [PromisePoolTask](#object-promisepooltask).*

#### Methods

* persistentBatchTask.**end()** - Ends the task, preventing the generator function from being called again.
* persistentBatchTask.**getResult(input)** - Returns a promise which resolves or rejects with the individual result returned from the task's generator function.
* persistentBatchTask.**send**() - Bypasses any queuingDelay set, while respecting all other limits imposed. If no other limits are set, this will result in the generator function being run immediately. Note that batches will still be run even if this function is not called, once the queuingDelay or maxBatchSize is reached.

## License

[MIT](https://github.com/baudzilla/promise-pool-executor/blob/master/LICENSE)
