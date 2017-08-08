# Upgrading Notes (0.x to 1.0)

Notes regarding breaking changes when transitioning from version 0.x to version 1.0.

## 1. Adding tasks now returns a PromisePoolTask object instead of a promise

As a result of this change, you will need to call the promise() method on the task to get a promise for the task result. Example:
```javascript
pool.addGenericTask({
    generator: (i) => {
        if (i < 5) {
            return Promise.resolve(i);
        }
    },
}).promise().then((results) => {
    console.log(results);
})
```

## 2. Group and task IDs have been removed

Instead, use the properties and methods on the PromisePoolGroup and PromisePoolTask objects to interact with them. Groups will need to be explicitly created using the pool.addGroup() method.

## 3. pool.getTaskStatus has been removed

Instead, use the properties on the PromisePoolTask objects to get the status of the task.

## 4. params.noPromise has been removed

It was no longer needed since simply not calling the promise method would have the same effect.