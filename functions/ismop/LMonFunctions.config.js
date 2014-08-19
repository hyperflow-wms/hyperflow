var DAP_URL  = process.env.DAP_URL ? process.env.DAP_URL : "http://localhost:8080/";
//var DAP_URL  = process.env.DAP_URL ? process.env.DAP_URL : "https://atmo.moc.ismop.edu.pl/";
var AUTH_TOKEN = process.env.AUTH_TOKEN ? process.env.AUTH_TOKEN : "";
var LEVEE_SERVICE = "api/v1/levees/"

//exports
exports.DAP_URL = DAP_URL;
exports.LEVEE_SERVICE = LEVEE_SERVICE;
exports.AUTH_TOKEN = AUTH_TOKEN;