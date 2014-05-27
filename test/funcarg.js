function Arg() {}

Arg.prototype = Object.create(Array.prototype);

var funcarg = new Arg;
funcarg.push({ "name": "sig1", "data": [ { "foo1": "bar" } ] });
funcarg.push({ "name": "sig2", "data": [ { "foo2": "bar" } ] });
funcarg['sig1'] = funcarg['0'];
funcarg['sig2'] = funcarg['1'];

console.log("TEST OBJECT:", JSON.stringify(funcarg, null, 2));

console.log("1. LENGTH:", funcarg.length);
console.log("2. forEach:");
funcarg.forEach(function(arg) {
    console.log("   ", arg);
});
console.log("3. for var i in... :");
for (var i in funcarg) {
    console.log("  ", i, "->", funcarg[i]);
}

console.log("4. Object.keys(funcarg):");
console.log("  ", Object.keys(funcarg));
