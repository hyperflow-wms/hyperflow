var http = require('http');
var querys = require('querystring');
var fs = require('fs');
var FormData = require('form-data');
var path_module = require('path');

var dirScanner = require('./dirScanner.js');

var apphost = '1.hyperflow-v1.appspot.com';
var appport = '80';
var miliseconds = 1000;

function uploadImage(ins, outs, config, cb) {
	if (ins[0].data.length == 0)
		return cb(null, outs); 
	console.log("Uploading image: ", ins[0].data[0]);
	var path = ins[0].data[0].value;

	var doUpload = function(urlToUpload) {
		var form = new FormData();
		form.append('myBlob', fs.createReadStream(path));
		
		form.submit(urlToUpload, function(err, res) {
			if(res.statusCode == 200) {
				res.on('data', function (chunk) {
					var uploadedId = String(chunk);
					console.log("Image uploaded with id: ", uploadedId);
					outs[0].data = [];
					outs[0].data.push({ "path": path, "value": uploadedId });
					cb(null, outs);
				});
			}
			else {
				console.log('Image upload error');
				console.log('STATUS: ' + res.statusCode);
				console.log('HEADERS: ' + JSON.stringify(res.headers));
				res.setEncoding('utf8');
				res.on('data', function (chunk) {
					console.log('BODY: ' + chunk);
				});
				cb('Image upload error');
			}
		});
	};

	var options = {
	  host: apphost,
	  port: appport,
	  path: '/upload',
	  method: 'GET'
	};

	var req = http.request(options, function(res) {
		if(res.statusCode == 200) {
		    res.on('data', function (chunk) {
		        var uploadUrl = String(chunk);
		        console.log('uploadUrl: ', uploadUrl);
				doUpload(uploadUrl);
		    });
		}
		else {
		    console.log('STATUS: ' + res.statusCode);
		    console.log('HEADERS: ' + JSON.stringify(res.headers));
		    res.setEncoding('utf8');
		    res.on('data', function (chunk) {
		      console.log('BODY: ' + chunk);
		    });
		}
	});

	req.on('error', function(e) {
	  console.log('problem with request: ' + e.message);
	});

	req.end();
}

function resizeImage(ins, outs, config, cb) {
	if (ins[1].data.length == 0)
		return cb(null, outs); 
	console.log("Resizing image with id: ", ins[1].data[0].value);
	var imagePath = ins[1].data[0].path;
	var imageId = String(ins[1].data[0].value);	
	var width = ins[0].data[0].width;
	var height = ins[0].data[0].height;

	var post_data = querys.stringify({
		'key': imageId,
		'method': 'resize',
		'width': width,
		'height': height
	});

	// An object of options to indicate where to post to
	var post_options = {
		host: apphost,
		port: appport,
		path: '/task',
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': post_data.length
			}
	};

	var getResultImageId = function(imagePath_2, taskId, outs_2, callback) {
		var options = {
  			host: apphost,
  			port: appport,
  			path: '/task?key=' + taskId, //+ querys.stringify({'key': taskId}),
  			method: 'GET'
		};
		var req = http.request(options, function(res) {
			if(res.statusCode == 200) {
				res.on('data', function (chunk) {
					var resultImageId = String(chunk);
					if(resultImageId == -1) {
						setTimeout(getResultImageId(imagePath_2, taskId, outs_2, callback), miliseconds);
					}
					else {
						console.log("Result image id: ", resultImageId);
				    	outs_2[0].data = [];
				    	outs_2[0].data.push({ "path" : imagePath_2, "value" : resultImageId });
				    	callback(null, outs_2);
					}
				});
			}
			else {
				console.log('Get result image error');
				console.log('STATUS: ' + res.statusCode);
				console.log('HEADERS: ' + JSON.stringify(res.headers));
				res.setEncoding('utf8');
				res.on('data', function (chunk) {
					console.log('BODY: ' + chunk);
				});
				callback('Get result image error');
			}
		});

		req.on('error', function(e) {
			console.log('problem with request: ' + e.message);
			callback('problem with request: ' + e.message);
		});

		req.end();
	};

	var getTaskId = function() {
		// Set up the request
		var post_req = http.request(post_options, function(res) {
			if(res.statusCode == 200) {
				res.on('data', function (chunk) {
					var taskId = Number(chunk);					
					if(taskId == -1) {										
						setTimeout(getTaskId(), miliseconds);
					}
					else {		
						console.log("Task for resize image created with id: ", taskId);			
						getResultImageId(imagePath, taskId, outs, cb);
					}					     
				});
			}
			else {
				console.log('Create resize task error');
				console.log('STATUS: ' + res.statusCode);
				console.log('HEADERS: ' + JSON.stringify(res.headers));
				res.setEncoding('utf8');
				res.on('data', function (chunk) {
					console.log('BODY: ' + chunk);
				});
				cb('Create resize task error');
			}
		});

		// post the data
		post_req.write(post_data);
		post_req.end();
	};
	getTaskId();  
}



// download image
function downloadImage(ins, outs, config, cb) {
	if (ins[1].data.length == 0)
		return cb(null, outs); 
	console.log("Download image with id: ", ins[1].data[0].value);
	console.log("Old path to image: ", ins[1].data[0].path);
	var imageId = ins[1].data[0].value;
	var oldImagePath = ins[1].data[0].path;

	var imageDir = ins[0].data[0].value;

	var extension = path_module.extname(oldImagePath);
	var imageName = imageId.toString() + extension;
	var imagePath = path_module.join(imageDir, imageName);

	console.log("New path to image: ", imagePath);

	var options = {
		host: apphost,
		port: appport,
		path: '/images?' + querys.stringify({key: imageId}),
		method: 'GET'
	};

	var file = fs.createWriteStream(imagePath);

	var req = http.request(options, function(res) {
		if(res.statusCode == 200) {
			res.pipe(file);		
		}
		else {
			console.log('Image download error');
			console.log('STATUS: ' + res.statusCode);
			console.log('HEADERS: ' + JSON.stringify(res.headers));
			res.setEncoding('utf8');
			res.on('data', function (chunk) {
				console.log('BODY: ' + chunk);
			});
			cb('Image download error');
		}
	});

	req.on('error', function(e) {
		console.log('problem with request: ' + e.message);
		cb('problem with request: ' + e.message);
	});

	req.end();

	outs[0].data = [];
	outs[0].data.push({ "path" : oldImagePath, "value" : imagePath });
	cb(null, outs);
}

// aggregate images to list
function aggregatePaths(ins, outs, config, cb) {
	if (ins[0].data.length == 0 || ins[1].data.length == 0)
		return cb(null, outs); 
	console.log("Aggregating image (old path): ", ins[1].data[0].path);

	var imagesLeft = Number(ins[0].data[0].value);
	var oldImagePath = ins[1].data[0].path;
	var newImagePath = ins[1].data[0].value;

	var paths = ins[0].data[0].paths;
	if(paths) {
		paths.push({ "old" : oldImagePath, "new" : newImagePath });
	}
	else {
		paths = [];
		paths.push({ "old" : oldImagePath, "new" : newImagePath });
	}

	if(imagesLeft > 1) {
		outs[0].data = [];
		outs[0].data.push({ "value" : imagesLeft - 1, "paths" : paths });
	}
	else {
		outs[0].data = [];
		outs[1].data = [];
		outs[1].data.push({ "value" : paths });
	}

	cb(null, outs);
}

// generate html with gallery
function genHtmlGallery(ins, outs, config, cb) {
	if (ins[1].data === undefined)
		return cb(null, outs); 
	console.log("Generating html... ");

	var htmlPath = ins[0].data[0].value;
	//var htmlPath = "/home/asia/Pictures/index.html";

	var post_data = JSON.stringify(ins[1].data[0]);

	// An object of options to indicate where to post to
	var post_options = {
		host: apphost,
		port: appport,
		path: '/generatehtml',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': post_data.length
			}
	};

	var file = fs.createWriteStream(htmlPath);

	// Set up the request
	var post_req = http.request(post_options, function(res) {
		if(res.statusCode == 200) {

			res.pipe(file);
		}
		else {
			console.log('Generate HTML error');
			console.log('STATUS: ' + res.statusCode);
			console.log('HEADERS: ' + JSON.stringify(res.headers));
			res.setEncoding('utf8');
			res.on('data', function (chunk) {
				console.log('BODY: ' + chunk);
			});
			cb('Generate HTML error');
		}
	});

	post_req.on('error', function(e) {
		console.log('problem with request: ' + e.message);
		cb('problem with request: ' + e.message);
	});

	// post the data
	post_req.write(post_data);
	post_req.end();

	cb(null, outs);
}

exports.uploadImage = uploadImage;
exports.resizeImage = resizeImage;
exports.downloadImage = downloadImage;

exports.aggregatePaths = aggregatePaths;
exports.genHtmlGallery = genHtmlGallery;

exports.scanDir = dirScanner.scanDir;

