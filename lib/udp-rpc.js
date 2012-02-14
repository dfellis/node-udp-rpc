'use strict';
var dgram = require('dgram');
var crypto = require('crypto');
var async = require('async');

// The header flags for udp-rpc packet reconstruction
var flags = {
	// Reserved: 1, 2, 4, 8, 16, 32
	firstPacket: 64,
	hasNextPacket: 128
};

// Helper function to generate Xor bytes
function bufXor(buf) {
	var out = 0;
	for(var i = 0; i < buf.length; i++) {
		out = out ^ buf.readUInt8(i, true);
	}
	return out;
}

// Called when the client wants to call a remote rpc method
function execRpc(method, address) {
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

	// Construct the 3 byte header elements of the udp-rpc protocol for message verification/splitting
	var currFlags = 0;
	var curXor = bufXor(payload);
	var totXor = curXor;

	// Construct an array of payload fragments, each no larger than 497 bytes
	var payloads = [];
	if(payload.length > 497) {
		var i = 0;
		for(i = 0; i < payload.length; i += 497) {
			var newPayload = new Buffer(497);
			payload.copy(newPayload, 0, i, i+496);
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
		var message = new Buffer(payload.length+3);
		var currFlags = 0;
		curXor = bufXor(payload);
		if(payloads.indexOf(payload) == 0) {
			currFlags |= flags.firstPacket;
		}
		if(payloads.lastIndexOf(payload) == payloads.length - 1) {
			message.writeUInt8(totXor, 2, true);
		} else {
			currFlags |= flags.hasNextPacket;
			var neXor = bufXor(payloads[payloads.lastIndexOf(payload)+1]);
			message.writeUInt8(neXor, 2, true);
		}
		message.writeUInt8(currFlags, 0, true);
		message.writeUInt8(curXor, 1, true);
		payload.copy(message, 3);
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
		flags: message.readUInt8(0, true),
		curXor: message.readUInt8(1, true),
		neXor: message.readUInt8(2, true)
	};
	var body = message.slice(3);

	var source = info.address + ":" + info.port;
	if(!this.packets[source]) {
		this.packets[source] = [];
	}
	this.packets[source].push({
		header: header,
		body: body
	});
	attemptProcessing.call(this, source);
}

function attemptProcessing(source) {
	// Get the packet array to work on
	var packetArray = this.packets[source];
	// Tag the set of first and last packets in the packet array
	var firstPackets = [], lastPackets = [];
	for(var i = 0; i < packetArray.length; i++) {
		if(!!(packetArray[i].header.flags & flags.firstPacket)) {
			firstPackets.push(packetArray[i]);
		}
		if(!(packetArray[i].header.flags & flags.hasNextPacket)) {
			lastPackets.push(packetArray[i]);
		}
	}
	// If there are no first or last packets, processing impossible
	if(firstPackets.length == 0 || lastPackets.length == 0) {
		return;
	}
	var self = this;
	firstPackets.forEach(function(packet) {
		// If this packet is part of a chain
		if(packet.flags & flags.hasNextPacket) {
			// TODO: Follow linked list implied by headers. 
			// May need to alter protocol to handle repeated XORs
		// If this is a standalone packet message
		} else {
			processMessage.call(self, packet.body, source);
		}
	});
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
	this.srvPort = srvPort;
	this.dgram = dgram.createSocket(ipType);
	this.address = undefined;
	var self = this;
	this.dgram.on('listening', function udpRpcStart() {
		self.address = self.dgram.address();
		callback();
	});
	this.dgram.on('message', receiveRpc.bind(this));
	this.dgram.bind(srvPort); // Currently hardwired; will look into alternatives
	this.die = function die() {
		this.dgram.close();
		delete this;
	};
	this.methods = {};
	this.messages = {};
	this.packets = {};
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
	return this;
}

exports = module.exports = udpRpc;
