exports.cluster_arn = "arn:aws:ecs:us-east-1:12345678:cluster/ClusterName";
exports.subnet_1 = "subnet-ID";
exports.metrics = false;

exports.options = {
    "bucket": "BUCKET-ID",
    "prefix": "PREFIX"
};

// task_executable_name : task_definition_name
exports.tasks_mapping = {
    "default":"arn:aws:ecs:us-east-1:TASK-DEFINITION-ARN",
};
