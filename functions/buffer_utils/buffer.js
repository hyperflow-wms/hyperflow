/**
 * Class used for buffering jobs - kind of agglomeration.
 */
class BufferCountWithTimeout {
  constructor(count, idleTimeoutMs, cb) {
    this.elements = []
    this.triggerCount = count;
    this.idleTimeoutMs = idleTimeoutMs;
    this.cb = cb;
    this._rescheduleTimeout();
  }

  addItem(item) {
    this.elements.push(item);
    if (this.elements.length >= this.triggerCount) {
      console.log("Running callback [reached count]");
      let elementsCopy = this.elements;
      this.elements = [];
      this.cb(elementsCopy);
    }
    this._rescheduleTimeout();
  }

  _rescheduleTimeout() {
    if (this.timeoutId) {
      clearInterval(this.timeoutId);
    }
    this.timeoutId = setTimeout(() => {
      console.log("Running callback [reached timeout]");
      let elementsCopy = this.elements;
      this.timeoutId = null;
      this.elements = [];
      this.cb(elementsCopy);
    }, this.idleTimeoutMs);
  }
}

/**
 * Testing function.
 * TODO: REMOVE
 */
async function testBuffer() {
  let fn = (items) => {
    console.log("Got from buffer:", items);
  }
  let test = new BufferCountWithTimeout(3, 1000, fn);
  test.addItem(1);
  test.addItem(2);
  test.addItem(3);
  test.addItem(4);
  test.addItem(5);

  await new Promise(resolve => setTimeout(resolve, 2000));

  test.addItem(6);
  test.addItem(7);
  test.addItem(8);
  test.addItem(9);
  test.addItem(10);
  test.addItem(12);
  test.addItem(13);
}

exports.BufferCountWithTimeout = BufferCountWithTimeout;
