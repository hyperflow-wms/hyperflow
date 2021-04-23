# Using scheduler API in Hyperflow workflows

A scheduler in general makes two decisions: (1) *when* (at which point in time) and (2) *where* (on which node) to run a *workflow task*. To this end, three API functions are provided:

```
let node = await scheduler.getTaskExecutionPermission(context.appId, context.procId);
```
This function will wait until the scheduler permits to execute the task (*when*) and return the node name on which the task should be executed (*where*).

```
scheduler.addTaskItem(taskItem, taskFunction2Cb)
```
This is an asynchronous alternative of `getTaskExecutionPermission`, also enabling the scheduler to [agglomerate tasks](https://github.com/hyperflow-wms/hyperflow/wiki/Task-agglomeration). See documentation in the code for details.

```
scheduler.notifyTaskCompletion(context.appId, context.procId);
```
This function should be used to notify that a task has been completed. This allows the scheduler to trigger subsequent tasks, or even update the execution schedule. 
