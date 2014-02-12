var functions = require('../functions')

exports.test_function_notifyevents = function(test) {
    var ins = [],
        outs = [];
    var config = {
      executor: {
          executable: "ls",
          args: "-la"
      }
    };
    var cb = function(exceptions, outs) {

    };
    functions.command_print(ins, outs, config, cb);

    test.done()
}
