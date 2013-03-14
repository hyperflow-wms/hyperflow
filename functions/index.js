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

exports.add = add;
