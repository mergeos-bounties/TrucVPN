"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { createHttpProxyServer } = require("../src/proxy/http");
const { BandwidthMeter } = require("../src/meter");

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function onceData(socket) {
  return new Promise((resolve, reject) => {
    socket.once("data", resolve);
    socket.once("error", reject);
  });
}

describe("http connect proxy", () => {
  it("accepts CONNECT and tunnels data to a direct exit", async () => {
    const upstreamSockets = new Set();
    const upstream = net.createServer((socket) => {
      upstreamSockets.add(socket);
      socket.once("close", () => upstreamSockets.delete(socket));
      socket.once("data", (chunk) => {
        socket.write(Buffer.from(`echo:${chunk.toString("utf8")}`));
      });
    });
    const upstreamAddress = await listen(upstream);

    const meter = new BandwidthMeter();
    const proxy = await createHttpProxyServer({
      host: "127.0.0.1",
      port: 0,
      getExit: () => ({ id: "direct-test", protocol: "direct" }),
      meter
    });
    const proxyAddress = proxy.address();
    let client;

    try {
      client = net.connect({ host: proxyAddress.address, port: proxyAddress.port });
      await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });

      client.write(
        `CONNECT ${upstreamAddress.address}:${upstreamAddress.port} HTTP/1.1\r\n` +
          `Host: ${upstreamAddress.address}:${upstreamAddress.port}\r\n\r\n`
      );

      const response = await onceData(client);
      assert.match(response.toString("utf8"), /^HTTP\/1\.1 200 Connection Established/);

      client.write("ping");
      const tunneled = await onceData(client);
      assert.equal(tunneled.toString("utf8"), "echo:ping");
      assert.equal(meter.snapshot().bytes_out >= 4, true);
      assert.equal(meter.snapshot().bytes_in >= 9, true);

      client.destroy();
    } finally {
      if (client) {
        client.destroy();
      }
      for (const socket of upstreamSockets) {
        socket.destroy();
      }
      await Promise.all([
        new Promise((resolve) => proxy.close(resolve)),
        new Promise((resolve) => upstream.close(resolve))
      ]);
    }
  });
});
