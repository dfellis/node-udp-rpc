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

See the test script for now.

## License (MIT)

Copyright (C) 2012 by David Ellis

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
