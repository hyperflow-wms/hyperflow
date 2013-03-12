function add(ins, outs, cb) {
    var sum=0;
    for (var i=0; i<ins.length; ++i) {
        ++sum;
    }
    outs[0].value = sum;
    cb(null, outs);
}

exports.add = add;
