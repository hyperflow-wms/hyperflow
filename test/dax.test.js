var daxf = require('../pegasus_dax_converter');

daxf.createWorkflowFromFile('Montage_10k.xml', function(err, rep) {
	console.log(JSON.stringify(rep));
});
