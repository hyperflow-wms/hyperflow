var argv = require('optimist').argv,
           daxf = require('../pegasus_dax_converter');

daxf.createWorkflowFromFile(argv._[0], function(err, rep) {
	console.log(JSON.stringify(rep));
});
