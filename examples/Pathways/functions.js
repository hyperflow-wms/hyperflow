var req = require('request'),
    fs = require('fs');

function bconvREST(ins, outs, config, cb) {
    var gene = "unigene:" + ins.gene.data[0],
        url = "http://rest.kegg.jp/conv/mmu/" + gene;

    req({
        "timeout": 10000,
        "url": url
    }, function(error, response, body) {
        if (error || response.statusCode != 200) { 
            throw(new Error("bconvREST response error (" + error + ")")); 
        }
        var geneId = body.match(/mmu:[0-9]{4,}/)[0];
        outs.geneId.data = [ geneId ];
        cb(null, outs);
    });
}

function getPathWayByGene(ins, outs, config, cb) {
    var geneId = ins.geneId.data[0],
        url = "http://rest.kegg.jp/link/pathway/" + geneId;

    req({
        "timeout": 10000,
        "url": url
    }, function(error, response, body) {
        if (error || response.statusCode != 200) { 
            throw(new Error("getPathWayByGene response error (" + error + ")")); 
        }
        var pathId = body.match(/path:[0-9a-z]{5,}/)[0];
        outs.pathId.data = [ pathId ];
        outs.pathwayId.data = [ body ];
        console.log(pathId);
        cb(null, outs);
    });
}

function getPathwayEntry(ins, outs, config, cb) {
    var pathId = ins.pathId.data[0],
        url = "http://rest.kegg.jp/get/" + pathId;

    req({
        "timeout": 10000,
        "url": url
    }, function(error, response, body) {
        if (error || response.statusCode != 200) { 
            throw(new Error("getPathwaEntry response error (" + error + ")")); 
        }
        outs.pathwayEntry.data = [ body ];
        var filename = pathId.replace(":", "-") + "-entry.txt";
        fs.writeFile(filename, body, { "encoding": null }, function(err) {
            console.log("ENTRY FILE WRITTEN!");
            if (err) throw err;
            cb(null, outs);
        });
    });
}

function getPathwayImage(ins, outs, config, cb) {
    var pathId = ins.pathId.data[0],
        url = "http://rest.kegg.jp/get/" + pathId + "/image";

    var filename = pathId.replace(":", "-") + "-image.png";
    var file = fs.createWriteStream(filename);

    req({
        "timeout": 10000,
        "url": url
    }).pipe(file);
    
    file.on('finish', function() {
        console.log("IMAGE FILE WRITTEN!");
        outs.pathwayImage.data = [ filename ];
        cb(null, outs);
    });
}

function btit_REST(ins, outs, config, cb) {
    var geneId = ins.geneId.data[0],
        url = "http://rest.kegg.jp/find/genes/" + geneId;

    req({
        "timeout": 10000,
        "url": url
    }, function(error, response, body) {
        if (error || response.statusCode != 200) { 
            throw(new Error("btit_REST response error (" + error + ")")); 
        }
        outs.geneDescription.data = [ body ];
        cb(null, outs);
    });
}

exports.bconvREST = bconvREST;
exports.getPathWayByGene = getPathWayByGene;
exports.getPathwayEntry = getPathwayEntry;
exports.getPathwayImage = getPathwayImage;
exports.btit_REST = btit_REST;
