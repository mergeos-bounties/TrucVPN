"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const net = require("node:net");
const { createHttpProxy } = require("../src/proxy/http");

function getFreePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

test("HTTP CONNECT proxy accepts CONNECT and dials direct exit", async () => {
  // Fake target server
  const targetPort = await getFreePort();
  const target = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("hello-from-target");
  });
  await new Promise((r) => target.listen(targetPort, r));

  // Start proxy with no exit (direct dial)
  const proxyPort = await getFreePort();
  const proxy = createHttpProxy({ getExit: () => null, meter: null });
  await new Promise((r) => proxy.listen(proxyPort, r));

  // Issue a CONNECT request
  const got = await new Promise((resolve, reject) => {
    const client = net.connect(proxyPort, () => {
      client.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`);
    });
    let buf = "";
    client.on("data", (c) => {
      buf += c.toString();
      if (buf.includes("\r\n\r\n")) {
        const statusLine = buf.split("\r\n")[0];
        if (statusLine.includes("200")) {
          // Send a plain HTTP GET through the tunnel
          client.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
        } else {
          client.destroy();
          reject(new Error("CONNECT failed: " + statusLine));
        }
      }
      if (buf.includes("hello-from-target")) {
        resolve(true);
        client.destroy();
      }
    });
    client.on("error", reject);
    setTimeout(() => { client.destroy(); reject(new Error("timeout")); }, 5000);
  });

  assert.ok(got, "should receive response through CONNECT tunnel");

  proxy.close();
  target.close();
});

test("HTTP CONNECT returns 400 for malformed target", async () => {
  const proxyPort = await getFreePort();
  const proxy = createHttpProxy({ getExit: () => null, meter: null });
  await new Promise((r) => proxy.listen(proxyPort, r));

  const status = await new Promise((resolve) => {
    const client = net.connect(proxyPort, () => {
      client.write("CONNECT not-a-valid-host HTTP/1.1\r\nHost: x\r\n\r\n");
    });
    let buf = "";
    client.on("data", (c) => {
      buf += c.toString();
      if (buf.includes("\r\n")) {
        resolve(buf.split("\r\n")[0]);
        client.destroy();
      }
    });
    setTimeout(() => { client.destroy(); resolve("timeout"); }, 3000);
  });

  assert.ok(status.includes("400") || status.includes("502") || status.includes("403"),
    "should reject malformed CONNECT target, got: " + status);
  proxy.close();
});
