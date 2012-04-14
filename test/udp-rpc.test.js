var udpRpc = require('../lib/udp-rpc.js');

var testFuncs = [
	function echo(source, text, callback) {
		console.log("In the RPC call from " + source);
		callback(text);
	}
];

var inited = 0;
var node1 = new udpRpc('udp4', 12345, testFuncs);
var node2 = new udpRpc('udp4', 11235, testFuncs);

node1.on('init', whenInited);
node2.on('init', whenInited);

function whenInited() {
	inited++;
	if(inited == 2) {
		node1.echo('localhost:11235', 'Hello!', function(text) {
			console.log("Back from localhost:11235");
			console.log(text);
			node1.die();
			node2.die();
		});
	}
}
