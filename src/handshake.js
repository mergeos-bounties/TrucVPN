"use strict";

const crypto = require("node:crypto");

/**
 * Exit auth token handshake for TrucVPN residential exits.
 *
 * The consumer (client) and a residential exit (sharer) exchange a signed,
 * short-lived bearer token before any upstream traffic is routed. The token
 * is an HMAC over a shared secret + nonce + expiry, so it can be validated
 * by either side without a round-trip to a trusted third party.
 *
 * Token format (opaque, base64url):
 *   <version>.<clientNonce>.<exitNonce>.<expiryMs>.<hmac>
 *
 * The HMAC covers the first four segments and is computed with a key derived
 * from the shared secret plus the two nonces (so each handshake is bound to a
 * single client/exit pair and cannot be replayed against a different peer).
 */

const VERSION = "1";
const VERSION_BUF = Buffer.from(VERSION, "utf8");

/** Default token lifetime. */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Maximum allowed clock skew when validating expiry. */
const MAX_SKEW_MS = 30 * 1000;

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function randomBytesSafe(n) {
  return crypto.randomBytes(n);
}

/**
 * Derive a per-handshake HMAC key from the shared secret and the two nonces.
 * Using both nonces keeps the key unique per handshake and binds the token to
 * the (client, exit) pair that produced it.
 */
function deriveKey(sharedSecret, clientNonce, exitNonce) {
  return crypto
    .createHash("sha256")
    .update(VERSION_BUF)
    .update(sharedSecret)
    .update(clientNonce)
    .update(exitNonce)
    .digest();
}

function computeHmac(sharedSecret, clientNonce, exitNonce, expiryMs) {
  const key = deriveKey(sharedSecret, clientNonce, exitNonce);
  const payload = `${VERSION}.${clientNonce}.${exitNonce}.${expiryMs}`;
  const mac = crypto.createHmac("sha256", key).update(payload).digest();
  return { payload, mac: b64url(mac) };
}

/**
 * Step 1 — client side.
 * Generate the client half of the handshake. Returns the opaque client token
 * (to send to the exit) and the client nonce (kept secret until verification).
 */
function clientBegin({ sharedSecret, clientNonce, ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) {
  if (!sharedSecret || typeof sharedSecret !== "string") {
    throw new Error("sharedSecret is required");
  }
  const cNonce = clientNonce ? Buffer.from(clientNonce, "base64url") : randomBytesSafe(24);
  if (cNonce.length < 16) {
    throw new Error("clientNonce too short");
  }
  const expiryMs = Number(now) + Number(ttlMs);
  const { payload, mac } = computeHmac(
    sharedSecret,
    b64url(cNonce),
    "", // exit nonce not known yet — client half signs only its own contribution
    expiryMs
  );
  // Client-half token carries an empty exit nonce segment.
  const token = `${payload}.${mac}`;
  return { token, clientNonce: b64url(cNonce), expiryMs };
}

/**
 * Step 2 — exit side.
 * The exit receives the client token, verifies it, then produces a full token
 * that binds both nonces. Returns the verified client nonce and the final exit
 * token the client must validate.
 */
function exitAccept({ sharedSecret, clientToken, exitNonce, ttlMs, now = Date.now() } = {}) {
  if (!sharedSecret || typeof sharedSecret !== "string") {
    throw new Error("sharedSecret is required");
  }
  if (!clientToken || typeof clientToken !== "string") {
    throw new Error("clientToken is required");
  }
  const parts = clientToken.split(".");
  if (parts.length !== 5) {
    throw new Error("malformed client token");
  }
  const [ver, cNonce, eNonce, expiryRaw, mac] = parts;
  if (ver !== VERSION) {
    throw new Error("unsupported token version");
  }
  if (eNonce !== "") {
    throw new Error("client token must not carry an exit nonce");
  }
  const expiryMs = Number(expiryRaw);
  const expected = computeHmac(sharedSecret, cNonce, "", expiryMs);
  if (!timingSafeEqual(mac, expected.mac)) {
    throw new Error("client token signature invalid");
  }
  if (!isFresh(expiryMs, now)) {
    throw new Error("client token expired");
  }

  const eNonceBuf = exitNonce ? Buffer.from(exitNonce, "base64url") : randomBytesSafe(24);
  if (eNonceBuf.length < 16) {
    throw new Error("exitNonce too short");
  }
  const eNonceStr = b64url(eNonceBuf);
  // Re-issue the token now (exit sets the authoritative expiry).
  const effectiveTtl = ttlMs != null ? Number(ttlMs) : expiryMs - Number(now);
  const finalExpiry = Number(now) + Math.max(0, effectiveTtl);
  const full = computeHmac(sharedSecret, cNonce, eNonceStr, finalExpiry);
  const exitToken = `${full.payload}.${full.mac}`;
  return { clientNonce: cNonce, exitNonce: eNonceStr, exitToken, expiryMs: finalExpiry };
}

/**
 * Step 3 — client verifies the exit token and completes the handshake.
 * Returns true when the token is well-formed, signed correctly, binds the same
 * client nonce, and is not expired.
 */
function clientVerify({ sharedSecret, clientNonce, exitToken, now = Date.now() } = {}) {
  if (!sharedSecret || typeof sharedSecret !== "string") {
    throw new Error("sharedSecret is required");
  }
  if (!clientNonce || !exitToken) {
    throw new Error("clientNonce and exitToken are required");
  }
  const parts = String(exitToken).split(".");
  if (parts.length !== 5) {
    return false;
  }
  const [ver, cNonce, eNonce, expiryRaw, mac] = parts;
  if (ver !== VERSION || !cNonce || !eNonce) {
    return false;
  }
  if (cNonce !== clientNonce) {
    return false;
  }
  const expiryMs = Number(expiryRaw);
  if (!Number.isFinite(expiryMs)) {
    return false;
  }
  const expected = computeHmac(sharedSecret, cNonce, eNonce, expiryMs);
  if (!timingSafeEqual(mac, expected.mac)) {
    return false;
  }
  return isFresh(expiryMs, now);
}

function isFresh(expiryMs, now) {
  return Number(now) <= Number(expiryMs) + MAX_SKEW_MS;
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Full handshake helper for in-process / test use: runs the three steps and
 * returns the final, mutually-verified token plus the shared nonces.
 */
function performHandshake({ sharedSecret, ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) {
  const client = clientBegin({ sharedSecret, ttlMs, now });
  const exit = exitAccept({ sharedSecret, clientToken: client.token, ttlMs, now });
  const ok = clientVerify({
    sharedSecret,
    clientNonce: exit.clientNonce,
    exitToken: exit.exitToken,
    now
  });
  if (!ok) {
    throw new Error("handshake verification failed");
  }
  return {
    token: exit.exitToken,
    clientNonce: exit.clientNonce,
    exitNonce: exit.exitNonce,
    expiryMs: exit.expiryMs,
    verified: true
  };
}

module.exports = {
  VERSION,
  DEFAULT_TTL_MS,
  MAX_SKEW_MS,
  clientBegin,
  exitAccept,
  clientVerify,
  performHandshake
};
