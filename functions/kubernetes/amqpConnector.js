
const amqplib = require('amqplib'),
    createJobMessage = require('../../common/jobMessage').createJobMessage;

let conn = null;
let connPromise = null;
let channels = {};
let channelPromises = {};

async function getConnection() {
    if (conn) return conn;
    if (!connPromise) {
        console.log("[AMQP] Creating new connection...");
        connPromise = amqplib.connect(`amqp://${process.env.RABBIT_HOSTNAME}`, "heartbeat=60");
    }
    conn = await connPromise;
    return conn;
}

async function initialize(queue_name) {
    const connection = await getConnection();

    if (channels[queue_name]) return;

    if (!channelPromises[queue_name]) {
        channelPromises[queue_name] = (async () => {
            try {
                console.log(`[AMQP] Creating channel for queue ${queue_name}`);
                const ch = await connection.createChannel();
                await ch.assertQueue(queue_name, { durable: false, expires: 6000000 });
                channels[queue_name] = ch;
            } catch (err) {
                delete channelPromises[queue_name]; // retry logic
                throw err;
            }
        })();
    }

    await channelPromises[queue_name];
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
    let queue_name = getQueueName(context);
    try {
        await initialize(queue_name);
        let ch = channels[queue_name];

        console.log(`jobArr: ${JSON.stringify(jobArr)}, taskIdArr: ${JSON.stringify(taskIdArr)}, contextArr: ${JSON.stringify(contextArr)}, customParams: ${JSON.stringify(customParams)}`);
        let tasks = [];

        for (let i = 0; i < jobArr.length; i++) {
            let job = jobArr[i];
            let taskId = taskIdArr[i];
            let jobMessage = createJobMessage(job.ins, job.outs, contextArr[i], taskId);
            await context.sendMsgToJob(JSON.stringify(jobMessage), taskId); // TODO remove
            tasks.push({ "id": taskId, "message": jobMessage });
        }

        ch.sendToQueue(queue_name, Buffer.from(JSON.stringify({ 'tasks': tasks })));
    } catch (error) {
        console.log(error);
    }
}

exports.enqueueJobs = enqueueJobs
