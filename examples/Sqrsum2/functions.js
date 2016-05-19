function sqr(ins, outs, context, cb) {
    var n = Number(ins.number.data[0]);
    outs.square.data = [n * n];
    setTimeout(function() {
        cb(null, outs);
    }, Math.random() * 3000);
}

// stateful function
var cnt=0;
var acc=0.0;
function sum(ins, outs, context, cb) {
    if (context.recovered) {
        console.log("Recovered invocation...");
        if (cnt == 3) {
            cnt = 0; acc = 0;
            return cb(null, outs);
        }
    }

    var n=ins[0].data[0];
    acc += n;
    cnt += 1;

    if (cnt < 3) {
        cb(null, null);
    } else {
        console.log(acc);
        outs.sum.data = [acc];
        cnt = 0; acc = 0;
        cb(null, outs);
    }
}

exports.sqr = sqr;
exports.sum = sum;
