/* Hypermedia workflow. 
 ** Implements a 'delta' resource for hypermedia workflow which
 ** returns changes occurred in the status of workflow resources
 ** since the last check.
 ** Author: Bartosz Balis (2013)
 */

exports.init = function() {
	var deltaAll = []; // table of all delta resources (private)

	function public_create(id) {
		deltaAll[id] = {
			"events" : []
		};
	}

	function public_addEvent(id, key, value) {
		if (id in deltaAll) {
			var now=new Date().getTime(); 
			deltaAll[id].events.push({'time': now, 'key': key, 'value': value});
		} else {
			return new Error("Delta resource not found");
		}
	}

	function public_getDelta(id, from) {
		var res = [];
		if (id in deltaAll) {
			foreach(deltaAll[id].events, function(ev) {
				if (parseInt(ev.time) > parseInt(from)) {
					res.push({'k': ev.key, 'v': ev.value});
				}
			});
			return res;
		} else {
			return new Error("Delta resource not found");
		}
	}

	return {
		create: public_create,
		addEvent: public_addEvent,
		getDelta: public_getDelta
	};

	// private functions
	function foreach(what, cb) {
		function isArray(what) {
			return Object.prototype.toString.call(what) === '[object Array]';
		}

		if (isArray(what)) {
			for (var i = 0, arr = what; i < what.length; i++) {
				cb(arr[i]);
			}
		}
		else {
			cb(what);
		}
	}
};
