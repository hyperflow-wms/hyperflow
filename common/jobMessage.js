/** 
 * Create a job message (string) to be sent to a remote executor
 * 
 * @param ins                   - passed from task function
 * @param outs                  - passed from task function
 * @param context               - passed from task function
 * @param {string} customTaskId - optional custom task identifier
 * 
 */
var createJobMessage = function(ins, outs, context, customTaskId) {
    let jobMessageJSON = context.executor;

    jobMessageJSON.inputs = ins.map(i => i);
    jobMessageJSON.outputs = outs.map(o => o);
    jobMessageJSON["input_dir"] = context.executor.input_dir;
    jobMessageJSON["work_dir"] = context.executor.work_dir;
    jobMessageJSON["output_dir"] = context.executor.output_dir;
    jobMessageJSON.stdout = context.executor.stdout; // if present, denotes file name to which stdout should be redirected
    jobMessageJSON.stderr = context.executor.stderr; // if present, denotes file name to which stderr should be redirected
    jobMessageJSON["redis_url"] = context.redis_url;
    jobMessageJSON.taskId = customTaskId || context.taskId; 
    jobMessageJSON.name = context.name; // domain-specific name of the task
    jobMessageJSON.stdoutAppend = context.executor.stdoutAppend; // if present, redirect stdout in append mode
    jobMessageJSON.stderrAppend = context.executor.stderrAppend; // if present, redirect stderr in append mode

    return jobMessageJSON;
}

exports.createJobMessage = createJobMessage;