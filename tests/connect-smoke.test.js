"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const net = require("node:net");
const { createHttpProxyServer } = require("../src/proxy/http");
const { createSocks5Server } = require("../src/proxy/socks5");

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
  const proxy = await createHttpProxyServer({ host: "127.0.0.1", port: proxyPort, getExit: () => null, meter: null });

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
  const proxy = await createHttpProxyServer({ host: "127.0.0.1", port: proxyPort, getExit: () => null, meter: null });

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

test("SOCKS5 CONNECT smoke tunnels through a mock share exit", async () => {
  const targetPort = await getFreePort();
  const target = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("hello-through-socks");
  });
  await new Promise((r) => target.listen(targetPort, "127.0.0.1", r));

  const sharePort = await getFreePort();
  const share = await createSocks5Server({
    host: "127.0.0.1",
    port: sharePort,
    getExit: () => null,
    meter: null
  });

  const proxyPort = await getFreePort();
  const proxy = await createSocks5Server({
    host: "127.0.0.1",
    port: proxyPort,
    getExit: () => ({ id: "mock-share", protocol: "socks5", host: "127.0.0.1", port: sharePort }),
    meter: null
  });

  try {
    const response = await fetchViaSocks5(proxyPort, "127.0.0.1", targetPort);
    assert.match(response, /HTTP\/1\.1 200 OK/);
    assert.match(response, /hello-through-socks/);
  } finally {
    proxy.close();
    share.close();
    target.close();
  }
});

function fetchViaSocks5(proxyPort, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const client = net.connect({ host: "127.0.0.1", port: proxyPort });
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error("SOCKS5 smoke timeout"));
    }, 5000);
    let stage = "greeting";
    let buf = Buffer.alloc(0);
    let response = "";

    const done = (err, value) => {
      clearTimeout(timeout);
      client.destroy();
      if (err) {
        reject(err);
      } else {
        resolve(value);
      }
    };

    client.on("connect", () => {
      client.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    client.on("data", (chunk) => {
      if (stage === "http") {
        response += chunk.toString("utf8");
        if (response.includes("hello-through-socks")) {
          done(null, response);
        }
        return;
      }

      buf = Buffer.concat([buf, chunk]);
      if (stage === "greeting") {
        if (buf.length < 2) {
          return;
        }
        assert.deepEqual([...buf.subarray(0, 2)], [0x05, 0x00]);
        buf = buf.subarray(2);
        stage = "connect";
        client.write(socks5Ipv4ConnectRequest(targetHost, targetPort));
      }
      if (stage === "connect") {
        if (buf.length < 10) {
          return;
        }
        assert.equal(buf[0], 0x05);
        assert.equal(buf[1], 0x00);
        stage = "http";
        buf = Buffer.alloc(0);
        client.write(`GET / HTTP/1.1\r\nHost: ${targetHost}\r\nConnection: close\r\n\r\n`);
      }
    });
    client.on("error", (err) => done(err));
    client.on("close", () => {
      if (stage !== "http" || response.includes("hello-through-socks")) {
        return;
      }
      done(new Error("SOCKS5 connection closed before HTTP response"));
    });
  });
}

function socks5Ipv4ConnectRequest(host, port) {
  const octets = host.split(".").map(Number);
  assert.equal(octets.length, 4);
  const req = Buffer.from([0x05, 0x01, 0x00, 0x01, ...octets, 0x00, 0x00]);
  req.writeUInt16BE(port, req.length - 2);
  return req;
}
