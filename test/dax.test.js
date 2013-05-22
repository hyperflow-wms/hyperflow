var argv = require('optimist').argv,
           PegasusConverter = require('../converters/pegasus_dax.js');

var daxf = new PegasusConverter();

if (!argv._[0]) {
	console.log("Usage: node dax.test.js <path/to/dax/file.xml>");
	process.exit();
}

daxf.convertFromFile(argv._[0], function(err, rep) {
	console.log(JSON.stringify(rep, null, 2));
});
