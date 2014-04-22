var DAP_URL  = process.env.DAP_URL ? process.env.DAP_URL : "https://atmo.moc.ismop.edu.pl/";
var AUTH_TOKEN = process.env.AUTH_TOKEN ? process.env.AUTH_TOKEN : "";
var LEVEE_SERVICE = "api/levees/"

//exports
exports.dap_url = DAP_URL;
exports.levee_service = LEVEE_SERVICE;
exports.auth_token = AUTH_TOKEN;