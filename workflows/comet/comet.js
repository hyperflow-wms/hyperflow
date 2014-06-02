var fs = require("fs"),
    xpath = require("xpath"),
    dom = require("xmldom").DOMParser,
    spawn = require('child_process').spawn;



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

function partitionData(ins, outs, config, cb) {
    var xmlData = ins[0].data[0].value,
        doc = new dom().parseFromString(xmlData),
        xmlPath = "//Collection[@label='CollectionPoint']",
        nodes = xpath.select(xmlPath, doc);

    var timeWindowLength = 43200; // 12 hours

    outs[0].data = [[]];
    var t = 0, idx = 0, first = true;
    var timestamp, humidity, tref;

    nodes.forEach(function(node) {
        if (t >= timeWindowLength) {
            t -= timeWindowLength; idx += 1;
            first = true;
        }
        tref = timestamp;
        timestamp = Number(xpath.select("Data[@label='timestamps']/text()", node).toString());
        if (first) { first = false; tref = timestamp; }
        humidity = Number(xpath.select("Data[@label='humidity']/text()", node).toString());
        t += timestamp - tref;
        if (outs[0].data[0][idx]) {
            outs[0].data[0][idx].push(timestamp, humidity);
        } else {
            outs[0].data[0][idx] = [timestamp, humidity];
        }
    });

    cb(null, outs);
}

function computeStats(ins, outs, config, cb) {
    var tBase = Number(ins.config.data[0].baseTemp),
        dsets = ins.dataParts.data[0],
        min, max, gdd;

    stats = [];
    dsets.forEach(function(d) {
        var t = d[0]; // time stamp for the min/max/gdd
        var min = -1, max = -1, gdd;
        for (var i=0; i<d.length; i+=2) {
            if (min == -1 || min > d[i+1]) { min = d[i+1]; }
            if (max == -1 || max < d[i+1]) { max = d[i+1]; }
        }
        gdd = max < tBase ? 0: (min+max)/2 - tBase; 
        stats.push({"timestamp": t, "min": min, "max": max, "gdd": gdd})
        
    });
    outs[0].data = [stats];
    cb(null, outs);
}

function plotData(ins, outs, config, cb) {
    var hrtime = process.hrtime();
    var fileName = "data" + hrtime[0] + hrtime[1];
    var Rscript = '\n\
        data <- read.csv("' + fileName + '.csv")\n\
        png(filename="' + fileName + '.png")\n\
        with(data, plot(timestamp, min, type="l", col="red", ylab="", ylim=c(0.0,100.0)))\n\
        with(data, lines(timestamp, max, type="l", col="blue"))\n\
        with(data, lines(timestamp, gdd, type="l", col="green"))\n\
        legend("topright", legend=c("min", "max", "gdd"), lty=1,col=c("red", "blue", "green"), bty="n", cex=.75)\n\
        x <- dev.off()';

    var stats = ins.stats.data[0];
    fs.writeFile(fileName+".R", Rscript, function(err) {
        if (err) throw err;
        var data = "timestamp,min,max,gdd\n";
        var d = ins[0].data[0];
        for (var i=0; i<d.length; i+=2) {
            data += d[i].timestamp+","+d[i].min+","+d[i].max+","+d[i].gdd+"\r\n";
        }
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
                outs[0].data = [{}];
                cb(null, outs);
            });
        });
    });
}

function collectGraphs(ins, outs, config, cb) {
    console.log("All plots generated, exiting...");
    cb(null, outs);
    process.exit();
}

function genTimeWindows(ins, outs, config, cb) {
    var start_time = Number(ins.config.data[0].start_time),
        end_time = Number(ins.config.data[0].end_time);

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
    cb(null, outs);
}

//var data = [ { "start_time": "1.196499599E9", "end_time": "1.197359999E9" } ]
//genTimeWindows([{ "data": data }], null, null, null);

exports.genXmlCollection = genXmlCollection;
exports.partitionData = partitionData;
exports.plotData = plotData;
exports.genTimeWindows = genTimeWindows;
exports.computeStats = computeStats;
exports.collectGraphs = collectGraphs;
