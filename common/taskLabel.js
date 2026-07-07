/**
 * Format a task ID for logging, appending its job/task type name when known.
 *
 * @param {string} taskId task ID
 * @param {string} [name] domain-specific task/job type name (e.g. "mProject")
 */
var taskLabel = function(taskId, name) {
    return name ? `${taskId} (${name})` : taskId;
}

exports.taskLabel = taskLabel;
