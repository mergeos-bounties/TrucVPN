# Exit Auth Token Handshake

Feature #3 — secure token generation, validation, and sharing for TrucVPN
residential exit nodes.

## Why

Before any traffic is routed through a residential exit (sharer), the consumer
(client) and the exit must mutually authenticate. This handshake lets either
side validate the other using a shared secret, without a round-trip to a trusted
third party, and with built-in replay protection and expiry.

## Design

The token is an opaque `base64url` string:

```text
<version>.<clientNonce>.<exitNonce>.<expiryMs>.<hmac>
```

* `version` — protocol version (`1`).
* `clientNonce` — 24 random bytes from the client.
* `exitNonce` — 24 random bytes from the exit (added in step 2).
* `expiryMs` — absolute expiry timestamp (ms).
* `hmac` — `HMAC-SHA256` over the first four segments, keyed by a per-handshake
  key derived (via `SHA-256`) from the shared secret + both nonces.

Deriving the key from both nonces binds each token to one (client, exit) pair,
so a token cannot be replayed against a different peer. The HMAC is verified
with a constant-time comparison, and tokens are rejected once their expiry
timestamp has passed (with a small clock-skew tolerance).

## Flow

1. **Client** — `clientBegin(sharedSecret)` → opaque `token` + `clientNonce`.
   Send the token to the exit. The `clientNonce` is not sent; the client keeps
   it to verify the response.
2. **Exit** — `exitAccept(sharedSecret, clientToken)` → verifies the signature
   and freshness, then returns a full `exitToken` that binds both nonces.
3. **Client** — `clientVerify(sharedSecret, clientNonce, exitToken)` → `true`
   only if the signature is valid, the token carries the same `clientNonce`, and
   it has not expired.

`performHandshake({ sharedSecret })` runs all three steps in-process and is the
easiest entry point for new code.

## Control daemon endpoints

```text
POST /api/handshake  { "role": "client" }                       -> { token, client_nonce }
POST /api/handshake  { "role": "exit", "client_token": "..." }  -> { exit_token, ... }
```

The shared secret is read from `TRUCVPN_SHARE_SECRET` (or `config.shareSecret`),
defaulting to a demo secret for local/offline use.

## Example

```js
const handshake = require("./src/handshake");

const secret = "shared-secret-between-client-and-exit";
const client = handshake.clientBegin({ sharedSecret: secret });
const exit = handshake.exitAccept({ sharedSecret: secret, clientToken: client.token });
const ok = handshake.clientVerify({
  sharedSecret: secret,
  clientNonce: exit.clientNonce,
  exitToken: exit.exitToken
});
// ok === true
```

## Security notes

* Use a strong, out-of-band shared secret per (client, exit) pair in production.
* Tokens are short-lived (default 5 minutes). Lower `ttlMs` for tighter windows.
* Never log the shared secret. Nonces are safe to log/transmit.
* A wrong secret, tampered HMAC, mismatched `clientNonce`, or expired token all
  fail verification (see `tests/handshake.test.js`).
