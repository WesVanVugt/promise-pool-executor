# Changelog for promise-pool-executor

## 1.0.0 (2017-08-07)
* feature: Added PromisePoolTask and PromisePoolGroup objects which can be interacted with directly, instead of by using IDs.
* feature: Added PersistentBatchTask feature.
* feature: Added the ability to pause and resume tasks.
* feature: Added the ability to restrict promise generation by frequency over time.
* feature: Added the ability to configure groups with their own limits.
* removed: All task and group IDs.
* removed: noPromise parameter.
* removed: pool.getTaskStatus method.
* removed: pool.stopTask method.
* removed: pool.waitForGroupIdle method.