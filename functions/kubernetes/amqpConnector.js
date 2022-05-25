const amqplib = require('amqplib'),
    createJobMessage = require('../../common/jobMessage').createJobMessage;
let channels = {};
let conn = null;

async function initialize(queue_name) {

    if (conn === null) {
        conn = await amqplib.connect(`amqp://${process.env.RABBIT_HOSTNAME}`, "heartbeat=60");
    }
    let ch = await conn.createChannel()
    await ch.assertQueue(queue_name, {durable: false, expires: 600000}); // TODO: implement dynamic queue creation & cleanup
    channels[queue_name] = ch

}

async function enqueueJobs(jobArr, taskIdArr, contextArr, customParams) {
    let context = contextArr[0];
    let namespace = process.env.HF_VAR_NAMESPACE || 'default'
    let queue_name = namespace + "." + context['name']
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