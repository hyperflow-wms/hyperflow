var redis = require('redis'),
    rcl = redis.createClient();


rcl.hgetall("non-existing-key", function(err, ret) {
	console.log(ret);
});

rcl.hgetall("wf:1:task:1", function(err, ret) {
	console.log(ret);
});

var t = [];
console.log(t.length);
t[100] = true;
console.log(t.length);
t[1000000] = true;
console.log(t.length);
console.log(t[999]);

