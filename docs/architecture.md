# TrucVPN Architecture

## Overview

TrucVPN provides split-tunnel VPN with share and client components.

## Components

### Share Server
- Handles exit node coordination
- Manages share load balancing

### Client
- Local split-tunnel routing
- Per-app tunnel configuration

## Data Flow

Client -> Share Server -> Exit Node -> Internet

## Diagram

```
  +---------+     +---------+     +---------+
  | Client  |---->| Share   |---->| Exit    |
  | (App)   |     | Server  |     | Node    |
  +---------+     +---------+     +---------+
       |                               |
       v                               v
  Split-tunnel                    Internet
```