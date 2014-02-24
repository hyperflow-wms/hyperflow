var EventEmitter2 = require('eventemitter2').EventEmitter2,
    server = new EventEmitter2({
      wildcard: true, // should the event emitter use wildcards.
      delimiter: '.', // the delimiter used to segment namespaces, defaults to `.`.
      newListener: false, // if you want to emit the newListener event set to true.
      maxListeners: 20 // the max number of listeners that can be assigned to an event, defaults to 10.
    });

function emit(ev, data) {
    data.time = new Date().toISOString(); // automatically add a timestamp to event data
    server.emit(ev, data);
}

function on(ev, listener) {
    server.on(ev, listener);
}   

// this object is exported as the API of the event logger (hides implementation)
var eventlog = {
    emit: emit,
    on: on
}

// Here's how to subscribe to events:
server.on('trace.*', function(data) {
    console.log(arguments);
    // "this.event" contains the full event name
    console.log("EVENT:", this.event, JSON.stringify(data, null, 2));
});

exports.eventlog = eventlog;

// Example use of the event logger from another module:
// eventlog = require('../eventlog').eventlog,
// ...
// eventlog.emit('trace.invokingFunction', {"appId": wfId, "procId": procId });
//
// We should agree on a set of standard fields that allow one to "correlate" the event, such as:
// - appId    - unique id of the workflow instance
// - procId   - process id (if the event is related to a process)
// - firingId - number of firing of the process (if the event is related to a particular firing)
// - sigId    - signal id (if the event is related to a signal)
// - time     - time stamp 
