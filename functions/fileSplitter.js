var flr = require('./FileLineReader.js');

var readers = {};

function fileSplitter(ins, outs, executor, config, cb) {
    var fname = ins[0].value;
    if (!(fname in readers)) {
        readers[fname] = new flr.FileLineReader(fname);
    }
    var reader = readers[fname];
    if (reader.hasNextLine()) {
        outs[0].value = reader.nextLine();
        cb(null, outs);
    } else {
        reader.close(function() {
            delete reader;
            delete readers[fname];
            cb(null, null);
        });
    }
}

exports.fileSplitter = fileSplitter;
