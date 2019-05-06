exports.containerName = 'string';
exports.clusterArn = 'string';
exports.taskArn = 'string';
exports.subnets = ['string'];
exports.securityGroups = ['string'];
exports.assignPublicIp = 'string';
exports.pushgatewayUrl = 'string';

exports.options = {
    'storage': 'string',
    'bucket': 'string',
    'prefix': 'string'
};

// extra labels supplied to container in form of {key: value}
exports.extraLabels = {
    labelName: 'string'
};

// task_executable_name : task_definition_name
exports.tasks_mapping = {
    "default": "string"
};