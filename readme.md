# node-udp-rpc

A lightweight UDP-based RPC protocol for Node.js inspired by (but definitely not conformant with) JSON-RPC

## UDP Packet Format

    flagId packetNumber xor  data
      0       1 - 4      5  6 - 500

Each packet starts with a byte that identifies the packet group and whether this is the last packet in the set (flagId, 7-bit identifier with top bit a last packet flag).

After this, a 32-bit unsigned integer tags each packet in the order it should be reconstituted. May reconsider the size of this integer -- it allows RPC requests/responses **1.92TB** in size. There's not enough error correction in this lightweight protocol for that, no way to rerequest a particular packet (nor desire since that would imply caching overhead and knowledge of higher layers of the protocol), and arbitrary size responses can be implemented above this layer by requesting fragments of the data consecutively or in parallel.

Each packet contains a 1 byte xor of the data that follows it (or in the case of the last packet, an xor of all data transmitted.

It should be possible to write a streaming implementation of this packet format, but I have not done so for this first implementation. (Don't even have proper tests, yet.)

It's the sender's responsibility to make sure the ID used is unique for all messages sent but not yet acted upon, and it's the receivers duty to make sure it keeps received IDs separated from different sources (because collisions are obviously possible between different senders).

## RPC Format

### Request

    methodName,uniqueID,param1,param2,...,paramN

### Response

    uniqueID,result1,result2,...,resultN

Above the packet format, the RPC protocol consists of a simple comma-separated value array of data. For the Request, the first two parameters are reserved for the method to be executed and a uniqueID that the server will use in its response to identify the results correctly. Only this uniqueID is reserved in the response. All values afterwards in the array are parameters or results of the query.

There is no enforcement of what a request or response "should" look like other than that. msgpack the parameters if you want and base64 encode it (or if you're feeling frisky, don't, and then reconstruct the original data based on the number of ``arguments`` you receive).

## Usage

After installing the library with [npm](http://npmjs.org) (``npm install udp-rpc``), you can get the constructor by:

    var UdpRpc = require('udp-rpc');

The module inherits features of both the ``events.EventEmitter`` and ``dgram`` modules. At the moment, it assumes you want to implement a "peer", an RPC server that calls other RPC servers with the exact same functions. To create such a peer, you pass the constructor three variables:

    var node = new UdpRpc(dgramType, port, arrayOfNamedFunctions);

* ``dgramType`` is taken from the [``dgram.createSocket`` method](http://nodejs.org/api/dgram.html#dgram_dgram_createsocket_type_callback) and can only be ``'udp4'`` or ``'udp6'``.
* ``port`` is taken from the [``dgram.bind`` method](http://nodejs.org/api/dgram.html#dgram_dgram_bind_port_address) and is whatever networking port number you desire.
* ``arrayOfNamedFunctions`` is exactly like it sounds like, an array consisting of functions that have been properly named:

        [
            function echo(source, text, callback) {
	        callback(text);
            },
            function whoAmI(source, callback) {
                callback(source);
            },
            function slowAdder(source, num1, num2, callback) {
                setTimeout(function() {
                    callback(num1/1 + num2/1);
                }, 10000*Math.random());
            }
        ]

    These functions are attached to the generated object using the names defined, so it would be wise to avoid all of [the public ``emitter`` methods](http://nodejs.org/api/events.html). Also the method names ``methods``, ``messages``, ``packets``, ``genId``, ``srvPort``, ``address``, ``dgram``, and ``die`` are reserved, though several of these may become private in the future and no longer conflict.

The created object emits the following events:

* ``init`` - Fired once the object is ready for usage.
* ``death`` - Fired when the object cleans itself up (right now only when explicitly calling the ``die`` method)
* ``execRpc`` - Fired when an RPC request onto a remote peer is started. Passes to the event handler the ``method`` name, the remote ``address``, an array of ``rpcParams``, and the ``callback`` function to fire when the response is completed.
* ``sentRpc`` - Fired when an RPC request onto a remote peer has completed transmission from the current peer, but before any response. The same four parameters as ``execRpc`` are passed along with an ``err`` object (that may be null if no error occured). 
* ``receivedPacket`` - Fired when the ``dgram`` server receives a packet of data of any type. Passes to the event handler the raw ``message`` and ``info`` objects as defined by the ``dgram`` method type.
* ``receivedRpcRequest`` - Fired when enough packets have been received to assemble the raw RPC string and determine that it is a request type. Passes to the event handler the ``request`` string and the ``source`` peer string.
* ``receivedRpcResponse`` - Fired when enough packets have been received to assemble the raw RPC string and determine that it is a response type. Passes to the event handler the ``response`` string and the ``source`` peer string.
* ``receivedUnknownMessage`` - Fired when enough packets have been received to assemble the raw string according to the packet format and an unrecognizable set of data is received. The ``message`` string and the ``source`` peer string are again provided.

You **must** wait for the ``init`` event before executing any of the bound RPC methods.

The RPC methods for the "server" must have at least two arguments, the very first argument is the ``source`` string, indicating to the method the IP and port number of the "client," and the very last argument is the ``callback`` method that the results are passed into. Custom arguments for the method are placed in-between.

It is the client's duty to know the arguments that must be passed in for the RPC call and the arguments it will receive when the request is completed. Calling an RPC method on a remote server also requires at least two arguments, the ``remote`` server address, and the ``callback`` function to receive the response results. For example:

    node.echo("127.0.0.1:12345", "Hello, World!", function(text) {
        console.log(text);
    });

    node.whoAmI("1.2.3.4:5", function(myPublicIPandPort) {
        console.log(myPublicIPandPort);
    });

Assuming the previously-defined RPC methods are to be used.

## License (MIT)

Copyright (C) 2012 by David Ellis

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
