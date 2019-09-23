var nconf = require('nconf'),
    fs = require('fs'),
    path = require('path');

// Function useful for testing:
// - only prints commands to be executed
// - creates a unique working directory for a given workflow run
// - creates (empty) output files in the working directory
// - tests if all required input files are present
// - assumes that (empty) input files are in <workflow_dir>/input_dir
// Configuration:
// - TODO: support a local file "commandLocalMock.config.json" using 'nconf'
function commandLocalMock(ins, outs, context, cb) {

  // 1. check if all input files exist
  ins.forEach(function(input) {
    var fpath;
    if (input.workdir) { // we assume that if there is no workdir, the file is located in 'input_dir'
        fpath = path.join(input.workdir, input.name); 
    } else {
        fpath = path.join('input_dir', input.name);
    }

    if (!fs.existsSync(fpath)) {
        throw(new Error("Required input file does not exist:" + fpath));
    }
    console.log(input.name);
  });

  // 2. 'Run' the command
  var exec = context.executor.executable,
      args = context.executor.args.join(' ');

  console.log(exec, args);

  // 3. 'Create' output files
  // TODO: get the location of workdir from the config file
  var work_dir = 'work_dir_' + context.hfId + '_' + context.appId;
  if (!fs.existsSync(work_dir)) {
    fs.mkdirSync(work_dir);
  }

  outs.forEach(function(out) {
    out.workdir = work_dir; // add file location to the output signal
    fpath = path.join(work_dir, out.name);
    // create an empty file 
    var fd = fs.openSync(fpath, 'w');
  });
  
  console.log(outs);
  cb(null, outs);
}

exports.commandLocalMock = commandLocalMock;
