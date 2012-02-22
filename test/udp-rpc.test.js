var udpRpc = require('../lib/udp-rpc.js');

var testFuncs = [
	function echo(source, text, callback) {
		console.log("In the RPC call from " + source);
		callback(text);
	}
];

var inited = 0;
var drone1 = new udpRpc('udp4', 12345, testFuncs, whenInited);
var drone2 = new udpRpc('udp4', 11235, testFuncs, whenInited);
function whenInited() {
	inited++;
	if(inited == 2) {
		drone1.echo('localhost:11235', 'Hello!', function(text) {
			console.log("Back from localhost:11235");
			console.log(text);
			drone1.die();
			drone2.die();
		});
	}
}
