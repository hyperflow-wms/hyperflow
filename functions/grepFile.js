var flr = require('./FileLineReader.js');

/*
 * ins[0].path: path to input file to perform grep on
 * ins[0]: string or regular expression to grep against
 * outs[0].path: path to output file in which results will be stored. 
 *   Format of output file: 
 *     - First line: original file path
 *     - Next lines: <line_number>:<line content>
 */
function grepFile(ins, outs, executor, config, cb) {
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

exports.grepFile = grepFile;
