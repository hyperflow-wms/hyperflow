var SERVICE_URL = process.env.SERVICE_URL ? process.env.SERVICE_URL : "https://localhost:2000/";

var STORAGE = process.env.STORAGE ? process.env.STORAGE : "aws";
var BUCKET = process.env.S3_BUCKET ? process.env.S3_BUCKET : "bucket";
var PATH = process.env.S3_PATH ? process.env.S3_PATH : "data"; //prefix in a bucket with no leading or trailing slashes

exports.service_url = SERVICE_URL;

exports.options = {
    "storage": STORAGE,
    "bucket": BUCKET,
    "prefix": PATH
};

