# Exit load balancing

How TrucVPN spreads new connections across the share exits it discovers.

## The problem

`listExits()` can return several MRGMinner share exits at once. Until now
`pickExit()` sorted them by `latency_ms + load * 100` and returned the first
one. Three things follow from that:

1. **Every consumer picks the same exit.** The sort is deterministic and the
   catalog is shared, so a thousand clients that discover the same catalog all
   land on the same node. The runner-up stays idle.
2. **Nothing pushes the herd off again.** `load` only changes when the share
   node re-reports it. Between two reports the score is frozen, so the exit
   that is filling up still looks like the cheapest one.
3. **A full exit was never excluded.** At `load: 1.0` the penalty was 100 "ms",
   so a saturated node 10 ms away still beat a free node 300 ms away.

Measured on the shipped `data/exits.sample.json`, 500 consumers connecting:

```
before   mock-vn-hcm 500
after    mock-vn-hcm 170   mock-sg-1 128   mock-vn-hn 128   mock-eu-fra 64   mock-us-sfo 10
```

## Scoring

Latency and load still decide. The score is a millisecond figure, lower is
better:

```
score = latency_ms + effective_load * balanceLatencyWeightMs      (default 250)
```

`balanceLatencyWeightMs` is the only knob that sets the exchange rate: it is
how many milliseconds of extra distance you will accept to move from a fully
loaded exit to an idle one. 250 ms means a busy nearby node loses to a free one
up to a quarter second further away.

### Load is normalized before it is scored

Share nodes do not agree on units. Whatever they send is mapped to a 0..1
fraction:

| Reported | Read as |
| --- | --- |
| `sessions` + `max_sessions` | `sessions / max_sessions` (preferred - it is a count, not an opinion) |
| `load: 0.22` | fraction, 22% |
| `load: 22` | percent, 22% |
| `load: 250` | clamped to 100% |
| `load: 1` | 100% (the pessimistic reading) |
| missing / `"busy"` / negative | unknown -> assumed 0.5, not 0 |

Before this, a node reporting percent (`load: 22`) was charged 2200 ms and was
never chosen again, while the identical node reporting `0.22` looked cheap.
Missing load was read as `0` - the most attractive value in the catalog.

### Stale load decays toward neutral

An exit that reported `load: 0.05` ten minutes ago has been collecting other
people's connections since. If the report carries a timestamp
(`load_updated_at`, `updated_at`, `reported_at` or `ts`; ISO string, epoch
seconds or epoch milliseconds), the value decays toward 0.5 as it ages, and is
fully neutral at `2 * balanceLoadStaleMs`. A fresh mediocre report therefore
beats a stale flattering one. Reports without a timestamp are used as sent.

### Locally placed sessions count too

The catalog will not show the connections this client just made. The
`SessionTracker` remembers them and adds `localSessionLoad` (5%) per placement,
so a daemon placing several connections between two catalog refreshes spreads
them instead of stacking them.

## Eligibility, before any strategy runs

An exit is skipped when it:

- is `direct` (the local no-upstream fallback is not a share exit),
- reports `healthy: false`, `online: false`, `available: false`, or a status of
  `down` / `offline` / `draining`,
- is at or above `balanceSaturationLoad` (default 0.9).

Saturation is a filter, not a penalty - that is the fix for point 3 above.

If the filter empties the pool the balancer widens it rather than refusing the
connection: preferred region -> any region -> saturated exits -> direct.

## Strategies

Set with `trucvpn configure --balance-strategy NAME`, or per call in
`POST /api/config`.

| Strategy | Behaviour | Use when |
| --- | --- | --- |
| `p2c` (default) | sample two eligible exits, keep the better score | many independent clients; no coordination needed |
| `least-loaded` | lowest effective load, score breaks ties | you care about capacity more than latency |
| `lowest-latency` | lowest latency, score breaks ties | the old behaviour, for a single client that wants the fastest hop |
| `weighted-random` | probability proportional to `1 / score` | want every exit exercised, including the far ones |
| `round-robin` | walk the eligible pool in order | test rigs and even wear across sharers |

### Why `p2c` is the default

Independent clients cannot see each other's choices, so anything that computes
a single best exit sends all of them to the same node - the herd. Picking
uniformly at random fixes the herd but ignores latency and load entirely.

Power of two choices sits between them: sample two eligible exits at random,
take the better one. Each client still prefers good exits, but no exit can be
chosen by everyone, because it has to win a random draw first. Exponentially
better worst-case load than plain random, no shared state, one extra
comparison.

The far or busy exits are not starved: as the popular ones fill up, their
reported load rises, their score climbs and the draws start going the other
way. The `--hold` simulation shows the loop closing - `mock-us-sfo` gets
nothing until the cheap exits load up, and then it starts taking traffic.

## Using it

```bash
# what the balancer sees, and which exits it will not use
trucvpn list --balance

# Balancer view (6)  strategy=p2c  saturation=0.9
#   direct-local   local   score       1      1ms  load   0% (fraction/n/a)  skip:direct
#   mock-vn-hcm    vn      score      83     28ms  load  22% (fraction/n/a)  eligible
#   mock-sg-1      sg      score      90     45ms  load  18% (fraction/n/a)  eligible
#   mock-us-sfo    us      score   222.5    120ms  load  41% (fraction/n/a)  eligible

# place 500 connections over the live catalog and show where they land
trucvpn balance --count 500 --seed 42
trucvpn balance --count 500 --strategy weighted-random --json
trucvpn balance --count 500 --hold          # keep placements on the books

# pick the strategy
trucvpn configure --balance-strategy least-loaded --saturation-load 0.8
```

Over the control daemon:

```
GET /api/balance      scored catalog + local session counts
POST /api/config      { "balance_strategy": "p2c", "balance_saturation_load": 0.9 }
```

`--seed` uses a deterministic PRNG, so a plan can be reproduced exactly - that
is also how the distribution tests in `tests/balancer.test.js` stay stable.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `balanceStrategy` | `p2c` | strategy from the table above |
| `balanceLatencyWeightMs` | `250` | ms charged for going from idle to fully loaded |
| `balanceSaturationLoad` | `0.9` | at or above this, an exit takes no new connections |
| `balanceLoadStaleMs` | `60000` | after this age a reported load stops being trusted |

## Not in scope here

Failover after a session is already up (retrying the next exit when a share
node dies mid-connection) is a separate concern - see issue #7. This module
decides where a *new* connection goes; `connect()` keeps its existing direct
fallback when the chosen exit does not answer the probe.
