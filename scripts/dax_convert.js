var PegasusConverter = require('../converters/pegasus_dax.js'),
    argv = require('optimist').argv;

var pc = new PegasusConverter();

if (!argv._[0]) {
	console.log("Usage: node dax_convert.js <DAX file path>");
	process.exit();
}

pc.convertFromFile(argv._[0], function(err, wfOut) {
	console.log(JSON.stringify(wfOut, null, 2));
});
