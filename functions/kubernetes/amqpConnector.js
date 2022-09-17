const amqplib = require('amqplib'),
    createJobMessage = require('../../common/jobMessage').createJobMessage;
let channels = {};
let conn = null;

async function initialize(queue_name) {

    if (conn === null) {
        conn = await amqplib.connect(`amqp://${process.env.RABBIT_HOSTNAME}`, "heartbeat=60");
    }
    let ch = await conn.createChannel()
    await ch.assertQueue(queue_name, {durable: false, expires: 6000000});
    channels[queue_name] = ch

}

function getQueueName(context) {
    if ("executionModels" in context.appConfig) {
        for (const taskType of context.appConfig.executionModels) {
            if (taskType.name === context['name']) {
                if ("queue" in taskType) {
                    return taskType.queue;
                }
            }
        }
    }
    let namespace = process.env.HF_VAR_NAMESPACE || 'default'
    return namespace + "." + context['name']
}

async function enqueueJobs(jobArr, taskIdArr, contextArr, customParams) {
    let context = contextArr[0];
    let queue_name = getQueueName(context)
    if (conn === null || !(queue_name in channels)) {
        await initialize(queue_name)
    }
    let ch = channels[queue_name]
    try {

        console.log(`jobArr: ${JSON.stringify(jobArr)}, taskIdArr: ${JSON.stringify(taskIdArr)}, contextArr: ${JSON.stringify(contextArr)}, customParams: ${JSON.stringify(customParams)}`)
        let tasks = [];

        for (let i = 0; i < jobArr.length; i++) {
            let job = jobArr[i];
            let taskId = taskIdArr[i];
            let jobMessage = createJobMessage(job.ins, job.outs, contextArr[i], taskId);
            await context.sendMsgToJob(JSON.stringify(jobMessage), taskId) // TODO remove
            tasks.push({"id": taskId, "message": jobMessage});
        }

        await ch.publish('', queue_name, Buffer.from(JSON.stringify({'tasks': tasks})));
    } catch (error) {
        console.log(error)
    }
}

exports.enqueueJobs = enqueueJobs