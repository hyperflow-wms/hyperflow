////////////////////////////////////////////////////////////////////////////////////
//
//  Creates example fork-sleep-join workflow of DAG type.
//
//             fork
//
//           /   |   \
//           
//        sleep sleep sleep ...
//
//           \   |   /
//
//              fork
//
//
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
    "firingLimit": 1,
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
  
  // create fork task
  var outs = [];
  for (i=1; i<=steps; i++) { outs.push(i); }
  
  wfOut.processes.push(
    task("fork", functionName, "echo", ["Starting parallel sleeps"], [0], outs)
  );      

  
  //create sleep tasks
  for (i=0; i<steps; i++) {
    wfOut.processes.push(
      task("sleep" + i, functionName, "sleep", [i+1], [i+1], [i+steps+1])
    );      
  }
  
  //create join task  
  var ins = [];
  for (i=1; i<=steps; i++) { ins.push(steps+i); }
 
  wfOut.processes.push(
    task("join", functionName, "echo", ["join complete"], ins, [2*steps+1])
  );      
  
  // create data array with file names
  var signals = []
  signals.push("0");  
  signals = signals.concat(outs);
  signals = signals.concat(ins);
  signals.push(2*steps+1)

  wfOut.signals.push({name: signals[0], data: [signals[0]]});
  for (i=1; i<signals.length; i++) {
    wfOut.signals.push({name: signals[i]});
  }
  
  
  // output workflow json to stdout
  console.log(JSON.stringify(wfOut, null, 2));
  
}

if (!argv._[0]) {
  console.log("Usage: node sleep_generator.js steps");
  process.exit();
}

//createWf("amqpCommand", argv._[0]);
createWf("command", argv._[0]);
