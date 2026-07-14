"use strict";

const net = require("node:net");
const tls = require("node:tls");

/**
 * Open a TCP connection to targetHost:targetPort,
 * optionally via an upstream residential proxy (socks5 / http-connect / direct).
 */
function connectViaExit(exit, targetHost, targetPort, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const protocol = String((exit && exit.protocol) || "direct").toLowerCase();
    const timer = setTimeout(() => {
      reject(new Error(`upstream connect timeout (${protocol})`));
    }, timeoutMs);

    const done = (err, socket) => {
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve(socket);
      }
    };

    if (!exit || protocol === "direct") {
      const socket = net.connect({ host: targetHost, port: targetPort }, () => done(null, socket));
      socket.once("error", done);
      return;
    }

    if (protocol === "socks5" || protocol === "socks") {
      socks5Connect(exit, targetHost, targetPort, done);
      return;
    }

    if (protocol === "http-connect" || protocol === "http" || protocol === "https") {
      httpConnect(exit, targetHost, targetPort, done);
      return;
    }

    done(new Error(`unsupported exit protocol: ${protocol}`));
  });
}

function socks5Connect(exit, targetHost, targetPort, done) {
  const socket = net.connect({ host: exit.host, port: Number(exit.port) }, () => {
    // greeting: no auth
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
  });

  let stage = "greeting";
  let buf = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (stage === "greeting") {
      if (buf.length < 2) {
        return;
      }
      if (buf[0] !== 0x05 || buf[1] !== 0x00) {
        socket.destroy();
        return done(new Error("socks5 auth not accepted"));
      }
      buf = buf.subarray(2);
      stage = "connect";
      const hostBuf = Buffer.from(targetHost, "utf8");
      const req = Buffer.alloc(7 + hostBuf.length);
      req[0] = 0x05;
      req[1] = 0x01; // CONNECT
      req[2] = 0x00;
      req[3] = 0x03; // domain
      req[4] = hostBuf.length;
      hostBuf.copy(req, 5);
      req.writeUInt16BE(Number(targetPort), 5 + hostBuf.length);
      socket.write(req);
      return;
    }
    if (stage === "connect") {
      if (buf.length < 5) {
        return;
      }
      if (buf[0] !== 0x05 || buf[1] !== 0x00) {
        socket.destroy();
        return done(new Error(`socks5 connect failed code=${buf[1]}`));
      }
      // skip bind address
      const atyp = buf[3];
      let need = 4;
      if (atyp === 0x01) {
        need += 4 + 2;
      } else if (atyp === 0x03) {
        need += 1 + buf[4] + 2;
      } else if (atyp === 0x04) {
        need += 16 + 2;
      } else {
        socket.destroy();
        return done(new Error("socks5 unknown atyp"));
      }
      if (buf.length < need) {
        return;
      }
      socket.removeAllListeners("data");
      // leftover data rare; ignore
      stage = "ready";
      done(null, socket);
    }
  });

  socket.once("error", (err) => done(err));
}

function httpConnect(exit, targetHost, targetPort, done) {
  const useTls = String(exit.protocol).toLowerCase() === "https" || exit.tls === true;
  const connectOpts = { host: exit.host, port: Number(exit.port) };
  const socket = useTls ? tls.connect(connectOpts) : net.connect(connectOpts);

  const onReady = () => {
    const auth =
      exit.username && exit.password
        ? `Proxy-Authorization: Basic ${Buffer.from(`${exit.username}:${exit.password}`).toString("base64")}\r\n`
        : "";
    const req =
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
      `Host: ${targetHost}:${targetPort}\r\n` +
      auth +
      `Proxy-Connection: Keep-Alive\r\n\r\n`;
    socket.write(req);
  };

  if (useTls) {
    socket.once("secureConnect", onReady);
  } else {
    socket.once("connect", onReady);
  }

  let buf = "";
  const onData = (chunk) => {
    buf += chunk.toString("utf8");
    const idx = buf.indexOf("\r\n\r\n");
    if (idx < 0) {
      return;
    }
    const head = buf.slice(0, idx);
    const m = head.match(/^HTTP\/\d\.\d\s+(\d+)/);
    if (!m || Number(m[1]) !== 200) {
      socket.destroy();
      return done(new Error(`http connect failed: ${head.split("\r\n")[0]}`));
    }
    socket.removeListener("data", onData);
    done(null, socket);
  };
  socket.on("data", onData);
  socket.once("error", (err) => done(err));
}

module.exports = { connectViaExit };
