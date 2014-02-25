var EventEmitter2 = require('eventemitter2').EventEmitter2

var EventServer = function () {
    this.server = new EventEmitter2({
        wildcard: true, // should the event emitter use wildcards.
        delimiter: '.', // the delimiter used to segment namespaces, defaults to `.`.
        newListener: false, // if you want to emit the newListener event set to true.
        maxListeners: 20 // the max number of listeners that can be assigned to an event, defaults to 10.
    });
};

EventServer.prototype.emit = function () {
    var args = Array.prototype.slice.call(arguments);
    args.splice(1, 0, new Date().toISOString());
    this.server.emit.apply(this.server, args);
};

EventServer.prototype.on = function (ev, listener) {
//    this.server.on(ev, listener);
    this.server.on(ev, listener);
};

function createEventServer() {
    var eventServer = new EventServer();

// this object is exported as the API of the event logger (hides implementation) is it really needed?
    var eventLog = {
        emit: function () {
            eventServer.emit.apply(eventServer, arguments)
        },
        on: function () {
            eventServer.on.apply(eventServer, arguments)
        }
    };

// Here's how to subscribe to events:
    eventLog.on('trace.*', function (data) {
        // "this.event" contains the full event name
        console.log("EVENT:", this.event, JSON.stringify(arguments, null, 2));
    });
    return eventLog;
}

exports.createEventServer = createEventServer;

// Example use of the event logger from another module:
// eventlog = require('../eventlog').createEventLog()
//
// //embedd eventlog in well known place, then call
//
// eventlog.emit('trace.invokingFunction', {"appId": wfId, "procId": procId });
//
// We should agree on a set of standard fields that allow one to "correlate" the event, such as:
// - appId    - unique id of the workflow instance
// - procId   - process id (if the event is related to a process)
// - firingId - number of firing of the process (if the event is related to a particular firing)
// - sigId    - signal id (if the event is related to a signal)
// - time     - time stamp