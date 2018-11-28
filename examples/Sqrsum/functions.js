function sqr(ins, outs, config, cb) {
    var n = Number(ins.number.data[0]);
    if (n == 5) {
	    process.exit(1); // emulate crash
    }
    outs.square.data = [n * n];
    setTimeout(function() {
        cb(null, outs);
    }, Math.random() * 3000);
}

function sum(ins, outs, config, cb) {
    var sum=0.0;
    ins.square.data.forEach(function (n) {
        sum += n;
    });
    outs[0].data = [ sum ];
    console.log(sum);
    cb(null, outs);
}

exports.sqr = sqr;
exports.sum = sum;
