/* 2001-07-25 (mca) : collection+json */
/* Designing Hypermedia APIs by Mike Amundsen (2011) */

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
var urlReq = require('./req_url');

var timers = require('timers');

// global data
var contentType = 'text/html';
//var baseUrl = 'http://localhost:'+process.env.PORT;
var baseUrl = ''; // with empty baseUrl all links are relative; I couldn't get hostname to be rendered properly in htmls

var workflow_cache = {}; // cache for parsed json workfow representations (database substitute)

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
/* starting page */
app.get('/microblog/', function(req, res) {

    var ctype;

    var view = '/_design/microblog/_view/posts_all';

    var options = {};
    options.descending = 'true';

    ctype = acceptsXml(req);

    db.view('microblog/posts_all', function(err, doc) {
        res.header('content-type', ctype);
        res.render('index', {
            title: 'Home',
            site: baseUrl,
            items: doc
        });
    });
});

app.get('/workflow', function(req, res) {

    var file = 'Montage_25.xml';

    adag.parse(file, 'Montage_25', function(result) {
        res.header('content-type', 'application/json');
        res.send(JSON.stringify(result));
    });
});


app.get('/workflow/:w', function(req, res) {
    getWfJson(req.params.w, function(wf) {
        var ctype = acceptsXml(req);
        res.header('content-type', ctype);
        res.render('workflow', {
            title: req.params.w,
            wfname: req.params.w,
            wftasks: wf.job
        });
    });
});


/* HACK: emulates workflow execution the workflow, i.e. posts to all tasks
 * all input data which is not produced by any other task (assuming it is the
 * workflow input data normally provided by the user). 
 * FIXME: this should be done by a properly written client.
 */
app.post('/workflow/:w', function(req, res) {
    getWfJson(req.params.w, function(wf) {
        foreach(wf.data, function(data) {
            if (data.from.length == 0) {
                foreach(data.to, function(job) {
                    urlReq.urlReq('http://0.0.0.0:' + app.address().port + job.job_uri, {
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
    });
});


app.get('/workflow/:w/task-:i', function(req, res) {
    var id = req.params.i;

    getWfJson(req.params.w, function(wf) {
        var ctype = acceptsXml(req);
        res.header('content-type', ctype);
        res.render('workflow-task', {
            nr: id,
            wfname: req.params.w,
            title: ' workflow task',
            wftask: wf.job[id - 1] // FIXME - 404 if doesn't exist
        });
    });
});

/*
Representation of the following form can be posted to a task's URI in order 
to notify that input data (identified by a link passed in the representation)
is ready. The passed link MUST be identical to one of input data links
from the task's representation. When all task's input data are ready,
task's status is changed to 'running' and a computing backend is invoked

<form method="post" action="..." class="input-data-link">
  <input type="text" name="input-data-link" value="" required="true"/>
  <input type="submit" value="Send" />
</form>
*/
app.post('/workflow/:w/task-:i', function(req, res) {
    var id, link;
    var found = undefined;
    var all_ready = true;
    id = req.params.i-1;
    link = req.body['input-data-link'];
    
    getWfJson(req.params.w, function(wf) {
        foreach(wf.job[id].uses, function(job_data) {
            if (job_data['@'].link == 'input' && job_data['@'].uri == link) {
                found = job_data;
            }
        });
        if (!found) {
            res.status = 400;
            res.send('bad input data link: no match');
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
                
                /* The following setTimeout must be replaced with the actual invocation of the
                 * computing backend of the workflow task. The completion callback passed to
                 * the invocation will, however, basically be the same (POST to all dependent 
                 * tasks information that new data has been produced). 
                 */
                setTimeout(function() {
                    wf.job[id]['@'].status = 'finished';
                
                    // POST to all dependant tasks which consume outputs of this task
                    foreach(wf.job[id].uses, function(job_data) {
                        if (job_data['@'].link == 'output') {
                            job_data['@'].status = 'ready';
                            foreach(wf.data[job_data['@'].id - 1].to, function(dependent_job) {
                                var uri = wf.job[dependent_job.job_id - 1]['@'].uri;
                                urlReq.urlReq('http://0.0.0.0:'+app.address().port+uri, {
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
            res.redirect(wf.job[id]['@'].uri, 302);
        }
    });
});


app.get('/workflow/:w/data-:j', function(req, res) {
    var data_id = req.params.j;
    getWfJson(req.params.w, function(wf) {
        var ctype = acceptsXml(req);
        res.header('content-type', ctype);
        res.render('workflow-data', {
            title: 'workflow data',
            wfname: req.params.w,
            data: wf.data[data_id - 1] // FIXME: 404 if doesn't exist
        });
    });
});



/* single message page */
app.get('/microblog/messages/:i', function(req, res) {

    var view, options, id, ctype;
    id = req.params.i;

    view = '/_design/microblog/_view/posts_by_id';
    options = {};
    options.descending = 'true';
    options.key = String.fromCharCode(34) + id + String.fromCharCode(34);

    ctype = acceptsXml(req);

    db.view('microblog/posts_by_id', function(err, doc) {
        res.header('content-type', ctype);
        res.render('message', {
            title: id,
            site: baseUrl,
            items: doc
        });
    });
});

// add a message
app.post('/microblog/messages/', function(req, res) {

    validateUser(req, res, function(req, res) {

        var text, item;

        // get data array
        text = req.body.message;
        if (text !== '') {
            item = {};
            item.type = 'post';
            item.text = text;
            item.user = req.credentials[0];
            item.dateCreated = now();

            // write to DB
            db.save(item, function(err, doc) {
                if (err) {
                    res.status = 400;
                    res.send(err);
                }
                else {
                    res.redirect('/microblog/', 302);
                }
            });
        }
        else {
            return badReqest(res);
        }
    });
});

/* single user profile page */
app.get('/microblog/users/:i', function(req, res) {

    var view, options, id, ctype;
    id = req.params.i;
    ctype = acceptsXml(req);

    view = '/_design/microblog/_view/users_by_id';
    options = {};
    options.descending = 'true';
    options.key = String.fromCharCode(34) + id + String.fromCharCode(34);

    db.view('microblog/users_by_id', function(err, doc) {
        res.header('content-type', ctype);
        res.render('user', {
            title: id,
            site: baseUrl,
            items: doc
        });
    });
});

/* user messages page */
app.get('/microblog/user-messages/:i', function(req, res) {

    var view, options, id, ctype;

    id = req.params.i;
    ctype = acceptsXml(req);

    view = '/_design/microblog/_view/posts_by_user';
    options = {};
    options.descending = 'true';
    options.key = String.fromCharCode(34) + id + String.fromCharCode(34);

    db.view('microblog/posts_by_user', function(err, doc) {
        res.header('content-type', ctype);
        res.render('user-messages', {
            title: id,
            site: baseUrl,
            items: doc
        });
    });
});

/* get user list page */
app.get('/microblog/users/', function(req, res) {
    var ctype;

    var view = '/_design/microblog/_view/users_by_id';

    ctype = acceptsXml(req);

    db.view('microblog/users_by_id', function(err, doc) {
        res.header('content-type', ctype);
        res.render('users', {
            title: 'User List',
            site: baseUrl,
            items: doc
        });
    });
});

/* post to user list page */
app.post('/microblog/users/', function(req, res) {

    var item, id;

    id = req.body.user;
    if (id === '') {
        res.status = 400;
        res.send('missing user');
    }
    else {
        item = {};
        item.type = 'user';
        item.password = req.body.password;
        item.name = req.body.name;
        item.email = req.body.email;
        item.description = req.body.description;
        item.imageUrl = req.body.avatar;
        item.websiteUrl = req.body.website;
        item.dateCreated = today();

        // write to DB
        db.save(req.body.user, item, function(err, doc) {
            if (err) {
                res.status = 400;
                res.send(err);
            }
            else {
                res.redirect('/microblog/users/', 302);
            }
        });
    }
});

/* get user register page */
app.get('/microblog/register/', function(req, res) {

    var ctype;
    ctype = acceptsXml(req);

    res.header('content-type', ctype);
    res.render('register', {
        title: 'Register',
        site: baseUrl
    });
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

// Only listen on $ node app.js
if (!module.parent) {
    app.listen(process.env.PORT, function() {
        console.log('address='+app.address());
    });
    console.log("Express server listening on port %d", app.address().port);
}