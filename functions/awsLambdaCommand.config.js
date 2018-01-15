var AWSLAMBDA_URL  = process.env.AWSLAMBDA_URL ? process.env.AWSLAMBDA_URL : "https://us-central1.hyperflow-functions.cloudfunctions.net/hyperflow_executor";

var AWS_BUCKET = process.env.AWS_BUCKET ? process.env.AWS_BUCKET : "test-input";
var AWS_PATH   = process.env.AWS_PATH ? process.env.AWS_PATH : "data/0.25"; //prefix in a bucket with no leading or trailing slashes

exports.awslambda_url = AWSLAMBDA_URL;


exports.options = {
     "storage": "aws",
     "bucket": AWS_BUCKET,
     "prefix": AWS_PATH
 };

