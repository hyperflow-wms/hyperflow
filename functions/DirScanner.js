var fs = require('fs'),
    async = require('async'),
    walk = require('walkdir'),
    path = require('path');

/*
 * Scans a directory tree and returns files matching a regular expression.
 * @fileOut: if not null, should contain a file path where the results will be stored
 * @done: callback function with two parameters: (err, results)
 */
function scanDir(dir, regex, fileOut, done) {
    if (fileOut) {
        var fdOut = fs.createWriteStream(fileOut, {flags: 'w', encoding: 'ascii', mode:'0667' });
        fdOut.on('open', function(fd) {
            walkDir(dir, regex, fdOut, done);
        });
    } else {
        walkDir(dir, regex, null, done);
    }
}


function walkDir(dir, regex, fdOut, done) {
    var finder = walk(dir);
    var results = [];

    finder.on('file', function(file, stat) {
        if (!regex || (regex && file.match(regex))) {
            results.push(file);
            if (fdOut) {
                fdOut.write(file + '\n');
            }
        }
    });

    finder.on('end', function(file, stat) {
        if (fdOut) {
            fdOut.end(function() {
                done(null, results);
            });
        } else {
            done(null, results);
        }
    });
}



exports.scanDir = scanDir;

/*scanDir('..', /index.js$/, 'results.txt', function(err, result) {
	console.log(result);
});*/
