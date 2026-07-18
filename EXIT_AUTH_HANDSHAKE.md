# Exit Auth Token Handshake

## Overview

This module provides secure token-based authentication for TrucVPN exit nodes, enabling safe sharing of exit node access between clients and exit servers.

## Features

- **Token Generation**: Cryptographically secure token generation with HMAC signatures
- **Token Validation**: Full validation workflow including signature verification and expiration checks
- **Client Sharing**: Secure sharing mechanism for exit node tokens
- **Expiration Management**: Automatic token expiration after configurable time

## API Reference

### `generateExitAuthToken(exitId, userId, permissions)`

Generates a secure exit auth token.

**Parameters:**
- `exitId` (string): Unique identifier for the exit node
- `userId` (string): User requesting access
- `permissions` (string[]): Array of permission scopes (default: ['read', 'connect'])

**Returns:** `ExitAuthToken` object with token, expiresAt, and signature

### `validateExitAuthToken(token, signature, expectedExitId)`

Validates an exit auth token.

**Parameters:**
- `token` (string): The token to validate
- `signature` (string): The signature to verify
- `expectedExitId` (string): Expected exit node ID

**Returns:** `boolean` - true if valid, false otherwise

### `shareExitAuthToken(exitId, clientPublicKey)`

Shares exit auth token with a client.

**Parameters:**
- `exitId` (string): Exit node identifier
- `clientPublicKey` (string): Client's public key for encryption

**Returns:** `ExitAuthToken` object

### `isTokenActive(token)`

Checks if a token has not expired.

**Parameters:**
- `token` (ExitAuthToken): Token to check

**Returns:** `boolean` - true if still valid

## Usage Example

```typescript
import { 
  generateExitAuthToken, 
  validateExitAuthToken,
  isTokenActive 
} from './handshake';

// Generate token for exit node
const token = generateExitAuthToken('exit-vn-01', 'user-123', ['connect', 'read']);

// Share with client
const sharedToken = shareExitAuthToken('exit-vn-01', 'client-public-key');

// Validate on exit node side
const isValid = validateExitAuthToken(
  sharedToken.token,
  sharedToken.signature,
  'exit-vn-01'
);

// Check if still active
if (isValid && isTokenActive(sharedToken)) {
  console.log('Token valid and active');
}
```

## Security Considerations

- Tokens use cryptographically secure random bytes
- HMAC signatures prevent tampering
- Default expiration is 1 hour (configurable via `TOKEN_EXPIRY_SECONDS`)
- Secret key should be set via environment variable `TRUCVPN_TOKEN_SECRET`

## Testing

Run tests with:
```bash
npm test
```

## Integration

This module integrates with:
- TrucVPN client authentication flow
- MRGMinner task runner for exit node management
- MergeOS blockchain verification for token legitimacy