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
    
    function isArray(what) {
        return Object.prototype.toString.call(what) === '[object Array]';
    }

    // for each element in array 'what' invoke 'cb' function
    // detects if what is an array - useful for processing xml2js output which
    // translates:
    // <a><b/><b/><a> --> array 'b'
    // <a><b/></a>    --> object 'b' 
    function foreach(what, cb) {
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
           
           foreach(wf.job, function(job) {
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
           
           /*for(i=0,jobs=wf.job;i<jobs.length;i++) { 
               for(j=0,children=wf.child;j<children.length;j++) {
                   if (jobs[i]['@'].id == children[j]['@'].ref) {
                       console.log(children[j]['@'].ref);
                       for(k=0,parents=children[j].parent;k<parents.length;k++){
                           console.log('   ' + parents[k]['@'].ref);
                       }
                   }
               }
           }*/
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