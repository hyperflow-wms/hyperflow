var a = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];

	var y=0;
a.forEach(function(x) {
	setTimeout(function() { console.log("y=",++y); }, x*100);
	console.log(x);
});
