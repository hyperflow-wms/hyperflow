async function taskFunction(ins, outs, context, cb) {
	let scheduler = context.appConfig.scheduler;
	if (scheduler) {
		var node = await scheduler.getTaskExecutionPermission(context.appId, context.procId);
	}

	console.log("Got scheduler permission, executing task on node", node);
	
	if (scheduler) {
		scheduler.notifyTaskCompletion(context.appId, context.procId);
	}

	cb(null, outs);
}

exports.taskFunction = taskFunction;
