function sqr(ins, outs, context, cb) {
    var n = Number(ins.number.data[0]);

    if (context.recovered) {
        return cb(null, outs);
        console.log("RECOVERY MODE!!!");
        console.log(outs);
    }

    /*if (n == 5) {
        process.exit(1); // emulate crash
    }*/
    outs.square.data = [n * n];
    setTimeout(function() {
        cb(null, outs);
    }, Math.random() * 3000);
}

// stateful function
var cnt=0;
var acc=0.0;
function sum(ins, outs, context, cb) {
    /*if (context.recovered) {
        return cb(null, outs);
        console.log("RECOVERY MODE!!!");
        console.log(outs);
    }*/

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
