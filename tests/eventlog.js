var eventServer = require('../eventlog')

exports.setUp = function(callback) {
    //get one instance of log server
    this.logServer = eventServer.createEventlog();

    callback();
}

exports.emit_simple_event = function(test) {
    this.eventServer.emit("trace.data", {'key': "value"});

    test.done();
}