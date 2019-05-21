exports.cluster_arn = "string";
exports.subnet_1 = "string";
exports.subnet_2 = "string";
exports.metrics = true || false;

exports.options = {
    "storage": "S3",
    "bucket": "string",
    "prefix": "string"
};

// task_executable_name : task_definition_name
exports.tasks_mapping = {
    "default": "string"
};