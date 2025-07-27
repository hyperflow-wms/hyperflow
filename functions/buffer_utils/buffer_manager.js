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

  createAndMapTaskBuffer(matchTask, size, timeoutMs, partition) {
    let res = this.buffers.push(new Buffer(size, timeoutMs, this.cb));
    let buffIndex = res - 1;

    /** Build map of taskName -> bufferId. */
    for (let j = 0; j < matchTask.length; j++) {
      let taskName = matchTask[j];
      let taskNameWithPartition = taskName + (partition ? "#" + partition : "");
      //console.log("taskNameWithPartition:", taskNameWithPartition);
      if (this.taskBufferMap[taskNameWithPartition] != undefined) {
        console.log("WARNING: task", taskNameWithPartition, "is already matched in another buffer, ignoring");
      } else {
        this.taskBufferMap[taskNameWithPartition] = buffIndex;
      }
    }
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
        throw Error("The following keys are required: matchTask, size, timeoutMs");
      }

      let partitions = buffersConf[i].partitions;
      if (partitions > 1) {
        for (let p=1; p<=partitions; p++) {
          this.createAndMapTaskBuffer(matchTask, size, timeoutMs, p);
        }
      } else {
        this.createAndMapTaskBuffer(matchTask, size, timeoutMs);
      }
    }

    return;
  }

  /**
   * @partition (integer 1..N, optional): used when workflow tasks are distributed 
   * among 2+ clusters (cloud bursting) (partition = cluster id). When task partitioning 
   * is enabled, agglomeration must be done within partitions. 
   */
  addItem(taskName, item, partition) {
    let taskNameWithPartition = taskName + (partition ? "#" + partition: "");
    //console.log(taskNameWithPartition);
    let bufferId = this.taskBufferMap[taskNameWithPartition];
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
      size: 3,
      timeoutMs: 3000,
      partitions: 2
    },
    {
      matchTask: ['job_b', 'job_c'],
      size: 3,
      timeoutMs: 2500,
      partitions: 2
    },
  ];
  let test = new BufferManager(cb)
  test.configure(buffersConf);
  test.addItem('job_a', 1, 1);
  test.addItem('job_a', 2, 2);
  test.addItem('job_b', 3, 1);
  test.addItem('job_b', 4, 1);
  test.addItem('job_b', 5, 2);

  await new Promise(resolve => setTimeout(resolve, 6000));

  test.addItem('job_a', 6, 1);
  test.addItem('job_c', 7, 1);
  test.addItem('job_c', 8, 2);
}

exports.BufferManager = BufferManager;
