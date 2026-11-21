// jobResult.js
// Builds the two functions through which a process function follows the
// remote job of a task: 'context.jobResult' waits for the task's completion,
// and 'context.resolveJobResult' ends that wait with an exit code set by the
// engine itself. wflib/index.js adds both to the context of every task it
// invokes.
//
// This module requires nothing, so tests can load it and give the functions
// real connectors (wflib/connector.js) on a fake redis client.

// Function addJobResultFunctions
//
// Inputs:
// - 'conf': the task's context. 'conf.taskId' is the task the functions act
//   on when the caller passes no task id; 'conf.name' (the task's process
//   name) labels the task in the connector's log messages.
// - 'connectors': the engine's completion connectors:
//   * 'transport': 'stream' or 'set', the completion transport in use
//     (HF_VAR_COMPLETION_TRANSPORT)
//   * 'streamConnector()': returns the engine process's single
//     StreamRemoteJobConnector, used with the 'stream' transport
//   * 'setConnector(wfId)': returns the RemoteJobConnector of workflow
//     'wfId', used with the 'set' transport
//   The functions call these each time they run, not when they are built,
//   because the engine creates the stream connector on first use.
//
// Sets 'conf.jobResult' and 'conf.resolveJobResult', and returns 'conf'.
function addJobResultFunctions(conf, connectors) {

    // The connector that receives the completion notices of 'taskId'
    // (hfId:wfId:procId:firingId).
    function connectorFor(taskId) {
        if (connectors.transport === 'stream') {
            return connectors.streamConnector();
        }
        let wfId = taskId.split(':')[1];
        return connectors.setConnector(wfId);
    }

    // Waits until the task's executor reports the task's completion, and
    // resolves to [null, code], with the exit code as a string. The task is
    // 'conf.taskId' unless the caller names another one in 'taskIdentifier'.
    // 'timeout' is not used: the wait has no time limit.
    var getJobResult = async function(timeout, taskIdentifier) {
        const taskId = taskIdentifier || conf.taskId;
        return connectorFor(taskId).waitForTask(taskId, conf.name);
    }

    // Ends the 'jobResult' wait for a task with the given exit code, as if
    // the task's executor had reported it, for a task the engine itself
    // knows has failed (e.g. its Kubernetes Job could not be created). Works
    // whether or not the wait has started. The task is 'conf.taskId' unless
    // the caller names another one in 'taskIdentifier'.
    var resolveJobResult = function(code, taskIdentifier) {
        const taskId = taskIdentifier || conf.taskId;
        return connectorFor(taskId).resolveTask(taskId, code);
    }

    conf.jobResult = getJobResult;
    conf.resolveJobResult = resolveJobResult;
    return conf;
}

exports.addJobResultFunctions = addJobResultFunctions;
