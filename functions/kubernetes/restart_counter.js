/**
 * Class used for counting job restarts.
 */
class RestartCounter {
  constructor(backoffLimit) {
    this.backoffLimit = backoffLimit;
    this.counters = {}
  }

  isRestartPossible(item) {
    let counter = this.counters[item];
    if (counter == undefined && this.backoffLimit > 0) {
      return true;
    }
    let possible = counter < this.backoffLimit;
    return possible;
  }

  increase(item) {
    if (this.counters[item] == undefined) {
      this.counters[item] = 0;
    }
    this.counters[item] += 1;
    let counterVal = this.counters[item];
    return counterVal;
  }
}


/**
 * Testing function.
 * TODO: REMOVE
 */
const assert = require('assert');
async function testRestartCounter() {
  let test = new RestartCounter(2);

  assert.strictEqual(test.isRestartPossible("item1"), true);
  assert.strictEqual(test.increase("item1"), 1);
  assert.strictEqual(test.isRestartPossible("item1"), true);
  assert.strictEqual(test.increase("item1"), 2);
  assert.strictEqual(test.isRestartPossible("item1"), false);

  assert.strictEqual(test.isRestartPossible("item2"), true);
  assert.strictEqual(test.increase("item2"), 1);
  assert.strictEqual(test.isRestartPossible("item2"), true);
  assert.strictEqual(test.increase("item2"), 2);
  assert.strictEqual(test.isRestartPossible("item2"), false);

  let test2 = new RestartCounter(0);
  assert.strictEqual(test2.isRestartPossible("item1"), false);
  assert.strictEqual(test2.increase("item1"), 1);
  assert.strictEqual(test2.isRestartPossible("item1"), false);
  assert.strictEqual(test2.isRestartPossible("item2"), false);
  assert.strictEqual(test2.increase("item2"), 1);
  assert.strictEqual(test2.isRestartPossible("item2"), false);
}

exports.RestartCounter = RestartCounter;
