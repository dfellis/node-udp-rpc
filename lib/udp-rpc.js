'use strict';
var dgram = require('dgram');
var crypto = require('crypto');
var async = require('async');

// The header flag for udp-rpc packet reconstruction
var flags = {
	// Reserved: 1, 2, 4, 8, 16, 32, 64
	lastPacket: 128
};

// Helper function to generate Xor bytes
function bufXor(buf) {
	var out = 0;
	for(var i = 0; i < buf.length; i++) {
		out = out ^ buf.readUInt8(i, true);
	}
	return out;
}

// Helper function for generating a unique byte for the flag/id byte
function uniqId(usedList) {
	var id = 0;
	do {
		id = (Math.random() * (Math.pow(2, 8) - 1)) & 127; // Get a random byte and trim the top bit off
	} while(typeof usedList[id] != 'undefined')
	return id;
}

// Called when the client wants to call a remote rpc method
function execRpc(method, address) {
	if(!method || !address) { throw new Error("Did not receive a valid RPC request!"); }
	// Construct the payload to send to the remote server
	var rpcParams = Array.prototype.slice.call(arguments, 2);
	var callback = rpcParams.pop();
	var addrArray = address.split(":");
	var messageId = this.genId();
	var payload = new Buffer(([method].concat(messageId, rpcParams)).join(','));
	var self = this;

	sendMessage.call(this, address, payload, function allSent(err) {
		if(err instanceof Error) { callback(err) }
		else {
			self.messages[messageId] = {
				callTs: new Date(),
				callback: callback,
				method: method,
				ip: addrArray[0],
				port: addrArray[1],
				rpcParams: rpcParams // This is for debugging purposes only
			};
		}
	});
}

function sendMessage(address, payload, callback) {
	var addrArray = address.split(":");

	// Construct the 6 byte header elements of the udp-rpc protocol for message verification/splitting
	if(!this.packets[address]) {
		this.packets[address] = {};
	}
	var currFlags = uniqId(this.packets[address]);
	var totXor = bufXor(payload);

	// Construct an array of payload fragments, each no larger than 494 bytes
	var payloads = [];
	if(payload.length > 494) {
		var i = 0;
		for(i = 0; i < payload.length; i += 494) {
			var newPayload = new Buffer(494);
			payload.copy(newPayload, 0, i, i+493);
			payloads.push(newPayload);
		}
		if(i < payload.length) {
			var newPayload = new Buffer(payload.length - i);
			payload.copy(newPayload, 0, i, payload.length-1);
			payloads.push(newPayload);
		}
	} else {
		payloads.push(payload);
	}
	var self = this;
	// For each payload fragment, generate the payload header, construct the output message, and send it
	async.forEach(payloads, function sendPayload(payload, callback) {
		var message = new Buffer(payload.length+6);
		var packetNumber = payloads.indexOf(payload);
		currFlags &= 127;
		message.writeUInt32BE(packetNumber, 1, true);
		var curXor = bufXor(payload);
		if(packetNumber == payloads.length - 1) {
			currFlags |= flags.lastPacket;
			message.writeUInt8(totXor, 5, true);
		} else {
			message.writeUInt8(curXor, 5, true);
		}
		message.writeUInt8(currFlags, 0, true);
		payload.copy(message, 6);
		self.dgram.send(message, 0, message.length, addrArray[1], addrArray[0], function(err) {
			if(err instanceof Error) { return callback(err); }
			return callback();
		});
	// When all are sent, or an error occurred, execute the callback
	}, callback);
}

// Called when a remote message is received. This could be an rpc request or response
function receiveRpc(message, info) {
	// Extract the header and body of the message
	var header = {
		flagid: message.readUInt8(0, true),
		packetNumber: message.readUInt32BE(1, true),
		xor: message.readUInt8(5, true)
	};
	var body = message.slice(6);

	var source = info.address + ":" + info.port;
	if(!this.packets[source]) {
		this.packets[source] = {};
	}
	if(!this.packets[source][header.flagid]) {
		this.packets[source][header.flagid] = [];
	}
	this.packets[source][header.flagid].push({
		header: header,
		body: body
	});
	attemptProcessing.call(this, source, header.flagid);
}

function attemptProcessing(source, id) {
	// Get the packet array to work on
	var packetArray = this.packets[source][id];
	// Tag the set of first and last packets in the packet array
	var integerSum = 0;
	var totalMessageLen = 0;
	var lastPacket = false;
	for(var i = 0; i < packetArray.length; i++) {
		integerSum += packetArray[i].header.packetNumber+1;
		totalMessageLen += packetArray[i].body.length;
		if(!!(packetArray[i].header.flagid & flags.lastPacket)) {
			lastPacket = true;
		}
	}
	// If there is no last packet, processing impossible
	// Also, if the sum of packet numbers isn't n(n+1)/2, there must be a missing packet
	if(!lastPacket || integerSum != (packetArray.length*(packetArray.length+1)/2)) {
		return;
	}
	// Sort the array of packets based on packet number, since we can process this data
	packetArray = packetArray.sort(function(a, b) {
		return a.header.packetNumber - b.header.packetNumber;
	});
	// Build the full message buffer from the sorted packets
	var fullMessage = new Buffer(totalMessageLen);
	for(var i = 0, j = 0; i < packetArray.length; j += packetArray[i].body.length, i++) {
		packetArray[i].body.copy(fullMessage, 0, j);
	}
	// Remove the saved packets from the packets object and pass the message to the processMessage
	delete this.packets[source][id];
	processMessage.call(this, fullMessage, source);
}

function processMessage(message, source) {
	var sourceArr = source.split(':');
	var messageArr = message.toString('utf8').split(',');
	// Determine type of message: RPC response, request
	if(typeof this.messages[messageArr[0]] == 'object' &&
		sourceArr[1] == this.messages[messageArr[0]].port) {
		// If a response, the message array consists of the request id and response results
		// Find the appropriate callback
		this.messages[messageArr[0]].callback.apply(this, messageArr.slice(1));
		delete this.messages[messageArr[0]];
	} else if(typeof this.methods[messageArr[0]] == 'function') {
		// If a request, the message array consists of the request method, id, and parameters, in that order
		var messageId = messageArr[1];
		var params = messageArr.slice(2);
		// Parameters sent to the RPC method start with the source string, in case they need to know who is calling (simple state tracking)
		params.unshift(source);
		var self = this;
		// Automatically insert a callback to the params passed to the RPC method to handle the results
		params.push(function rpcCallback() {
			var payload = new Buffer(([messageId].concat(Array.prototype.slice.call(arguments, 0))).join(','));

			sendMessage.call(self, source, payload, function(err) {
				if(err instanceof Error) { throw err; } // RPC server non-functional, this is fatal
			});
		});
		// Execute the requested RPC method
		this.methods[messageArr[0]].apply(this, params);
	}
	// If packet is not understood, ignore it
}

// UDP-RPC object to provide a nice interface to the protocol and properly initialize/destroy it.
// I can't find a way to execute a function on ``delete`` like you can with get/set, so destroy this
// object with the ``die`` method.
function udpRpc(ipType, srvPort, methods, callback) {
	this.methods = {};
	this.messages = {};
	this.packets = {};
	for(var i in methods) {
		Object.defineProperty(this, methods[i].name, {
			enumerable: true,
			configurable: false,
			writable: false,
			value: execRpc.bind(this, methods[i].name)
		});
		Object.defineProperty(this.methods, methods[i].name, {
			enumerable: true,
			configurable: false,
			writable: false,
			value: methods[i]
		});
	}
	this.genId = function() {
		var id = "";
		do {
			try {
				id = crypto.randomBytes(3).toString('base64');
			} catch(e) {
				id = new Buffer(Math.random() * (Math.pow(2, 24) - 1)).toString('base64');
			}
		} while(typeof this.messages[id] != 'undefined')
		return id;
	};
	this.srvPort = srvPort;
	this.dgram = dgram.createSocket(ipType);
	this.address = undefined;
	var self = this;
	this.dgram.on('listening', function udpRpcStart() {
		self.address = self.dgram.address();
		callback(self);
	});
	this.dgram.on('message', receiveRpc.bind(this));
	this.dgram.bind(srvPort); // Currently hardwired; will look into alternatives
	this.die = function die() {
		this.dgram.close();
		delete this;
	};
	return this;
}

exports = module.exports = udpRpc;
