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
let pool: PromisePool.PromisePoolExecutor = new PromisePool.PromisePoolExecutor(2);
pool.addEachTask({
    data: [1, 2, 3],
    generator: (element) => {
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
let pool: PromisePool.PromisePoolExecutor = new PromisePool.PromisePoolExecutor();
pool.addSingleTask({
    generator: () => {
        return Promise.resolve("finished");
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
let pool: PromisePool.PromisePoolExecutor = new PromisePool.PromisePoolExecutor();
pool.addSingleTask({
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

## License

The MIT License (MIT)

Copyright (c) 2017 Wes van Vugt

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
