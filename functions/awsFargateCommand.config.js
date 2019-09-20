exports.containerName = 'hyperflow';
exports.clusterArn = 'string';
exports.taskArn = 'string';
exports.subnets = ['string'];
exports.securityGroups = ['string'];
exports.influxdbHost = 'string';
exports.launchType = 'FARGATE';

exports.options = {
    bucket: 'string',
    prefix: 'string'
};

// extra labels provided to container in form of {key: value}
// use your own values
exports.extraLabels = {
    experiment: new Date().toISOString(),
    configId: 'string',
    workflow: 'string',
    ecsInfrastructure: 'string'
};

// task_executable_name : task_definition_name
exports.tasks_mapping = {
    'default': 'string'
};