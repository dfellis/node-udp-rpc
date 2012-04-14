var udpRpc = require('../lib/udp-rpc.js');

var testFuncs = [
	function echo(source, text, callback) {
		callback(text);
	}
];

var inited = 0;
var node1 = new udpRpc('udp4', 12345, testFuncs);
var node2 = new udpRpc('udp4', 11235, testFuncs);

node1.on('init', whenInited);
node2.on('init', whenInited);

node1.on('death', function() { console.log("I died..."); });
node1.on('execRpc', function(method, address, rpcParams, callback) { console.log("Executing " + method + " at " + address); });
node1.on('sentRpc', function(method, address, rpcParams, callback, err) { console.log("Executed " + method + " at " + address + (err ? " and received this error: " + err : "")); });
node1.on('receivedPacket', function(message, info) { console.log("Processing a UDP packet from: " + info.address); });
node1.on('receivedRpcResponse', function(message, source) { console.log("Received the following RPC response: " + message); });

node2.on('receivedRpcRequest', function(message, source) { console.log("Received the following RPC request: " + message); });

node1.on('receivedUnknownMessage', function() { console.log("This won't happen."); });
node2.on('receivedUnknownMessage', function() { console.log("This won't happen."); });

function whenInited() {
	inited++;
	if(inited == 2) {
		node1.echo('localhost:11235', 'Hello!', function(text) {
			console.log('Final results: ' + text);
			node1.die();
			node2.die();
		});
	}
}
