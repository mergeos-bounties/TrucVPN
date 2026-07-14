"use strict";

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const session = require("../src/session");

describe("session", () => {
  after(async () => {
    try {
      await session.disconnect();
    } catch {
      /* ignore */
    }
  });

  it("connect direct and expose socks port", async () => {
    const s = await session.connect({ exitId: "direct-local", json: true });
    const st = s.status();
    assert.equal(st.connected, true);
    assert.equal(st.socks.port > 0, true);
    await new Promise((resolve, reject) => {
      const c = net.connect({ host: st.socks.host, port: st.socks.port }, () => {
        c.end();
        resolve();
      });
      c.on("error", reject);
    });
    const d = await session.disconnect();
    assert.equal(d.connected, false);
  });
});
