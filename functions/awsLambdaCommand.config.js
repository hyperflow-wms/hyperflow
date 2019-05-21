var SERVICE_URL = process.env.SERVICE_URL ? process.env.SERVICE_URL : "https://localhost:2000/";

var BUCKET = process.env.BUCKET ? process.env.BUCKET : "bucket";
var PATH = process.env.PATH ? process.env.PATH : "data"; //prefix in a bucket with no leading or trailing slashes

exports.service_url = SERVICE_URL;
exports.S3_metrics = false || true;

exports.options = {
    "bucket": BUCKET,
    "prefix": PATH
};

