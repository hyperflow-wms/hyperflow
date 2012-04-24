/*
Pegasus adag workflow representation parser

usage:
var parser = require('./adag_parser').init();
parser.parse('Workflow.xml');
*/
// for xml2js parser
var fs = require('fs'),
    xml2js = require('xml2js');
    
exports.init = function () {
    
    // for each element in array 'what' invoke 'cb' function
    // detects if what is an array - useful for processing xml2js output which
    // translates:
    // <a><b/><b/><a> --> array 'b'
    // <a><b/></a>    --> object 'b' 
    function foreach(what, cb) {
        function isArray(what) {
            return Object.prototype.toString.call(what) === '[object Array]';
        }
        
        if (isArray(what)) {
            for (var i=0, arr=what;i<what.length;i++) {
                cb(arr[i]);
            }
        } else {
            cb(what);   
        }
    }
    
    function parse(file, cb) {
       var parser = new xml2js.Parser();
       
       parser.on('end', function(result) {
           //var i, j, k, children, parents;
           var wf = result;
           var job_id = 0;
           
           // move info about parents to 'job' elements
           foreach(wf.job, function(job) {
               job['@'].job_id = ++job_id;
               foreach(wf.child, function(child) {
                   if (job['@'].id == child['@'].ref) { 
                       job['@'].parents = child.parent; // assumes that child element always has some parent(s)
                           
                       console.log(child['@'].ref);
                       foreach(child.parent, function(parent) {
                           console.log('    ' + parent['@'].ref);
                       });
                   }
               });
               
           });
           
           // create an  array of workflow data elements
           var found;
           wf.data = [];
           foreach(wf.job, function(job) {
               foreach(job.uses, function(job_data) {
                   found = undefined;
                   foreach(wf.data, function(data) {
                       if (data.name == job_data['@'].file && data.size == job_data['@'].size) { // assumption that if file name and size are the same, the file (data) is the same (no way of knowing this for sure based on the trace file)
                           found = data; // data element already in the array
                       }
                   });
                   if (!found) {
                       var idx = wf.data.push({'id': -1, 'name': job_data['@'].file, 'size': job_data['@'].size, 'from': [], 'to': []});
                       found = wf.data[idx-1]; 
                   }
                   if (job_data['@'].link == 'input') {
                           found.to.push({'job_name': job['@'].name, 'job_id': job['@'].job_id}); // task to which this data is passed to (if many -> partitioning)
                   } else {
                       found.from.push({'job_name': job['@'].name, 'job_id': job['@'].job_id});  // task from which this data is received from (if many -> aggregation)
                   }
               });
           });

           // assign identifiers to data elements
           var id = 1;
           foreach(wf.data, function(data) {
               data.id = id++;
           });
           
           // add data element id to each 'uses' element of each job
           foreach(wf.job, function(job) {
               foreach(job.uses, function(job_data) {
                   foreach(wf.data, function(data) {
                       if (data.name == job_data['@'].file && data.size == job_data['@'].size) {
                           job_data['@'].id = data.id;
                       }
                   });
               });
           });
           cb(wf);
        });
        
        fs.readFile(file, function(err, data) {
            if (err) throw err;
            parser.parseString(data);
        });
        
  }

  //public methods
  var that = {};
  that.parse = parse;
  return that;
};