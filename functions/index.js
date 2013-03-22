function add(ins, outs, cb) {
    var sum=0.0;
    for (var i=0; i<ins.length; ++i) {
        if ("value" in ins[i]) {
            sum += parseFloat(ins[i].value);
        }
    }
    outs[0].value = sum;
    cb(null, outs);
}

function sqr(ins, outs, cb) {
    if (!("value" in ins[0])) {
        outs[0].value = "functions:sqr : no input value provided";
    } else {
        var v = parseFloat(ins[0].value);
        outs[0].value =  v * v;
    }
    cb(null, outs);
}

exports.add = add;
exports.sqr = sqr;
