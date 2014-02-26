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

// for express
var express = require('express'),
    cons = require('consolidate'),
    http = require('http'),
    app = express();

var redis = require('redis'),
    rcl = redis.createClient();

var server = http.createServer(app);
var wflib = require('./wflib').init(rcl);
var Engine = require('./engine');
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
// body must be a valid workflow description in JSON
app.post('/apps', function(req, res) {
    var wfJson = req.body;
    var baseUrl = '';
    //onsole.log(wfJson);
    
    // FIXME: validate workflow description
    // FIXME: add proper/more detailed error info instead of "badRequest(res)"
    wflib.createInstance(wfJson, baseUrl, function(err, appId) {
        if (err) return badRequest(res); 
        engine[appId] = new Engine({"emulate": "false"}, wflib, appId, function(err) {
            if (err) return badRequest(res); 
            engine[appId].runInstance(function(err) {
                if (err) return badRequest(res); 
                res.header('Location', req.url + '/' + appId);
                res.send(201, null);
                //res.redirect(req.url + '/' + appId, 302);
                // TODO: implement sending all input signals (just like -s flag in runwf.js)
            });
        });
    });
});

// returns workflow instance ('app') info
app.get('/apps/:i', function(req, res) {
    var renderHTML = function() {
        var ctype = acceptsXml(req);
        res.header('content-type', ctype);
        res.send('GET /apps/{appId}');
        //res.render ... TODO
    }
    var renderJSON = function() {
        res.header('content-type', 'text/plain');
        res.send('GET /apps/{appId}');
        // res.render ... TODO
    }
    res.format({
        'text/html': renderHTML,
        'application/json': renderJSON
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
    var wfId = req.params.i, dataId = req.params.j;
    wflib.getDataInfoFull(wfId, dataId, function(err, wfData, dSource, dSinks) {
	if (err) {
	    res.statusCode = 404;
	    res.send(inst.toString());
	} else {
	    var ctype = acceptsXml(req);
	    res.header('content-type', ctype);
	    res.render('workflow-data', {
		title: 'workflow data',
		wfname: req.params.w,
		data: wfData,
		source: dSource,
		data_id: dataId,
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

// Routes
//
/* starting page */
app.get('/workflow', function(req, res) {
	pwf.getTemplate('Montage_65r', function(err, result) {
        if (err) {
            res.statusCode = 404;
            res.send(err.toString());
       } else {
           wflib.createInstanceFromFile('workflows/Montage_143.json', '', function(err, id) {
               if (err) {
                   res.statusCode = 404;
                   res.send(err.toString());
                } else {
                    res.statusCode = 200;
                    res.header('content-type', 'application/json');
                    res.send(JSON.stringify(pwf.getInstance('Montage_65r', id)));
                }
            });
        }
	});
});


app.get('/workflow/:w', function(req, res) {
    wflib.getWfInfo(req.params.w, function(err, rep) {
        if (err) {
            res.statusCode = 404; // FIXME: 404 or other error code?
            res.send(err.toString());
        } else {
            var ctype = acceptsXml(req);
            res.header('content-type', ctype);
            res.render('workflow', {
                title: req.params.w,
                wfname: req.params.w,
                inst: rep 
            });
        }
    });
});


/* 
 * Create a new instance of a workflow
 */
app.post('/workflow/:w', function(req, res) {
    wflib.createInstanceFromFile('workflows/'+req.params.w+'.json', baseUrl, function(err, id) {
        if (err) {
           res.statusCode = 404;
           res.send(err.toString());
        } else {
            //deltaWf.create(req.params.w+'-'+id); // delta resource. FIXME! Is it enough for unique id?
	    engine[id] = new Engine({"emulate": "false"}, wflib, id, function(err) {
                res.redirect(req.url+"instances/"+id, 302); // redirect to the newly created wf instance
            });
        }
    });
});


/* Runs a workflow instance 
 */
app.post('/workflow/:w/instances/:i', function(req, res) {
    var wfId = req.params.i;
    engine[wfId].runInstance(function(err) {
	if (err) {
	    res.statusCode = 404;
	    res.send(err.toString());
	} else {
            // if some data values are passed along with the form, set them and the 
            // status of corresponding data elements to 'ready'
            var spec = {}, dataIds = [];
            for (var i in req.body) {
                if (i.match(/^in:[0-9]+$/)) {
                    var id = i.split(':')[1];
                    spec[id] = { "value": req.body[i] }
                    dataIds.push(id);
                }
                //onsole.log(spec);
            }
            if (Object.keys(spec).length) { // not empty
                wflib.setDataState(wfId, spec, function(err, rep) {
                    //onsole.log(spec);
                    engine[wfId].markDataReady(dataIds, function(err) {
                        res.redirect(req.url, 302); 
                    });
                });
            } else {
                res.redirect(req.url, 302); 
            }
        }
    });
});


app.get('/workflow/:w/instances/:i', function(req, res) {
    wflib.getWfInstanceInfo(req.params.i, function(err, reply) {
	var wfInstanceStatus = reply.status;
	wflib.getWfInsAndOutsInfoFull(req.params.i, function(err, ins, outs) {
	    if (err) {
		res.statusCode = 404;
		res.send(err.toString());
	    } else {
		var ctype = acceptsXml(req);
		res.header('content-type', ctype);
		var start, end;
		start = (new Date()).getTime();
		res.render('workflow-instance', {
		    title: req.params.w,
		    nr: req.params.i,
		    host: req.headers.host,
		    wfname: req.params.w,
		    wfins: ins,
		    wfouts: outs,
		    stat: wfInstanceStatus, 
		    now: (new Date()).getTime(),
                    submit_inputs_uri: '/workflow/'+req.params.w+'/instances/'+req.params.i
		}, function(err, html) {
		    if (err) { throw(err); }
		    end = (new Date()).getTime();
		    console.log("rendering page: "+(end-start)+"ms, length: "+html.length);
		    res.statuscode = 200;
		    res.send(html);
		});
	    }
	});
    });
});


app.get('/workflow/:w/instances/:i/tasks', function(req, res) {
    wflib.getWfInstanceInfo(req.params.i, function(err, reply) {
	var wfInstanceStatus = reply.status;
	wflib.getWfTasks(req.params.i, 1, -1, function(err, tasks, ins, outs) {
	    if (err) {
		res.statusCode = 404;
		res.send(err.toString());
	    } else {
		var ctype = acceptsXml(req);
		res.header('content-type', ctype);
		var start, end;
		start = (new Date()).getTime();
		res.render('workflow-tasks-all', {
		    title: req.params.w,
		    nr: req.params.i,
		    host: req.headers.host,
		    wfname: req.params.w,
		    wftasks: tasks,
		    wfins: ins,
		    wfouts: outs,
		    stat: wfInstanceStatus, 
		    now: (new Date()).getTime()
		}, function(err, html) {
		    if (err) { throw(err); }
		    end = (new Date()).getTime();
		    console.log("rendering page: "+(end-start)+"ms, length: "+html.length);
		    res.statuscode = 200;
		    res.send(html);
		});
	    }
	});
    });
});



// delta resource: returns history of changes to status of workflow tasks and data 
// since the last retrieval of delta (helps quickly synchronize the web page with the 
// current workflow status via ajax)
// Also returns the link to be used to retrieve delta next time
// (TODO:) can/should be a generic JSON-based media type 'delta+json'? 
// (-> not really, the client has to know the meaning of keys and values, so it's 
// domain-specific. Unless it's defined specifically as "wfdelta+json").
app.get('/workflow/:w/instances/:i/delta-:j', function(req, res) {
    var inst = pwf.getInstance(req.params.w, req.params.i);
    if (inst instanceof Error) {
        res.statusCode = 404;
        res.send(inst.toString());
    } else {
        var now = (new Date()).getTime();
        var delta = deltaWf.getDelta(req.params.w+'-'+req.params.i, req.params.j);		
        res.header('content-type', 'application/wfdelta+json');
        var x = { 
            "delta" : delta,
            "link": {
                "href": "http://"+req.headers.host+"/workflow/"+req.params.w+"/instances/"+req.params.i+"/delta-"+now,
                "type": "wfdelta+json",
                "method": "GET",
                "rel": "wfdelta",
                "title": "History of changes to status of workflow tasks and data"
            }
        };
        res.send(JSON.stringify(x));
    }
});


app.get('/workflow/:w/instances/:j/task-:i', function(req, res) {
    var wfId = req.params.j, taskId = req.params.i;
    wflib.getTaskInfoFull(wfId, taskId, function(err, wftask, taskins, taskouts) {
	if (err) {
	    res.statusCode = 404;
	    res.send(err.toString());
	} else {
	    var ctype = acceptsXml(req);
	    res.header('content-type', ctype);
	    res.render('workflow-task', {
		nr: taskId,
		wfname: req.params.w,
		title: ' workflow task',
		task: wftask, 
		ins: taskins,
		outs: taskouts,
		wfuri: baseUrl+'/workflow/'+req.params.w+'/instances/'+req.params.j+'/'
	    });
	}
    });
});

/*
   Representation of the following form can be posted to a task's URI in order to
   notify that task's input (identified by its id) is ready
   <form method="post" action="..." class="data-id">
   <input type="text" name="data-id" value="" required="true"/>
   <input type="submit" value="Send" />
   </form>
   */
app.post('/workflow/:w/instances/:i/task-:j', function(req, res) {
    var wfId = req.params.i, taskId = req.params.j, dataId = req.body['data-id'];
    engine[wfId].markTaskInputReady(taskId, dataId, function(err) {
	if (err) {
	    res.statusCode = 404;
	    res.send();
	} else {
	    res.redirect(wf.uri+'/task-'+req.params.i, 302);
	}
    });
});
    

app.get('/workflow/:w/instances/:i/data-:j', function(req, res) {
    var wfId = req.params.i, dataId = req.params.j;
    wflib.getDataInfoFull(wfId, dataId, function(err, wfData, dSource, dSinks) {
	if (err) {
	    res.statusCode = 404;
	    res.send(inst.toString());
	} else {
	    var ctype = acceptsXml(req);
	    res.header('content-type', ctype);
	    res.render('workflow-data', {
		title: 'workflow data',
		wfname: req.params.w,
		data: wfData,
		source: dSource,
		data_id: dataId,
		sinks: dSinks
	    });
	}
    });
});

/*
** Representation of the following form can be posted to a data URI in order to
** notify that this data is ready. Optionally, value can be passed (used if value
** is simple, otherwise task's "function" is supposed to retrieve value via its URI.
** <form method="post" action="..." class="data-id">
**   <input type="text" name="data-id" value="{id}" required="true"/>
**   <input type="text" name="data-value" value="{value}" required="false"/>
**   <input type="submit" value="Send" />
** </form>
*/
app.post('/workflow/:w/instances/:i/data-:j', function(req, res) {
    var wfId = req.params.i, dataId = req.params.j;
    if (req.body['data-value']) {
        var spec = {};
        spec[dataId] = {"value": req.body['data-value']};
        wflib.setDataState(wfId, spec, function(err, rep) {
            engine[wfId].markDataReady(dataId, function(err) {
                if (err) {
                    res.statusCode = 404;
                    res.send(err.toString());
                } else {
                    res.redirect(req.url, 302);
                }
            });
        });
    } else {
        engine[wfId].markDataReady(dataId, function(err) {
            if (err) {
                res.statusCode = 404;
                res.send(err.toString());
            } else {
                res.redirect(req.url, 302);
            }
        });
    }
});


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

function foreach(what, cb) {
	function isArray(what) {
		return Object.prototype.toString.call(what) === '[object Array]';
	}

	if (isArray(what)) {
		for (var i = 0, arr = what; i < what.length; i++) {
			cb(arr[i]);
		}
	}
	else {
		cb(what);
	}
}

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

// Only listen on $ node app.js
if (!module.parent) {
	server.listen(process.env.PORT, function() {
	});
	console.log("Express server listening on port %d", server.address().port);
}
