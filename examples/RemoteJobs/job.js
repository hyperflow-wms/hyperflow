#!/usr/bin/env node

// 3 seconds of high CPU load and 3 seconds of no CPU load

var t0 = (new Date()).getTime();

function loadCpu(ms) {
	var result = 0;
	for (i=0; i<100; i++) {
	   result += Math.random() * Math.random();
	}
	var now = new Date().getTime();
	if (now - t0 > ms) {
		setTimeout(function() {
			process.exit(0);
		}, 3000);
		return;
	}
	process.nextTick(loadCpu, ms);
}

loadCpu(3000);


