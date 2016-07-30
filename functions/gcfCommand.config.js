var GCF_URL  = process.env.GCF_URL ? process.env.GCF_URL : "https://us-central1.hyperflow-functions.cloudfunctions.net/hyperflow_executor";
//var GCF_URL  = process.env.GCF_URL ? process.env.GCF_URL :  'http://localhost:2000'

var GOOGLE_BUCKET = process.env.GOOGLE_BUCKET ? process.env.GOOGLE_BUCKET : "maciek-test";
var GOOGLE_PATH   = process.env.GOOGLE_PATH ? process.env.GOOGLE_PATH : "data/0.25"; //prefix in a bucket with no leading or trailing slashes

exports.gcf_url = GCF_URL;


// Google cloud storage
exports.options = {
     "storage": "google",
     "bucket": GOOGLE_BUCKET,
     "prefix": GOOGLE_PATH
 };

