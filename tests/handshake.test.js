"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  clientBegin,
  exitAccept,
  clientVerify,
  performHandshake,
  DEFAULT_TTL_MS
} = require("../src/handshake");

const SECRET = "shared-secret-between-client-and-exit";

describe("handshake", () => {
  it("performs a full mutual handshake", () => {
    const now = Date.now();
    const h = performHandshake({ sharedSecret: SECRET, now });
    assert.equal(h.verified, true);
    assert.ok(h.token.startsWith("1."));
    assert.ok(h.clientNonce);
    assert.ok(h.exitNonce);
    assert.ok(h.expiryMs > now);
  });

  it("clientVerify accepts the exit token and rejects a tampered one", () => {
    const now = Date.now();
    const client = clientBegin({ sharedSecret: SECRET, now });
    const exit = exitAccept({ sharedSecret: SECRET, clientToken: client.token, now });
    assert.equal(
      clientVerify({ sharedSecret: SECRET, clientNonce: exit.clientNonce, exitToken: exit.exitToken, now }),
      true
    );
    const bad = exit.exitToken.slice(0, -2) + "xx";
    assert.equal(
      clientVerify({ sharedSecret: SECRET, clientNonce: exit.clientNonce, exitToken: bad, now }),
      false
    );
  });

  it("exit rejects a token with a wrong signature", () => {
    const now = Date.now();
    const client = clientBegin({ sharedSecret: SECRET, now });
    // Corrupt the HMAC segment of the client token.
    const parts = client.token.split(".");
    parts[4] = "AAAA" + parts[4].slice(4);
    assert.throws(
      () => exitAccept({ sharedSecret: SECRET, clientToken: parts.join("."), now }),
      /signature invalid/
    );
  });

  it("fails when the shared secret differs on either side", () => {
    const now = Date.now();
    const client = clientBegin({ sharedSecret: SECRET, now });
    assert.throws(
      () => exitAccept({ sharedSecret: "wrong-secret", clientToken: client.token, now }),
      /signature invalid/
    );
  });

  it("client token must not carry an exit nonce", () => {
    const now = Date.now();
    const client = clientBegin({ sharedSecret: SECRET, now });
    const forged = client.token.replace(/\.\.[^.]+/, ".evil.");
    assert.throws(
      () => exitAccept({ sharedSecret: SECRET, clientToken: forged, now }),
      /exit nonce/
    );
  });

  it("exit token expires after ttl", () => {
    const now = Date.now();
    const client = clientBegin({ sharedSecret: SECRET, ttlMs: 100, now });
    const exit = exitAccept({ sharedSecret: SECRET, clientToken: client.token, ttlMs: 100, now });
    // Well past expiry + skew.
    const later = now + DEFAULT_TTL_MS * 10;
    assert.equal(
      clientVerify({ sharedSecret: SECRET, clientNonce: exit.clientNonce, exitToken: exit.exitToken, now: later }),
      false
    );
  });

  it("clientVerify rejects a token bound to a different client nonce", () => {
    const now = Date.now();
    const exit = exitAccept({ sharedSecret: SECRET, clientToken: clientBegin({ sharedSecret: SECRET, now }).token, now });
    assert.equal(
      clientVerify({ sharedSecret: SECRET, clientNonce: "not-the-same-nonce", exitToken: exit.exitToken, now }),
      false
    );
  });

  it("requires a shared secret and rejects malformed tokens", () => {
    assert.throws(() => clientBegin({}), /sharedSecret is required/);
    assert.equal(clientVerify({ sharedSecret: SECRET, clientNonce: "x", exitToken: "garbage" }), false);
  });
});
