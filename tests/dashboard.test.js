"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startControlDaemon } = require("../src/dashboard");

describe("dashboard handshake endpoint", () => {
  let daemon;
  let base;

  before(async () => {
    process.env.TRUCVPN_SHARE_SECRET = "test-shared-secret";
    const port = await freePort();
    daemon = await startControlDaemon({ host: "127.0.0.1", port });
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (daemon && daemon.server) {
      daemon.server.close();
    }
    delete process.env.TRUCVPN_SHARE_SECRET;
  });

  it("runs client->exit handshake over the control plane", async () => {
    const clientRes = await postJson(`${base}/api/handshake`, { role: "client" });
    assert.equal(clientRes.ok, true);
    assert.ok(clientRes.token.startsWith("1."));
    assert.ok(clientRes.client_nonce);

    const exitRes = await postJson(`${base}/api/handshake`, {
      role: "exit",
      client_token: clientRes.token
    });
    assert.equal(exitRes.ok, true);
    assert.ok(exitRes.exit_token);
    const parts = exitRes.exit_token.split(".");
    assert.equal(parts[1], clientRes.client_nonce);
    assert.ok(exitRes.expiry_ms > Date.now());
  });

  it("rejects exit role without a client token", async () => {
    const res = await postJson(`${base}/api/handshake`, { role: "exit" });
    assert.equal(res.ok, false);
  });
});

function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then((r) => r.json());
}

function freePort() {
  const net = require("node:net");
  const srv = net.createServer();
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
