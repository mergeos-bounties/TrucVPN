"use strict";

const net = require("node:net");
const { connectViaExit } = require("./upstream");

/**
 * Local SOCKS5 server. Client apps point system proxy here.
 * Traffic is dialed via residential exit from MRGMinner share (or direct).
 */
function createSocks5Server({ host, port, getExit, meter, onLog }) {
  const log = onLog || (() => {});

  const server = net.createServer((client) => {
    meter && meter.openConn();
    let stage = "greeting";
    let buf = Buffer.alloc(0);
    let closed = false;

    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      meter && meter.closeConn();
      try {
        client.destroy();
      } catch {
        /* ignore */
      }
    };

    client.on("error", cleanup);
    client.on("close", cleanup);

    client.on("data", async (chunk) => {
      try {
        buf = Buffer.concat([buf, chunk]);
        if (stage === "greeting") {
          if (buf.length < 2) {
            return;
          }
          const nmethods = buf[1];
          if (buf.length < 2 + nmethods) {
            return;
          }
          // no auth
          client.write(Buffer.from([0x05, 0x00]));
          buf = buf.subarray(2 + nmethods);
          stage = "request";
        }
        if (stage !== "request") {
          return;
        }
        if (buf.length < 7) {
          return;
        }
        if (buf[0] !== 0x05) {
          cleanup();
          return;
        }
        const cmd = buf[1];
        const atyp = buf[3];
        let offset = 4;
        let targetHost = "";
        if (atyp === 0x01) {
          if (buf.length < offset + 4 + 2) {
            return;
          }
          targetHost = `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
          offset += 4;
        } else if (atyp === 0x03) {
          const len = buf[offset];
          offset += 1;
          if (buf.length < offset + len + 2) {
            return;
          }
          targetHost = buf.subarray(offset, offset + len).toString("utf8");
          offset += len;
        } else if (atyp === 0x04) {
          // IPv6 — minimal support
          if (buf.length < offset + 16 + 2) {
            return;
          }
          const parts = [];
          for (let i = 0; i < 16; i += 2) {
            parts.push(buf.readUInt16BE(offset + i).toString(16));
          }
          targetHost = parts.join(":");
          offset += 16;
        } else {
          client.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          cleanup();
          return;
        }
        const targetPort = buf.readUInt16BE(offset);
        buf = Buffer.alloc(0);
        stage = "connected";
        client.removeAllListeners("data");

        if (cmd !== 0x01) {
          client.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          cleanup();
          return;
        }

        const exit = typeof getExit === "function" ? getExit() : null;
        let remote;
        try {
          remote = await connectViaExit(exit, targetHost, targetPort);
        } catch (err) {
          log(`socks connect fail ${targetHost}:${targetPort} ${err.message}`);
          client.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          cleanup();
          return;
        }

        // success reply: bind 0.0.0.0:0
        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        pipeWithMeter(client, remote, meter, cleanup);
        log(`socks ok ${targetHost}:${targetPort} via ${(exit && exit.id) || "direct"}`);
      } catch (err) {
        log(`socks error ${err.message}`);
        cleanup();
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve(server);
    });
  });
}

function pipeWithMeter(a, b, meter, cleanup) {
  const onA = (chunk) => {
    meter && meter.record("out", chunk.length);
    if (!b.write(chunk)) {
      a.pause();
    }
  };
  const onB = (chunk) => {
    meter && meter.record("in", chunk.length);
    if (!a.write(chunk)) {
      b.pause();
    }
  };
  a.on("data", onA);
  b.on("data", onB);
  a.on("drain", () => b.resume());
  b.on("drain", () => a.resume());
  a.on("error", cleanup);
  b.on("error", cleanup);
  a.on("close", () => {
    try {
      b.destroy();
    } catch {
      /* ignore */
    }
    cleanup();
  });
  b.on("close", () => {
    try {
      a.destroy();
    } catch {
      /* ignore */
    }
    cleanup();
  });
}

module.exports = { createSocks5Server };
