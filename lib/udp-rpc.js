'use strict';
var dgram = require('dgram');
var crypto = require('crypto');

function execRpc(method, address) {
	var rpcParams = Array.prototype.slice.call(arguments, 2);
	var callback = rpcParams.pop();
	var addrArray = address.split(":");
	var messageId = this.genId();
	var payload = new Buffer(([method].concat(messageId, rpcParams)).join(','));

	if(payload.length > 500) { throw new Error('Payload too large'); }

	var self = this;
	this.dgram.send(payload, 0, payload.length, addrArray[1], addrArray[0], function(err) {
		if(err instanceof Error) {
			return callback(err);
		} else {
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

function receiveRpc(message, info) {
	var messageArr = message.toString('utf8').split(',');
	// Determine type of message: RPC response, request
	if(typeof this.messages[messageArr[0]] == 'object' &&
		info.port == this.messages[messageArr[0]].port) {
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

			if(payload.length > 500) {
				var payload = new Buffer(([messageId].concat("Payload too large")).join(','));
			}
			// Currently hardwired to port 12345; will look into alternatives
			self.dgram.send(payload, 0, payload.length, info.port, info.address, function(err) {
				if(err instanceof Error) { throw err; } // RPC server non-functional, this is fatal
			});
		});
		// Execute the requested RPC method
		this.methods[messageArr[0]].apply(this, params);
	}
	// If packet is not understood, ignore it
}

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
