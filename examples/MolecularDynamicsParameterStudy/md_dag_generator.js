////////////////////////////////////////////////////////////////////////////////////
//
//  Creates a parameter-study molecular dynamics workflow.
//  It runs the same simulation for different temperatures
//  The DAG has the parallel form:
//
//         run  run  run
//
//          |    |    |
//          v    v    v
//
//       movie movie movie
//
//
// 1. "run" executes run-cmd-openmp.sh and produces a tarball with ouputs
// 2. "movie" generates AVI file from the tarball using make-movie.sh
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

function createWf(functionName, molecules, end_time, temperatureArray) {
  
  var wfOut = {
    processes: [],
    signals: [],
    ins: ["start"],
    outs: []
  };
  

  
  //create run-cmd-openmp tasks
  for (i=0; i<temperatureArray.length; i++) {
    temperature = temperatureArray[i]
    output = "psp-output-" + temperature + ".tgz"
    wfOut.processes.push(
      task("run-cmd-openmp-" + temperature, functionName, "./run-cmd-openmp.sh", [molecules, end_time, temperature], ["start"], [output])
    );      
  }

  
  //create make-movie tasks
  for (i=0; i<temperatureArray.length; i++) {
    temperature = temperatureArray[i]
    input = "psp-output-" + temperature + ".tgz"
    output = "psp-output-" + temperature + ".avi"
    wfOut.processes.push(
      task("make-movie-" + temperature, functionName, "./make-movie.sh", [input, output], [input], [output])
    );      
  }
  
  wfOut.signals.push({"name": "start"})
  wfOut.signals[0].data = ["start"]

  for (i=0; i<temperatureArray.length; i++) {
    temperature = temperatureArray[i]
    input = "psp-output-" + temperature + ".tgz"
    output = "psp-output-" + temperature + ".avi"
    wfOut.signals.push({name: input});
    wfOut.signals.push({name: output});
    wfOut.outs.push(output);    
  }
  
  

  // output workflow json to stdout
  console.log(JSON.stringify(wfOut, null, 2));
  
}

if (!argv._[3]) {
  console.log("Usage: node md_dag_generator.js molecules min_temperature max_temperature step");
  process.exit();
}

//FIXME: this could be also a parameter
var end_time = 0.5

var molecules =  argv._[0]
var min_temperature = argv._[1]
var max_temperature  = argv._[2]
var step = argv._[3]

var temperatureArray = []

for (temperature = min_temperature; temperature <= max_temperature; temperature += step) {
  temperatureArray.push(temperature)
}
createWf("command", molecules, end_time, temperatureArray);
