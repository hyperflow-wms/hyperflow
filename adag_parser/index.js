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
    
    function parse(file, wfname, baseUrl, cb) {
       var parser = new xml2js.Parser();
       
       parser.on('end', function(result) {
           //var i, j, k, children, parents;
           var wf = result;
           var job_id = 0;
           
           // move info about parents to 'job' elements
           foreach(wf.job, function(job) {
               job['@'].status = 'waiting'; // initial status of all jobs - waiting for input data
               job['@'].job_id = ++job_id; 
               job['@'].uri = baseUrl + '/workflow/'+wfname+'/task-'+job_id;
               foreach(wf.child, function(child) {
                   if (job['@'].id == child['@'].ref) { 
                       job['@'].parents = child.parent; // assumes that child element always has some parent(s)
                           
                       /*console.log(child['@'].ref);
                       foreach(child.parent, function(parent) {
                           console.log('    ' + parent['@'].ref);
                       });*/
                   }
               });
               
           });
           
           // create an  array of workflow data elements
           var found, idx;
           wf.data = [];
           foreach(wf.job, function(job) {
               foreach(job.uses, function(job_data) {
                   job_data['@'].status = 'not_ready';
                   if (job_data['@'].link == 'output') {
                       idx = wf.data.push({
                           'id': -1,
                           'name': job_data['@'].file,
                           'size': job_data['@'].size,
                           'from': [],
                           'to': []
                       });
                       wf.data[idx-1].from.push({
                           'job_name': job['@'].name,
                           'job_id': job['@'].job_id,
                           'job_uri': job['@'].uri
                       }); // task from which this data is received
                   }
               });
           });           
           foreach(wf.job, function(job) {
               foreach(job.uses, function(job_data) {
                   if (job_data['@'].link == 'input') {
                       found = undefined;
                       foreach(wf.data, function(data) {
                           if (data.name == job_data['@'].file /* && data.size == job_data['@'].size */ ) { // assumption that if file name and size are the same, the file (data) is the same (no way of knowing this for sure based on the trace file)
                               found = data; // data element already in the array
                           }
                       });
                       if (!found) {
                           idx = wf.data.push({
                               'id': -1,
                               'name': job_data['@'].file,
                               'size': job_data['@'].size,
                               'from': [],
                               'to': []
                           });
                           found = wf.data[idx - 1];
                       }
                       found.to.push({
                           'job_name': job['@'].name,
                           'job_id': job['@'].job_id,
                           'job_uri': job['@'].uri
                       }); // task to which this data is passed 
                   }
               });
           });
           
/*           foreach(wf.job, function(job) {
               foreach(job.uses, function(job_data) {
                   job_data['@'].status = 'not_ready';
                   found = undefined;
                   foreach(wf.data, function(data) {
                       if (data.name == job_data['@'].file && data.size == job_data['@'].size ) { // assumption that if file name and size are the same, the file (data) is the same (no way of knowing this for sure based on the trace file)
                           found = data; // data element already in the array
                       }
                   });
                   if (!found) {
                       var idx = wf.data.push({'id': -1, 'name': job_data['@'].file, 'size': job_data['@'].size, 'from': [], 'to': []});
                       found = wf.data[idx-1]; 
                   }
                   if (job_data['@'].link == 'input') {
                           found.to.push({'job_name': job['@'].name, 'job_id': job['@'].job_id, 'job_uri': job['@'].uri}); // task to which this data is passed to (if many -> partitioning)
                   } else {
                       found.from.push({'job_name': job['@'].name, 'job_id': job['@'].job_id, 'job_uri': job['@'].uri});  // task from which this data is received from (if many -> aggregation)
                   }
               });
           });
*/
           // assign identifiers and URIs to data elements
           var id = 0;
           foreach(wf.data, function(data) {
               data.id = ++id;
               data.uri = baseUrl + '/workflow/'+wfname+'/data-'+id;
           });
           
           // add data element id and uri to each 'uses' element of each job
           foreach(wf.data, function(data) {
               foreach (data.to, function(job_input) {
                   foreach(wf.job[job_input.job_id-1].uses, function(job_data) {
                       if (job_data['@'].link == 'input' && job_data['@'].file == data.name) {
                           job_data['@'].id = data.id;
                           job_data['@'].uri = data.uri;
                       }
                   });
               });
               foreach (data.from, function(job_input) {
                   foreach(wf.job[job_input.job_id-1].uses, function(job_data) {
                       if (job_data['@'].link == 'output' && job_data['@'].file == data.name) {
                           job_data['@'].id = data.id;
                           job_data['@'].uri = data.uri;
                       }
                   });
               });
           });
           
           /*foreach(wf.job, function(job) {
               foreach(job.uses, function(job_data) {
                   foreach(wf.data, function(data) {
                       if (data.name == job_data['@'].file  && data.size == job_data['@'].size ) {
                           job_data['@'].id = data.id;
                           job_data['@'].uri = data.uri;
                       }
                   });
               });
           });*/
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