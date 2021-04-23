const { newContexts } = require("@kubernetes/client-node/dist/config_types");

// Using synchronous scheduler API
async function taskFunction1(ins, outs, context, cb) {
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


// Using asynchronous scheduler API
function taskFunction2(ins, outs, context, cb) {
	let taskItem = { 
		"ins": ins, 
		"outs": outs, 
		"context": context, 
		"cb": cb
	}

	let scheduler = context.appConfig.scheduler;

	if (scheduler) {
		return scheduler.addTaskItem(taskItem, taskFunction2Cb);
	}

}

function taskFunction2Cb(taskArray, node) {
	console.log("Got scheduler callback, executing task array on node", node);
	taskArray.forEach((task) => {
		let scheduler = task.context.appConfig.scheduler;
		scheduler.notifyTaskCompletion(task.context.appId, task.context.procId);
		task.cb(null, task.outs);
	});
}

exports.taskFunction1 = taskFunction1;
exports.taskFunction2 = taskFunction2;
