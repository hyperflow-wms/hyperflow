var Buffer = require('./buffer.js').BufferCountWithTimeout;

/**
 * Class used to store multiple buffers and add items to them
 * according to specified configuration.
 */
class BufferManager {
  constructor(cb) {
    this.buffers = []
    this.taskBufferMap = {}
    this.configured = false;
    this.cb = cb;
  }

  setCallback(cb) {
    if (this.cb != undefined) {
      throw Error("Callback is already set");
    }
    this.cb = cb;
    return;
  }

  isConfigured() {
    return this.configured;
  }

  configure(buffersConf) {
    /** Configuration cannot be executed more than once. */
    if (this.configured == true) {
      throw Error("BufferManager can be configured only once");
    }
    this.configured = true;

    /** Parse configuration. */
    if (Array.isArray(buffersConf) == false) {
      throw Error("Buffers configuration should be an array");
    }
    for (let i = 0; i < buffersConf.length; i++) {
      let matchTask = buffersConf[i]['matchTask'];
      let size = buffersConf[i]['size'];
      let timeoutMs = buffersConf[i]['timeoutMs'];
      if (matchTask == undefined || size === undefined || timeoutMs == undefined) {
        throw Error("Following keys are required: matchTask, size, timeoutMs");
      }
      let res = this.buffers.push(new Buffer(size, timeoutMs, this.cb));
      let buffIndex = res - 1;

      /** Build map of taskName -> bufferId. */
      for (let j = 0; j < matchTask.length; j++) {
        let taskName = matchTask[j];
        if (this.taskBufferMap[taskName] != undefined) {
          console.log("WARNING: task", taskName, "is already matched in another buffer, ignoring");
          continue;
        }
        this.taskBufferMap[taskName] = buffIndex;
      }
    }

    return;
  }

  addItem(taskName, item) {
    let bufferId = this.taskBufferMap[taskName];
    /** If task is not buffered, then execute callback immediately. */
    if (bufferId == undefined) {
      this.cb([item]);
      return;
    }

    /** Buffering item. */
    this.buffers[bufferId].addItem(item);

    return;
  }
}

async function testBufferManager() {
  let cb = (items) => {
    console.log("Got from buffer:", items);
  }
  buffersConf = [
    {
      matchTask: ['job_a', 'job_b'],
      size: 2,
      timeoutMs: 3000,
    },
    {
      matchTask: ['job_b', 'job_c'],
      size: 3,
      timeoutMs: 2500,
    },
  ];
  let test = new BufferManager(cb)
  test.configure(buffersConf);
  test.addItem('job_a', 1);
  test.addItem('job_a', 2);
  test.addItem('job_b', 3);
  test.addItem('job_b', 4);
  test.addItem('job_b', 5);

  await new Promise(resolve => setTimeout(resolve, 6000));

  test.addItem('job_a', 6);
  test.addItem('job_c', 7);
  test.addItem('job_c', 8);
}

exports.BufferManager = BufferManager;
