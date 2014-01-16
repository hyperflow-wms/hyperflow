var walk = require('walkdir');	

/*
 * Scans a directory tree and returns files matching a regular expression.
 */
function scanDir(ins, outs, config, cb) {
	if (ins[0].data.length == 0)
    	return cb(null, outs); 
  	console.log("Scan dir: ", ins[0].data[0]);
  	var path = ins[0].data[0].value;
	var regex = new RegExp(ins[1].data[0].value);

	outs[0].data = [];
	outs[1].data = [];
    
	walkDir(path, regex, function(err, results) {
		if(err) {
			cb(err);
		}
		else {
			for(var i=0; i<results.length; i++) {
        		outs[0].data.push({ "value": results[i] });				
			}
			outs[1].data.push({ "value": results.length });
			cb(null, outs);
		}
	});
}

function walkDir(dir, regex, done) {
    var finder = walk(dir);
	var results = [];

    finder.on('file', function(file, stat) {
        if (!regex || (regex && file.match(regex))) {			
        	results.push(file);
        }
    });

    finder.on('end', function(file, stat) {
        done(null, results);
    });
}

exports.scanDir = scanDir;

