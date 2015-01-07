////////////////////////////////////////////////////////////////////////////////////
//
//  Creates example split-parallel-join workflow of DAG type.
//
//             split
//
//           /   |   \
//           
//        gzip gzip gzip ...
//
//           \   |   /
//
//              tar
//
//
// 1. Split reads /etc/passwd and splits it into files file.000000, file.000001, etc.
// 2. Gzip compresses each file into file.gz, e.g. file.000000 -> file.000000.gz
// 3. Tar creates a tarball with all gzipped files -> tarball.tarball
//
// Note: this a contrived example, since normally you use tar first and then gzip it.
//
//////////////////////////////////////////////////////////////////////////////////////


var
argv = require('optimist').argv;


// convert number to string with leading zeros, e.g. 0001, 0002, etc.
function pad (str, max) {
  str = str.toString();
  return str.length < max ? pad("0" + str, max) : str;
}

// create task object
function task(name, functionName, executable, args, ins, outs) {
  return {
    "name": name,
    "function": functionName,
    "type": "dataflow",
//    "firingLimit": 1,
    "config": {
      "executor": {
//        "queue_name": "test1",
	"executable": executable,
	"args": args
      }
    },
    "ins": ins,
    "outs": outs
  }
}  

function createWf(functionName, steps) {
  
  var wfOut = {
    processes: [],
    signals: [],
    ins: [0],
    outs: [2*steps+1]
  };
  
  // create split task
  var outs = [];
  for (i=1; i<=steps; i++) { outs.push(i); }
  
  wfOut.processes.push(
    task("split", functionName, "split", ["-d", "-a", 6, "-n", steps, "/etc/passwd", "file."], [0], outs)
  );      


  // prepare file names
  var files = [];
  for (i=0; i<steps; i++) { files.push("file." + pad(i,6)); }
  var filesGz = []
  for (i=0; i<steps; i++) { filesGz.push(files[i]+".gz"); }
  
  //create gzip tasks
  for (i=0; i<steps; i++) {
    wfOut.processes.push(
      task("gzip" + i, functionName, "gzip", ["-f", files[i]], [i+1], [i+steps+1])
    );      
  }
  
  //create tar task  
  var ins = [];
  for (i=1; i<=steps; i++) { ins.push(steps+i); }
 
  wfOut.processes.push(
    task("tar", functionName, "tar", ["cvf", "tarball.tar"].concat(filesGz), ins, [2*steps+1])
  );      
  
  // create data array with file names
  var signals = []
  signals.push("/etc/passwd");  
  signals = signals.concat(files);
  signals = signals.concat(filesGz);
  signals.push("tarball.tar");  

  for (i=0; i<signals.length; i++) {
    wfOut.signals.push({name: signals[i]});
  }
  
  wfOut.signals[0].data = ["/etc/passwd"]
  
  // output workflow json to stdout
  console.log(JSON.stringify(wfOut, null, 2));
  
}

if (!argv._[0]) {
  console.log("Usage: node gzip_dag_generator.js steps");
  process.exit();
}

//createWf("amqpCommand", argv._[0]);
createWf("command", argv._[0]);
