/*
** HyperFlow engine
** Author: Bartosz Balis (2012-2014)
**
** HyperFlow server implementing the REST API for HyperFlow workflows.
*/

'use strict';

/**
 * Module dependencies.
 */


var redisURL = process.env.REDIS_URL ? {url: process.env.REDIS_URL} : undefined;
// for express
var express = require('express'),
    cons = require('consolidate'),
    spawn = require('child_process').spawn,
    http = require('http'),
    os = require('os'),
    fs = require('fs'),
    which = require('which'),
    pathtool = require('path'),
    AdmZip = require('adm-zip'),
    app = express();

var redis = require('redis'),
    rcl = redisURL ? redis.createClient(redisURL): redis.createClient();

var server = http.createServer(app);
var wflib = require('../wflib').init(rcl);
var plugins = [];
var Engine = require('../engine2');
var engine = {}; // engine.i contains the engine object for workflow instance 'i'
var request = require('request');

var timers = require('timers');


//var $ = require('jquery');

var _ = require('underscore');

// global data
var contentType = 'text/html';
//var baseUrl = 'http://localhost:'+process.env.PORT;
var baseUrl = ''; // with empty baseUrl all links are relative; I couldn't get hostname to be rendered properly in htmls

// Configuration
app.configure(function() {
        //app.use(express.compress());
	app.engine('ejs', cons.ejs);
	app.set('views', __dirname + '/views');
	app.set('view engine', 'ejs');
	app.use(express.bodyParser({strict: false}));
	app.use(express.methodOverride());
	app.use(app.router);
	app.use(express.static(__dirname + '/public'));
	app.disable('strict routing');
});

app.configure('development', function() {
	app.use(express.errorHandler({
		dumpExceptions: true,
		showStack: true
	}));
});

app.configure('production', function() {
	app.use(express.errorHandler());
});

/////////////////////////////////////////////////////////////////
////           REST API for HyperFlow workflows              ////
/////////////////////////////////////////////////////////////////

// returns a list of all workflow instances (aka 'apps')
app.get('/apps', function(req, res) {
    var renderHTML = function() {
        var ctype = acceptsXml(req);
        res.header('content-type', ctype);
        res.send('GET /apps');
        //res.render ... TODO
    }
    var renderJSON = function() {
        res.header('content-type', 'text/plain');
        res.send('GET /apps');
        // res.render ... TODO
    }
    res.format({
        'text/html': renderHTML,
        'application/json': renderJSON
    });
});

// creates a new workflow instance ('app')
// body can be:
// - a valid workflow description in JSON
// - or a complete workflow directory packed as zip
// FIXME: validate workflow description
// FIXME: add proper/more detailed error info instead of "badRequest(res)"
app.post('/apps', function(req, res) {
    var ctype = req.headers["content-type"];

    function makeId6() {
	var id = [];
	var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

	for (var i=0; i<6; i++ ) {
	    id[i] = possible.charAt(Math.floor(Math.random() * possible.length));
	}

	return id.join("");
    }

    var runWorkflow = function(wfDir, appId) {
	var config = {"emulate":"false", "workdir": wfDir};
	engine[appId] = new Engine(config, wflib, appId, function(err) {
	    if (err) return badRequest(res);
		plugins.forEach(function(plugin) {
			plugin.init(rcl, wflib, engine[appId]);
		});
	    engine[appId].runInstance(function(err) {
		if (err) return badRequest(res);
		res.header('Location', req.url + '/' + appId);
		res.send(201, null);
		//res.redirect(req.url + '/' + appId, 302);
		// TODO: implement sending all input signals (just like -s flag in runwf.js)
	    });
	});
    }

    var hfid = wflib.hfid, tmpdir = pathtool.join(os.tmpdir(), "HF-" + hfid);
    if (!fs.existsSync(tmpdir)){
        fs.mkdirSync(tmpdir);
    }

    var wfDir = pathtool.join(tmpdir, makeId6());
    fs.mkdirSync(wfDir);
    console.log("WF DIR:", wfDir);


    // 1. Workflow can be sent as a zipped directory
    if (ctype == "application/zip") { 
        var zipData = [], size = 0;

	req.on('data', function (data) {
	    zipData.push(data);
	    size += data.length;
	    //onsole.log('Got chunk: ' + data.length + ' total: ' + size);
	});

	req.on('end', function () {
	    var wffile;
	    //onsole.log("total size = " + size);

	    var buf = new Buffer(size);
	    for (var i=0, len = zipData.length, pos = 0; i < len; i++) { 
		zipData[i].copy(buf, pos); 
		pos += zipData[i].length; 
	    } 

	    var zip = new AdmZip(buf);
	    var zipEntries = zip.getEntries();
	    //onsole.log("ZIP ENTRIES:", zipEntries.length);
	    zip.extractAllTo(wfDir);

	    // Make sure this works correctly both when the zip contains a directory, or just files
	    process.chdir(wfDir);
	    var files = fs.readdirSync(wfDir);
	    if (files.length == 1) {
		var fstats = fs.lstatSync(files[0]);
		if (fstats.isDirectory()) {
		    wfDir = pathtool.join(wfDir, files[0]); 
                    process.chdir(wfDir);
		} 
	    } 
	    wffile = pathtool.join(wfDir, "workflow.json");
	    //onsole.log("WF FILE:", wffile);

            // if there is a "package.json" file, install dependencies (npm install -d)
            // TODO: improve error checking etc.
	    if (fs.existsSync("package.json")) { // TODO: check if it is a file
                // find path to npm executable in a portable way 
                // (using which, TODO: test portability)
                var npmexec = which.sync('npm'); // TODO: throws if not found
                var proc = spawn(npmexec, ["install", "-d"]);

                proc.stdout.on('data', function(data) {
                    console.log(data.toString().trimRight());
                });

                proc.stderr.on('data', function(data) {
                    console.log(data.toString().trimRight());
                });

                // TODO: check exit code
                proc.on('exit', function(code, signal) {
                    wflib.createInstanceFromFile(wffile, '', function(err, appId, wfJson) {
                        runWorkflow(wfDir, appId);
                    });
                });
            } else {
                wflib.createInstanceFromFile(wffile, '', function(err, appId, wfJson) {
                    runWorkflow(wfDir, appId);
                });
            }
	}); 

	req.on('error', function(e) {
	    console.log("ERROR ERROR: " + e.message);
	});

	return;

	// TODO: switch to "mkdtemp" after migrating to Node 6.x
	/*fs.mkdtemp(tmpdir, (err, dir) => {
	  console.log(dir);
	  return res.send(201, null);
	  });*/
    }

    // 2. Workflow can also be sent as a JSON
    if (ctype == "application/json") { 
	var wfJson = req.body, baseUrl = '';
	//onsole.log(wfJson);
	var hfid = wflib.hfid, zipData = [], size = 0;
	wflib.createInstance(wfJson, baseUrl, function(err, appId) {
	    if (err) return badRequest(res);
	    runWorkflow(wfDir, appId);
	});
    }

});

// returns workflow instance ('app') info
app.get('/apps/:i', function(req, res) {
    var appId = req.params.i;
    var appIns, appOuts;
    var wfInstanceStatus = "unknown";

    if (!(appId in engine)) return notfound(res); // 404

    var renderHTML = function() {
        var start, end;
        var ctype = acceptsXml(req);
        res.header('content-type', ctype);
        start = (new Date()).getTime();
        res.render('workflow-instance', {
            title: 'Application',
            nr: appId,
            host: req.headers.host,
            wfname: "Application",
            wfins: appIns,
            wfouts: appOuts,
            stat: wfInstanceStatus,
            now: (new Date()).getTime(),
            submit_inputs_uri: '/apps/'+appId
        }, function(err, html) {
            if (err) { throw(err); }
            end = (new Date()).getTime();
            console.log("rendering page: "+(end-start)+"ms, length: "+html.length);
            res.statuscode = 200;
            res.send(html);
        });

    }

    var renderJSON = function() {
        res.header('content-type', 'text/plain');
        res.send('GET /apps/{appId}');
        // res.render ... TODO
    }

    wflib.getWfInsAndOutsInfoFull(req.params.i, function(err, ins, outs) {
        if (err) return notfound(res);
        appIns = ins;
        appOuts = outs;
        res.format({
            'text/html': renderHTML,
            'application/json': renderJSON
        });
    });
});

// emits a signal to a workflow
// body must be a valid signal representation, such as:
// {
//   "name": <signame>
//   <attr>: <value>
//   "data": [ sig(s) data ]
// }
// - attribute 'name' is mandatory and must be equal to a signal name in the target wf
// - other attributes (including actual signal data) are optional
// - if the 'data' array contains multiple elements, multiple signals will be emitted
app.post('/apps/:i', function(req, res) {
    var appId = req.params.i;
    if (!(appId in engine)) return notfound(res); // 404

    var ctype = req.headers["content-type"];
    var sigValue;
    if (ctype == "application/json") {
        sigValue = req.body;
    } else if (ctype == "application/x-www-form-urlencoded") {
        sigValue = req.body;
    }
    //onsole.log(ctype);
    //onsole.log(sigValue);
    //onsole.log(sigValue.name);
    //onsole.log(req.headers);
    if (!("name" in sigValue)) return badrequest(res);

    var sigName = sigValue.name;
    wflib.getSigByName(appId, sigName, function(err, sigId) {
        if (err) return badrequest(res); // FIXME: add detailed error info
        sigValue._id = sigId;
        //onsole.log(sigValue);
        engine[appId].emitSignals([ sigValue ], function(err) {
            if (err) return badrequest(res); // FIXME: add detailed error info
            res.header('content-type', 'text/plain');
            res.send('Emit signal OK!');
        });
    });

});


// returns a list of signals consumed/emitted by the workflow
app.get('/apps/:i/sigs', function(req, res) {
    var renderHTML = function() {
        var ctype = acceptsXml(req);
        res.header('content-type', ctype);
        //res.render ... TODO
    }
    var renderJSON = function() {
        // TODO
    }
    res.format({
        'text/html': renderHTML,
        'application/json': renderJSON
    });
});


// returns a list of input signals for the workflow
app.get('/apps/:i/ins', function(req, res) {
    var wfId = req.params.i;
    var wfInsInfo;

    var renderHTML = function() {
        var ctype = acceptsXml(req);
        res.header('content-type', ctype);
        //res.send(wfInsInfo);
        res.render('workflow-inputs', {
            title: 'workflow inputs',
            wfname: 'Workflow',
            wfins: wfInsInfo,
            submit_ins_uri: req.url
        });
    }

    var renderJSON = function() {
        res.header('content-type', 'application/json');
        res.send(wfInsInfo);
    }

    wflib.getWfIns(wfId, false, function(err, wfIns) {
        wflib.getSignalInfo(wfId, wfIns, function(err, sigsInfo) {
            wfInsInfo = sigsInfo;
            res.format({
                'text/html': renderHTML,
                'application/json': renderJSON
            });
        });
    });
});

// returns info about a signal exchanged within the workflow
app.get('/apps/:i/sigs/:j', function(req, res) {
    var appId = req.params.i, sigId = req.params.j;
    wflib.getDataInfoFull(appId, sigId, function(err, wfData, dSource, dSinks) {
	if (err) {
	    res.statusCode = 404;
	    res.send(inst.toString());
	} else {
	    var ctype = acceptsXml(req);
	    res.header('content-type', ctype);
	    res.render('workflow-data', {
		title: 'workflow data',
		wfname: "Application",
		data: wfData,
		source: dSource,
		data_id: sigId,
		sinks: dSinks
	    });
	}
    });
});


// returns a list of remote sinks of a signal
app.get('/apps/:i/sigs/:name/remotesinks', function(req, res) {
    var appId = req.params.i;
    var sigName = req.params.name;
    var remoteSinks = req.body;

    var renderHTML = function(rsinks) {
        var ctype = acceptsXml(req);
        res.header('content-type', ctype);
        res.send(200, JSON.stringify(rsinks));
    }
    var renderJSON = function(rsinks) {
        res.send(200, "TODO");
        // TODO
    }

    wflib.getSigByName(appId, sigName, function(err, sigId) {
        wflib.getSigRemoteSinks(appId, sigId, function(err, rsinks) {
            renderHTML(rsinks);
            /*res.format({
                'text/html': renderHTML(rsinks),
                'application/json': renderJSON(rsinks)
            });*/
        });
    });
});


// sets remote sinks for a given signal
// body: JSON array of objects: [ { "uri": uri1 }, { "uri": uri2 }, ... ]
app.put('/apps/:i/sigs/:name/remotesinks', function(req, res) {
    var appId = req.params.i;
    var sigName = req.params.name;
    var remoteSinks = req.body;

    wflib.getSigByName(appId, sigName, function(err, sigId) {
        if (err) return badrequest(res);
        wflib.setSigRemoteSinks(appId, sigId, remoteSinks, { "replace": true }, function(err) {
            if (err) return badrequest(res);
            res.send(200, "Remote sinks set succesfully");
        });
    });

});


////////////////////////////////////////////////////////////////////////
////                        REST API (END)                         /////
////////////////////////////////////////////////////////////////////////




/* validate user (from  db) via HTTP Basic Auth */

function validateUser(req, res, next) {

	var parts, auth, scheme, credentials;
	var view, options;

	// handle auth stuff
	auth = req.headers["authorization"];
	if (!auth) {
		return authRequired(res, 'Microblog');
	}

	parts = auth.split(' ');
	scheme = parts[0];
	credentials = new Buffer(parts[1], 'base64').toString().split(':');

	if ('Basic' != scheme) {
		return badRequest(res);
	}
	req.credentials = credentials;

	// ok, let's look this user up
	view = '/_design/microblog/_view/users_by_id';

	options = {};
	options.descending = 'true';
	options.key = String.fromCharCode(34) + req.credentials[0] + String.fromCharCode(34);

	db.view('microblog/users_by_id', function(err, doc) {
		try {
			if (doc[0].value.password === req.credentials[1]) {
				next(req, res);
			}
			else {
				throw new Error('Invalid User');
			}
		}
		catch (ex) {
			return authRequired(res, 'Microblog');
		}
	});
}


/* support various content-types from clients */

function acceptsXml(req) {
	var ctype = contentType;
	var acc = req.headers["accept"];

	switch (acc) {
		case "text/xml":
			ctype = "text/xml";
			break;
		case "application/xml":
			ctype = "application/xml";
			break;
		case "application/xhtml+xml":
			ctype = "application/xhtml+xml";
			break;
		default:
			ctype = contentType;
			break;
	}
	return ctype;
}

/* compute the current date/time as a simple date */

function today() {

	var y, m, d, dt;

	dt = new Date();

	y = String(dt.getFullYear());

	m = String(dt.getMonth() + 1);
	if (m.length === 1) {
		m = '0' + m;
	}

	d = String(dt.getDate());
	if (d.length === 1) {
		d = '0' + d.toString();
	}

	return y + '-' + m + '-' + d;
}

/* compute the current date/time */

function now() {
	var y, m, d, h, i, s, dt;

	dt = new Date();

	y = String(dt.getFullYear());

	m = String(dt.getMonth() + 1);
	if (m.length === 1) {
		m = '0' + m;
	}

	d = String(dt.getDate());
	if (d.length === 1) {
		d = '0' + d.toString();
	}

	h = String(dt.getHours() + 1);
	if (h.length === 1) {
		h = '0' + h;
	}

	i = String(dt.getMinutes() + 1);
	if (i.length === 1) {
		i = '0' + i;
	}

	s = String(dt.getSeconds() + 1);
	if (s.length === 1) {
		s = '0' + s;
	}
	return y + '-' + m + '-' + d + ' ' + h + ':' + i + ':' + s;
}

/* return standard 403 response */

function forbidden(res) {

	var body = 'Forbidden';

	res.setHeader('Content-Type', 'text/plain');
	res.setHeader('Content-Length', body.length);
	res.statusCode = 403;
	res.end(body);
}

// 404 response
function notfound(res) {
    var body = 'Resource not found (404)';

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Length', body.length);
    res.statusCode = 404;
    res.end(body);
}


/* return standard 'auth required' response */

function authRequired(res, realm) {
	var r = (realm || 'Authentication Required');
	res.statusCode = 401;
	res.setHeader('WWW-Authenticate', 'Basic realm="' + r + '"');
	res.end('Unauthorized');
}

/* return standard 'bad inputs' response */

function badRequest(res) {
	res.statusCode = 400;
	res.end('Bad Request');
}

/* iterate over json array and invoke callback */


function clone(obj) {
	// Handle the 3 simple types, and null or undefined
	if (null == obj || "object" != typeof obj) return obj;

	// Handle Date
	if (obj instanceof Date) {
		var copy = new Date();
		copy.setTime(obj.getTime());
		return copy;
	}

	// Handle Array
	if (obj instanceof Array) {
		var copy = [];
		for (var i = 0, len = obj.length; i < len; ++i) {
			copy[i] = clone(obj[i]);
		}
		return copy;
	}

	// Handle Object
	if (obj instanceof Object) {
		var copy = {};
		for (var attr in obj) {
			if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
		}
		return copy;
	}

	throw new Error("Unable to copy obj! Its type isn't supported.");
}

/*if (!module.parent) {
	server.listen(process.env.PORT, function() {
	});
	console.log("HyperFlow server. App factory URI: http://%s:%d/apps", server.address().address, server.address().port);
}*/

module.exports = function(rcl_, wflib_, plugins_) {
    rcl = rcl_;
    wflib = wflib_;
	plugins = plugins_;
    return server;
}
