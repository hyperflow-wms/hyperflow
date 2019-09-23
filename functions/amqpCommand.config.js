var AMQP_URL  = process.env.AMQP_URL ? process.env.AMQP_URL : "amqp://localhost:5672";
var WORKDIR   = process.env.WORKDIR;
var S3_BUCKET = process.env.S3_BUCKET;
var S3_PATH   = process.env.S3_PATH;

exports.amqp_url = AMQP_URL;

// S3 storage
// exports.options = {
//     "storage": "s3",
//     "bucket": S3_BUCKET,
//     "prefix": S3_PATH
// };

// Local storage
exports.options = {
    "storage": "local",
    "workdir": WORKDIR
};


// NFS storage
// exports.options = {
//     "storage": "nfs",
//     "workdir": "/path/where/workflow/data/is",
// }


// Local storage
// exports.options = {
//     "storage": "local"
//     "workdir": "/path/where/workflow/data/is",
// }
