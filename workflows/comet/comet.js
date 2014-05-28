var fs = require("fs"),
    xpath = require("xpath"),
    dom = require("xmldom").DOMParser,
    spawn = require('child_process').spawn;

function genTimeWindows(ins, outs, config, cb) {
    var start_time = Number(ins[0].data[0].start_time),
        end_time = Number(ins[0].data[0].end_time);

    console.log(start_time, end_time);

    var t0, windows = [];
    t0 = start_time;

    // generates 12-hour (43200 seconds) and 24-hour windows (
    while (t0 + 43200 <= end_time) {
        windows.push([t0, t0+43200]);
        if (t0 + 86400 <= end_time) {
            windows.push([t0, t0+86400]);
        }
        t0 += 43200; // "advance" time by 12 hours
    }
    console.log("WINDOWS:", JSON.stringify(windows, null, 2));
}

//var data = [ { "start_time": "1.196499599E9", "end_time": "1.197359999E9" } ]
//genTimeWindows([{ "data": data }], null, null, null);

function genXmlCollection(ins, outs, config, cb) {
    var xmlData, xmlPath = ins[1].data[0].xpath;

    var genCollection = function() {
        var doc = new dom().parseFromString(xmlData),
            nodes = xpath.select(xmlPath, doc);

        data = [];
        nodes.forEach(function(node) {
            data.push({ "value": node.toString()});
        });
        //onsole.log("DATA:", data);
        //onsole.log("LENGTH:", data.length);
        outs[0].data = data;
        //onsole.log(nodes[0].localName + ": " + nodes[0].firstChild.data)
        
        //onsole.log(nodes[0].toString());
        cb(null, outs);
    }

    //onsole.log("INS", JSON.stringify(ins));
    if (ins[0].data[0].path) {
        fs.readFile(ins[0].data[0].path, { "encoding": "ascii" }, function(err, data) {
            //console.log(err, data);
            if (err) throw err;
            xmlData = data;
            genCollection();
        });
    } else {
        xmlData = ins[0].data[0].value;
        genCollection();
    }
}


function genDataSets(ins, outs, config, cb) {
    var xmlData = ins[0].data[0].value,
        doc = new dom().parseFromString(xmlData),
        xmlPath = "//Collection[@label='CollectionPoint']",
        nodes = xpath.select(xmlPath, doc);

    console.log("DATA NODES:", nodes.length);

    outs[0].data = [[]];
    nodes.forEach(function(node) {
        var timestamp = xpath.select("Data[@label='timestamps']/text()", node).toString();
        var humidity = xpath.select("Data[@label='humidity']/text()", node).toString();
        outs[0].data[0].push([timestamp, humidity]);
        //console.log(timestamp, humidity);
    });

    cb(null, outs);
}

function plotData(ins, outs, config, cb) {
    var fileName = "data" + (new Date()).getTime();
    var Rscript = '\r\n\
        data <- read.csv("' + fileName + '.csv")\r\n\
        png(filename="' + fileName + '.png")\r\n\
        plot(data, type="l")\r\n\
        nil <- dev.off()';

    fs.writeFile(fileName+".R", Rscript, function(err) {
        if (err) throw err;
        var data = "timestamp,humidity\r\n";
        ins[0].data[0].forEach(function(p) {
            data += p[0]+","+p[1]+"\r\n";
        });
        fs.writeFile(fileName+".csv", data, function(err) {
            if (err) throw err;
            var proc = spawn("R", ["--vanilla", "-q", "-f", fileName + ".R" ]);

            proc.stderr.on('data', function(data) {
                console.log(data.toString());
            });

            proc.stdout.on('data', function(data) {
                console.log(data.toString());
            });

            proc.on('exit', function(code) {
                fs.unlinkSync(fileName + ".csv");
                fs.unlinkSync(fileName + ".R");
                console.log("EXITING...");
                cb(null, outs);
            });
        });
    });
}

exports.genXmlCollection = genXmlCollection;
exports.genDataSets = genDataSets;
exports.plotData = plotData;
