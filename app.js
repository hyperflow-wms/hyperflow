/* 2012 (bb) : hypermedia workflow */

'use strict';

/**
 * Module dependencies.
 */

// for express
var express = require('express');
var app = module.exports = express.createServer();

// for couch
var cradle = require('cradle');
var host = 'http://beboj.iriscouch.com';
var port = 5984;
var credentials = {
	username: 'balis',
	password: 'ala123'
};
var local = false;
var db;
if (local === true) {
	db = new(cradle.Connection)().database('html5-microblog');
}
else {
	db = new(cradle.Connection)(host, port, {
		auth: credentials
	}).database('html5-microblog');
}

var adag = require('./adag_parser').init();
var deltaWf = require('./deltawf').init();
var urlReq = require('./req_url');

var timers = require('timers');


//var $ = require('jquery');

var _ = require('underscore');

// global data
var contentType = 'text/html';
//var baseUrl = 'http://localhost:'+process.env.PORT;
var baseUrl = ''; // with empty baseUrl all links are relative; I couldn't get hostname to be rendered properly in htmls

var workflow_cache = {}; // cache for parsed json workfow representations (database substitute)

var instances = [];

// Configuration
app.configure(function() {
	app.set('views', __dirname + '/views');
	app.set('view engine', 'ejs');
	app.use(express.bodyParser());
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

	var file = 'Montage_25.xml';

	adag.parse(file, 'Montage_25', function(result) {
		res.header('content-type', 'application/json');
		res.send(JSON.stringify(result));
	});
});


app.get('/workflow/:w', function(req, res) {
	getWfJson(req.params.w, function(wf) {
		if (!(req.params.w in instances)) {
			instances[req.params.w] = {"current": 0, "max": 3, "data": []};
		}
		var ctype = acceptsXml(req);
		res.header('content-type', ctype);
		res.render('workflow', {
			title: req.params.w,
			wfname: req.params.w,
			inst: instances[req.params.w]
		});
	});
});


/* 
 * Create a new instance of a workflow
 */
app.post('/workflow/:w', function(req, res) {
	getWfJson(req.params.w, function(wf) {
		var inst;
		if (req.params.w in instances) {
			inst = instances[req.params.w];
			inst.current = (inst.current + 1) % inst.max; 
		} else {
			instances[req.params.w] = {"current": 0, "max": 3, "data": []};
			inst = instances[req.params.w];
		}
		inst.data[inst.current] = clone(wf);
		createWfInstance(inst.data[inst.current], req.params.w, baseUrl, inst.current);
		deltaWf.create(req.params.w+'-'+inst.current); // delta resource. FIXME! Is it enough for unique id?
		res.redirect(req.url+"instances/"+inst.current, 302); // redirect to the newly created workflow instance
	});
});


/* Runs a workflow instance 
 * Emulates execution of the workflow by posting to all tasks all input data 
 * which is not produced by any other task (assuming it is the workflow input 
 * data normally provided by the user). 
 * FIXME: this should be done by a properly written client.
 */
app.post('/workflow/:w/instances/:i', function(req, res) {
	if (!wfInstanceExists(req.params.w, req.params.i)) {
		res.statusCode = 404;
		res.send("Instance doesn't exist");
	} else {
		var wf = getWfInstance(req.params.w, req.params.i);
		wf.status = 'running';
		foreach(wf.data, function(data) {
			if (data.from.length == 0) {
				foreach(data.to, function(job) {
				  deltaWf.addEvent(req.params.w+'-'+req.params.i, "data-"+data.id, "ready");  // FIXME: the same event can be added many times (works ok, but more processing)
					urlReq.urlReq('http://' + req.headers.host + job.job_uri, {
						method: 'POST',
						params: {
							'input-data-link': data.uri
						}
						}, function(body, res) {
							// do your stuff
						});
				});
			}
		});
		res.redirect(req.url, 302); // redirect after making all POSTs
	}
});


app.get('/workflow/:w/instances/:i', function(req, res) {
	var id = req.params.i;
	if (!(req.params.w in instances)) {
		res.statusCode = 404;
		res.send("Instance doesn't exist");
	} else if (!(id in instances[req.params.w].data)) {
		res.statusCode = 404;
		res.send("Instance doesn't exist");
	} else {
		var inst = instances[req.params.w];
		var wf = inst.data[id];
		var ctype = acceptsXml(req);
		res.header('content-type', ctype);
		res.render('workflow-instance', {
			title: req.params.w,
			nr: id,
		  host: req.headers.host,
			wfname: req.params.w,
			wftasks: wf.job,
			stat: wf.status,
		  now: (new Date()).getTime()
		}, function(err, html) {
			res.statuscode = 200;
			res.send(html);
		});
	}
});



// delta resource: returns history of changes to status of workflow tasks and data 
// since the last retrieval of delta (helps quickly synchronize the web page with the 
// current workflow status via ajax)
// Also returns the link to be used to retrieve delta next time
// (TODO:) can/should be a generic JSON-based media type 'delta+json'? 
// (-> not really, the client has to know the meaning of keys and values, so it's 
// domain-specific. Unless it's defined as "wfdelta+json").
app.get('/workflow/:w/instances/:i/delta-:j', function(req, res) {
				var now = (new Date()).getTime();
				var delta = deltaWf.getDelta(req.params.w+'-'+req.params.i, req.params.j);		
				res.header('content-type', 'application/json');
				var x = { 
								"delta" : delta,
				        "link": {
												 "href": "http://"+req.headers.host+"/workflow/"+req.params.w+"/instances/"+req.params.i+"/delta-"+now,
				                 "type": "wfdelta+json",
				                 "method": "GET",
				                 "rel": "wfdelta",
				                 "title": "History of changes to status of workflow tasks and data"
								 }
				}
				res.send(JSON.stringify(x));
});


app.get('/workflow/:w/instances/:j/task-:i', function(req, res) {
	var id = req.params.i;
	if (!(wfInstanceExists(req.params.w, req.params.j))) {
		res.statuscode = 404;
		res.send("Instance doesn't exist");
	} else {
		var wf = getWfInstance(req.params.w, req.params.j);
		var ctype = acceptsXml(req);
		res.header('content-type', ctype);
		res.render('workflow-task', {
			nr: id,
			wfname: req.params.w,
			title: ' workflow task',
			wftask: wf.job[id - 1], // FIXME - 404 if doesn't exist
			wfuri: baseUrl+'/workflow/'+req.params.w+'/instances/'+req.params.j+'/'
		});
	}
});

/*
   Representation of the following form can be posted to a task's URI in order to
   notify that input data (identified by a link passed in the representation) is
   ready. The passed link MUST be identical to one of input data links from the
   task's representation. When all task's input data are ready, task's status is
   changed to 'running' and a computing backend is invoked

   <form method="post" action="..." class="input-data-link">
   <input type="text" name="input-data-link" value="" required="true"/>
	 <input type="submit" value="Send" />
	 </form>
	 */
app.post('/workflow/:w/instances/:j/task-:i', function(req, res) {
				var id, link;
				var found = undefined;
				var all_ready = true;
				id = req.params.i-1;
				link = req.body['input-data-link'];

				if (!(wfInstanceExists(req.params.w, req.params.j))) {
								res.statuscode = 404;
								res.send("Instance doesn't exist");
				} else {
								var wf = getWfInstance(req.params.w, req.params.j);  
								foreach(wf.job[id].uses, function(job_data) {
												if (job_data['@'].link == 'input' && job_data['@'].uri == link) {
																found = job_data;
												}
								});
								if (!found) {
												res.status = 400;
												res.send('bad input data link: no match');
								}
								if (found && found['@'].status == 'ready') { // data sent more than once
												res.status = 409;
												res.send('Conflict: data already submitted before. No action taken.');
								} else {
												found['@'].status='ready';
												foreach(wf.job[id].uses, function(job_data) {
																if (job_data['@'].link == 'input' && job_data['@'].status != 'ready') {
																				all_ready = false;
																}
												});

												// All inputs are ready! ==> Emulate the execution of the workflow task
												if (all_ready) {
																wf.job[id]['@'].status = 'running';
																deltaWf.addEvent(req.params.w+'-'+req.params.j, 'task-'+req.params.i, 'running');

																/* The following setTimeout must be replaced with the actual invocation of the
																 * computing backend of the workflow task. The completion callback passed to
																 * the invocation will, however, basically be the same (POST to all dependent 
																 * tasks information that new data has been produced). 
																 */
																setTimeout(function() {
																				wf.job[id]['@'].status = 'finished';
																				deltaWf.addEvent(req.params.w+'-'+req.params.j, 'task-'+req.params.i, 'finished');
																				wf.nTasksLeft--;
																				if (wf.nTasksLeft == 0) {
																								wf.status = 'finished';
																								console.log(deltaWf.getDelta(req.params.w+'-'+req.params.j, 0));
																				}

																				// POST to all dependant tasks which consume outputs of this task
																				foreach(wf.job[id].uses, function(job_data) {
																								if (job_data['@'].link == 'output') {
																												job_data['@'].status = 'ready';
																												deltaWf.addEvent(req.params.w+'-'+req.params.j, 'data-'+job_data['@'].id, 'ready');
																												foreach(wf.data[job_data['@'].id - 1].to, function(dependent_job) {
																																var uri = wf.job[dependent_job.job_id - 1]['@'].uri;
																																urlReq.urlReq('http://'+req.headers.host+uri, {
																																				method: 'POST',
																																				params: {
																																								'input-data-link': job_data['@'].uri
																																				}
																																				}, function(body, res) {
																																								// do your stuff
																																				});

																												});

																								}


																				});
																}, wf.job[id]['@'].runtime * 1000);
												}
												res.redirect(wf.uri+'/task-'+req.params.i, 302);
								}
				}
});


app.get('/workflow/:w/instances/:i/data-:j', function(req, res) {
				if (!(wfInstanceExists(req.params.w, req.params.i))) {
								res.statuscode = 404;
								res.send("Instance doesn't exist");
				} else {
								var data_id = req.params.j;
								var wf = getWfInstance(req.params.w, req.params.i);  
								var ctype = acceptsXml(req);
								res.header('content-type', ctype);
								res.render('workflow-data', {
												title: 'workflow data',
												wfname: req.params.w,
												data: wf.data[data_id - 1] // FIXME: 404 if doesn't exist
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


/*
	 function getWfJson(wfname, cb) {
	 adag.parse(wfname + '.xml', wfname, baseUrl, function(w) {
	 cb(w);
	 });
	 }
	 */

function getWfJson(wfname, cb) {
				if (wfname in workflow_cache) {
								cb(workflow_cache[wfname]);
				} else {
								adag.parse(wfname + '.xml', wfname, baseUrl, function(w) {
												workflow_cache[wfname] = w;
												cb(workflow_cache[wfname]);
								});
				}
}

function wfInstanceExists(wfname, num) {
				if (!(wfname in instances)) {
								return false;
				}
				if ((!num in instances[wfname].data)) {
								return false;
				}
				return true;
}

function getWfInstance(wfname, num) {
				if (!(wfname in instances)) {
								return undefined;
				}
				if (!(num in instances[wfname].data)) {
								return undefined;
				}
				return instances[wfname].data[num];
}

// Creates representation of a new workflow instance 
// On input, parameter 'wf' represents the worklfow template. On output, it represents the new instance.
function createWfInstance(wf, wfname, baseUrl, inst_id) {
				var baseUri = baseUrl + '/workflow/'+wfname+'/instances/'+inst_id;
				var job_id = 0;
				wf.uri = baseUri;
				wf.status = 'ready'; // initial status of workflow instance -- ready but not yet running
				wf.nTasksLeft = wf.job.length;
				// move info about parents to 'job' elements
				foreach(wf.job, function(job) {
								job['@'].status = 'waiting'; // initial status of all jobs - waiting for input data
								job['@'].job_id = ++job_id; 
								job['@'].uri = baseUri+'/task-'+job_id;
								foreach(wf.child, function(child) {
												if (job['@'].id == child['@'].ref) { 
																job['@'].parents = child.parent; // assumes that child element always has some parent(s)
												}
								});
				});

				// create an array of workflow data elements
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

				// assign identifiers and URIs to data elements
				var id = 0;
				foreach(wf.data, function(data) {
								data.id = ++id;
								data.uri = baseUri+'/data-'+id;
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
	app.listen(process.env.PORT, function() {
	});
	console.log("Express server listening on port %d", app.address().port);
}
