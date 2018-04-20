# Changelog for promise-pool-executor

## 1.1.1 (2018-04-19)
* bugfix: Replaced a dependancy which had a reference to global Promise.defer method because it was causing deprecation
warnings in some cases.

## 1.1.0 (2017-12-26)
* bugfix: Remove postinstall script causing problems on install.
* feature: Added support for retries on PersistentBatchTask.
* feature: Added support for late handling of promise rejections.

## 1.0.3 (2017-10-09)
* bugfix: Updated error handling when multiple errors occur on the same task or group.
* misc: Updated debug logging to be divided up by module.
* misc: Moved persistent-batcher support to promise-batcher package.
* misc: Moved deferred support to defer-promise package.

## 1.0.2 (2017-08-14)
* feature: Made generator function typings compatible with a wider variety of outputs.

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