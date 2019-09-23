// readVars: small utility that reads variables to be used in rendering of the worklow JSON (using "mustache" for templating)
//   @param configFilePaths -- JSON config files to read variables from
//   @param additionalVars -- variables read and passed by the caller (e.g. from command line parameters) -- will be included in the final array of variables
// format: array ['name=value', 'name=value', 'name=value']
//
// TODO: implement support for config files
function readVars(configFilePaths, additionalVars) {

    var vars = {};

    // Note that in the case of name conflict, variables read in step 1. will be overridden by 
    // those read in step 2., and then in step 3.

    // 1. add variables passed to the function
    if (additionalVars) {
        additionalVars.forEach(function(vStr) {
            vArr=vStr.split('=');
            vars[vArr[0]]=vArr[1];
        });
    }


    // 2. add variables read from local config files 
    // files should contain JSON objects in the form: { name: value, name: value }
    if (configFilePaths) {
        configFilePaths.forEach(function(file) {
            // TODO: not implemented
        });
    }

    // 3. read variables from the environment variables (HF_VAR_XX=YY, where XX will be the var name, YY the value)
    Object.keys(process.env).forEach(function(envName) {
        if (envName.startsWith('HF_VAR_')) {
           //onsole.log(process.env[envName]);
           varName = envName.substring(7);
           varValue = process.env[envName];
           vars[varName] = varValue;
        }
    });

    return vars;
}

module.exports=readVars;
