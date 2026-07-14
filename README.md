# TrucVPN

[![Node.js](https://img.shields.io/badge/node-%3E%3D18.17-blue.svg)](https://nodejs.org/)
[![Version](https://img.shields.io/badge/version-0.1.0-0E8A16.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MRG](https://img.shields.io/badge/token-MRG-5319E7.svg)](https://scan.mergeos.shop)
[![MergeOS](https://img.shields.io/badge/MergeOS-bounties-5319E7.svg)](https://github.com/mergeos-bounties)

**TrucVPN** is a full-featured **VPN client** for MergeOS: local SOCKS5 + HTTP proxies, multi-region residential exits, kill-switch / split-tunnel settings, bandwidth metering, and a browser dashboard. Traffic is routed through **MRGMinner share nodes** (residential bandwidth), so sharers earn **MRG** for relayed bytes.

**Product:** [mergeos-bounties/TrucVPN](https://github.com/mergeos-bounties/TrucVPN) · Share side: [MRGMinner](https://github.com/mergeos-bounties/MRGMinner) · Funded: **`prj_0515`** · App: [mergeos.shop](https://mergeos.shop/)

---

## Highlights

| Capability | Description |
| --- | --- |
| **Local VPN proxies** | SOCKS5 + HTTP CONNECT on loopback for apps/browsers |
| **Residential exits** | Discover live exits from `mrgminner share` (`/v1/exits`) |
| **Offline demo** | Sample catalog + `direct-local` fallback when share is down |
| **Dashboard** | Connect / disconnect / pick exit in the browser |
| **MRG economy** | Consumer est. cost per GB; sharers earn via MRGMinner share stream |
| **Doctor / status** | Catalog + share URL + traffic snapshot |

---

## Architecture

```text
Browser / app
    │  system or app proxy
    ▼
TrucVPN local SOCKS5 :17880  /  HTTP :17881
    │
    ▼
MRGMinner share exit (residential)  ←── sharer earns MRG for bandwidth
    │
    ▼
Internet
```

---

## Quick start

```powershell
cd TrucVPN
npm test
node .\bin\trucvpn.js version
node .\bin\trucvpn.js demo
node .\bin\trucvpn.js list
node .\bin\trucvpn.js connect --exit direct-local
node .\bin\trucvpn.js status
node .\bin\trucvpn.js disconnect
```

### With residential share (MRGMinner)

```powershell
# Terminal A — share your connection, earn MRG
cd MRGMinner
node .\bin\mrgminner.js share start --region vn --city "Ho Chi Minh"

# Terminal B — VPN client
cd TrucVPN
node .\bin\trucvpn.js connect --region vn
node .\bin\trucvpn.js dashboard
```

Point browser / system proxy to:

| Protocol | Default |
| --- | --- |
| SOCKS5 | `127.0.0.1:17880` |
| HTTP | `127.0.0.1:17881` |
| Dashboard | http://127.0.0.1:17888/ |

---

## CLI reference

| Command | Purpose |
| --- | --- |
| `trucvpn version` | Package version |
| `trucvpn configure` | Ports, share URL, preferred region |
| `trucvpn list` | Exit catalog (live + sample) |
| `trucvpn connect [--exit ID] [--region CODE]` | Start local proxies via exit |
| `trucvpn disconnect` | Stop session |
| `trucvpn status` | Connection + traffic + est. MRG cost |
| `trucvpn doctor` | Health JSON |
| `trucvpn demo` | Offline connect/disconnect smoke |
| `trucvpn dashboard` | Local web UI |

---

## Repository layout

```text
TrucVPN/
  bin/trucvpn.js
  src/          CLI, session, catalog, SOCKS/HTTP, dashboard
  public/       Dashboard static UI
  data/         Offline exit sample catalog
  tests/        node:test suite
  docs/BOUNTY.md
```

---

## Development

```powershell
npm test
node .\bin\trucvpn.js doctor
```

---

## MergeOS bounties

**Follow** [mergeos-bounties](https://github.com/mergeos-bounties) + **star** [mergeos](https://github.com/mergeos-bounties/mergeos) and [mergeos-contracts](https://github.com/mergeos-bounties/mergeos-contracts), claim open issues, PR to **master**, earn **25–200 MRG**.

See [docs/BOUNTY.md](docs/BOUNTY.md).

---

## License

MIT — see [LICENSE](LICENSE).
