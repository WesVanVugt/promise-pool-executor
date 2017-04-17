# promise-pool-executor

A module for managing ES6 promise concurrency.

## Installation

npm install promise-pool-executor

## Examples

Promises can be added to the pool in the form of tasks. Tasks use a generator function to create promises which fill the task's pool.

### pool.addEachTask

This type of task creates a promise for each element in an array.
```
let PromisePool = require('promise-pool-executor');
// Create a pool with a concurrency limit of 2
let pool = new PromisePool.PromisePoolExecutor(2);
pool.addEachTask({
    data: [1, 2, 3],
    generator: (element, i) => {
        return Promise.resolve(element + 1);
    }
}).then((results) => {
    console.log(results); // [ 2, 3, 4]
});
```

### pool.addSingleTask

This type of task creates a single promise.
```
let PromisePool = require('promise-pool-executor');
// Create a pool with a no concurrency limit
let pool = new PromisePool.PromisePoolExecutor();
pool.addSingleTask({
    generator: () => {
        return Promise.resolve('finished');
    }
}).then((result) => {
    console.log(result); // finished
});
```

### pool.addGenericTask

Add a general-purpose task.
```
let PromisePool = require('promise-pool-executor');
// Create a pool with a no concurrency limit
let pool = new PromisePool.PromisePoolExecutor();
pool.addGenericTask({
    generator: (i) => {
        if (i > 3) {
            return null; // end the task
        } else {
            return Promise.resolve(i);
        }
    }
}).then((results) => {
    console.log(results); // [ 0, 1, 2, 3 ]
});
```

## API Reference

### Properties

* pool.**activePromiseCount** - The number of active promises *(read-only)*.
* pool.**concurrencyLimit** - The maximum number of promises which are allowed to run at one time.
* pool.**freeSlots** - The number of promises which can be invoked before the concurrency limit is reached *(read-only)*.
* pool.**idling** - A boolean indicating if the pool has no active tasks *(read-only)*.

### Methods

* pool.**addBatchTask(params)** - Adds a task which generates a promise for batches of elements from an array. Returns a promise which resolves to an array containing the results of the task. Accepts a parameters object with the following properties:
  * params.**batchSize** - Either a number indicating the number of elements in each batch, or a function which returns the number of elements in each batch. If using batchSize as a function, optional parameters are the current array index and the number of free slots.
  * params.**data** - An array containing data to be divided into batches and passed to the generator function.
  * params.**generator** - A function which returns a new promise each time it is run. Optionally accepts a first argument for the current element of params.data, and a second argument for the element's index.
  * params.**concurrencyLimit** - The maximum number of promises that can be active simultaneously for the task *(optional)*.
  * params.**groupIds** - An array of values, each of which identifies a group the task belongs to. These groups can be used to respond to the completion of a larger task via pool.waitForGroupIdle *(optional)*.
  * params.**id** - A unique value used for identifying the task, such as a Symbol *(optional)*.
  * params.**invocationLimit** - The maximum number of times the task can be invoked *(optional)*.
  * params.**noPromise** - A boolean which, when true, causes pool.addBatchTask to return null. This should only be used when the completion of the task is handled via pool.waitForIdle or pool.waitForGroupIdle *(optional)*.
* pool.**addEachTask(params)** - Adds a task which generates a promise for each element in an array. Returns a promise which resolves to an array containing the results of the task. Accepts a parameters object with the following properties:
  * params.**data** - An array, each element of which will be passed to the generator function.
  * params.**generator** - A function which returns a new promise each time it is run. Optionally accepts a first argument for the current element of params.data, and a second argument for the element's index.
  * params.**concurrencyLimit** - The maximum number of promises that can be active simultaneously for the task *(optional)*.
  * params.**groupIds** - An array of values, each of which identifies a group the task belongs to. These groups can be used to respond to the completion of a larger task via pool.waitForGroupIdle *(optional)*.
  * params.**id** - A unique value used for identifying the task, such as a Symbol *(optional)*.
  * params.**invocationLimit** - The maximum number of times the task can be invoked *(optional)*.
  * params.**noPromise** - A boolean which, when true, causes pool.addEachTask to return null. This should only be used when the completion of the task is handled via pool.waitForIdle or pool.waitForGroupIdle *(optional)*.
* pool.**addGenericTask(params)** - Adds a general-purpose task. Returns a promise which resolves to an array containing the results of the task. Accepts a parameters object with the following properties:
  * params.**generator** - A function which returns a new promise each time it is run, or null to indicate the task is completed.
  * params.**concurrencyLimit** - The maximum number of promises that can be active simultaneously for the task *(optional)*.
  * params.**groupIds** - An array of values, each of which identifies a group the task belongs to. These groups can be used to respond to the completion of a larger task via pool.waitForGroupIdle *(optional)*.
  * params.**id** - A unique value used for identifying the task, such as a Symbol *(optional)*.
  * params.**invocationLimit** - The maximum number of times the task can be invoked *(optional)*.
  * params.**noPromise** - A boolean which, when true, causes pool.addGenericTask to return null. This should only be used when the completion of the task is handled via pool.waitForIdle or pool.waitForGroupIdle *(optional)*.
* pool.**addLinearTask(params)** - Adds a task with a concurrency limit of 1. Returns a promise which resolves to an array containing the results of the task. Accepts a parameters object with the following properties:
  * params.**generator** - A function which returns a new promise each time it is run, or null to indicate the task is completed.
  * params.**groupIds** - An array of values, each of which identifies a group the task belongs to. These groups can be used to respond to the completion of a larger task via pool.waitForGroupIdle *(optional)*.
  * params.**id** - A unique value used for identifying the task, such as a Symbol *(optional)*.
  * params.**invocationLimit** - The maximum number of times the task can be invoked *(optional)*.
  * params.**noPromise** - A boolean which, when true, causes pool.addLinearTask to return null. This should only be used when the completion of the task is handled via pool.waitForIdle or pool.waitForGroupIdle *(optional)*.
* pool.**addSingleTask(params)** - Adds a task with a single promise. Returns a promise which resolves to the result of the task. Accepts a parameters object with the following properties:
  * params.**generator** - A function which returns a promise.
  * params.**data** - A variable which gets passed as the first argument to the generator function *(optional)*.
  * params.**groupIds** - An array of values, each of which identifies a group the task belongs to. These groups can be used to respond to the completion of a larger task via pool.waitForGroupIdle *(optional)*.
  * params.**id** - A unique value used for identifyingthea task, such as a Symbol *(optional)*.
  * params.**noPromise** - A boolean which, when true, causes pool.addSingleTask to return null. This should only be used when the completion of the task is handled via pool.waitForIdle or pool.waitForGroupIdle *(optional)*.
* pool.**getTaskStatus(id)** - Returns an object representing the status of the specified task. The returned status object has the following properties:
  * status.**id** - A unique value used for identifying the task (such as a Symbol).
  * status.**activeCount** - The current number of active invocations for the task.
  * status.**concurrencyLimit** - The maximum number of promises that can be active simultaneously for the task.
  * status.**freeSlots** - The number of times the task can be invoked before reaching the invocation limit, or the pool or task concurrency limit.
  * status.**invocations** - The number of times the task has been invoked.
  * status.**invocationLimit** - The maximum number of times the task can be invoked.
* pool.**stopTask(id)** - Stops the specified task, returning true if the task was found, and false otherwise.
* pool.**waitForIdle()** - Returns a promise which resolves when no promises are active in the pool.
* pool.**waitForGroupIdle(groupId)** - Returns a promise which resolves when no promises are active for the specified groupId.

## License

The MIT License (MIT)

Copyright (c) 2017 Wes van Vugt

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
