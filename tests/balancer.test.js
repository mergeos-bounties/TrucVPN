"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeLoad,
  effectiveLoad,
  scoreExit,
  ineligibleReason,
  rankExits,
  chooseExit,
  simulate,
  SessionTracker
} = require("../src/balancer");
const { pickExit } = require("../src/catalog");

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

/** Mock multi-exit share catalog: four usable exits plus the local direct one. */
function mockCatalog() {
  return [
    { id: "share-vn-1", region: "vn", protocol: "socks5", latency_ms: 28, load: 0.20, load_updated_at: NOW },
    { id: "share-vn-2", region: "vn", protocol: "socks5", latency_ms: 32, load: 0.25, load_updated_at: NOW },
    { id: "share-sg-1", region: "sg", protocol: "http-connect", latency_ms: 45, load: 0.18, load_updated_at: NOW },
    { id: "share-us-1", region: "us", protocol: "socks5", latency_ms: 120, load: 0.41, load_updated_at: NOW },
    { id: "direct-local", region: "local", protocol: "direct", latency_ms: 1, load: 0 }
  ];
}

/** Deterministic PRNG (mulberry32) so distributions are reproducible. */
function seeded(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("balancer / load normalization", () => {
  it("reads a 0..1 fraction as a fraction", () => {
    assert.deepEqual(normalizeLoad({ load: 0.22 }), { load: 0.22, basis: "fraction" });
  });

  it("reads a percent report as percent instead of charging it 100x", () => {
    assert.deepEqual(normalizeLoad({ load: 22 }), { load: 0.22, basis: "percent" });
  });

  it("prefers session counters over a self-reported load", () => {
    assert.deepEqual(
      normalizeLoad({ sessions: 3, max_sessions: 4, load: 0.01 }),
      { load: 0.75, basis: "sessions" }
    );
  });

  it("treats a missing or invalid load as unknown, not as idle", () => {
    assert.equal(normalizeLoad({}).load, null);
    assert.equal(normalizeLoad({ load: "busy" }).load, null);
    assert.equal(normalizeLoad({ load: -1 }).load, null);
    assert.equal(effectiveLoad({}, {}, { now: NOW }).load, 0.5);
  });

  it("clamps an over-range percent to fully loaded", () => {
    assert.equal(normalizeLoad({ load: 250 }).load, 1);
  });
});

describe("balancer / staleness", () => {
  it("decays a stale flattering load toward neutral", () => {
    const fresh = effectiveLoad(
      { load: 0.05, load_updated_at: NOW },
      { loadStaleMs: 60_000 },
      { now: NOW }
    );
    const stale = effectiveLoad(
      { load: 0.05, load_updated_at: NOW - 10 * 60_000 },
      { loadStaleMs: 60_000 },
      { now: NOW }
    );
    assert.equal(fresh.load, 0.05);
    assert.equal(fresh.freshness, "fresh");
    assert.equal(stale.freshness, "stale");
    assert.equal(stale.load, 0.5);
    assert.ok(stale.load > fresh.load);
  });

  it("lets a fresh mediocre exit beat a stale idle-looking one", () => {
    const exits = [
      { id: "stale-idle", protocol: "socks5", latency_ms: 40, load: 0.02, load_updated_at: NOW - 30 * 60_000 },
      { id: "fresh-busy", protocol: "socks5", latency_ms: 40, load: 0.35, load_updated_at: NOW }
    ];
    const ranked = rankExits(exits, { loadStaleMs: 60_000 }, { now: NOW });
    assert.equal(ranked[0].id, "fresh-busy");
  });

  it("accepts epoch seconds as well as ISO timestamps", () => {
    const iso = effectiveLoad(
      { load: 0.1, updated_at: new Date(NOW - 5 * 60_000).toISOString() },
      { loadStaleMs: 60_000 },
      { now: NOW }
    );
    const seconds = effectiveLoad(
      { load: 0.1, ts: (NOW - 5 * 60_000) / 1000 },
      { loadStaleMs: 60_000 },
      { now: NOW }
    );
    assert.equal(iso.load, seconds.load);
    assert.equal(iso.freshness, "stale");
  });
});

describe("balancer / eligibility", () => {
  it("refuses to hand new connections to a saturated exit", () => {
    const exit = { id: "full", protocol: "socks5", latency_ms: 5, load: 0.97, load_updated_at: NOW };
    assert.equal(ineligibleReason(exit, {}, { now: NOW }), "saturated");
  });

  it("skips a saturated near exit in favour of a distant free one", () => {
    const exits = [
      { id: "near-full", region: "vn", protocol: "socks5", latency_ms: 10, load: 1, load_updated_at: NOW },
      { id: "far-free", region: "us", protocol: "socks5", latency_ms: 300, load: 0.1, load_updated_at: NOW }
    ];
    const picks = new Set();
    for (let i = 0; i < 50; i++) {
      picks.add(chooseExit(exits, { rng: seeded(i + 1) }, { now: NOW }).id);
    }
    assert.deepEqual([...picks], ["far-free"]);
  });

  it("honours health flags from the share node", () => {
    assert.equal(ineligibleReason({ id: "a", protocol: "socks5", healthy: false }, {}, { now: NOW }), "down");
    assert.equal(ineligibleReason({ id: "b", protocol: "socks5", status: "draining" }, {}, { now: NOW }), "down");
    assert.equal(ineligibleReason({ id: "c", protocol: "direct" }, {}, { now: NOW }), "direct");
    assert.equal(ineligibleReason({ id: "d", protocol: "socks5", load: 0.3 }, {}, { now: NOW }), null);
  });

  it("still returns an exit when every share node is saturated", () => {
    const exits = [
      { id: "full-a", protocol: "socks5", latency_ms: 10, load: 1, load_updated_at: NOW },
      { id: "full-b", protocol: "socks5", latency_ms: 20, load: 1, load_updated_at: NOW }
    ];
    const chosen = chooseExit(exits, { rng: seeded(7) }, { now: NOW });
    assert.ok(chosen && chosen.id.startsWith("full-"));
  });

  it("falls back to direct when nothing else is left", () => {
    const chosen = chooseExit(
      [{ id: "direct-local", protocol: "direct", latency_ms: 1, load: 0 }],
      { rng: seeded(3) },
      { now: NOW }
    );
    assert.equal(chosen.id, "direct-local");
  });
});

describe("balancer / scoring", () => {
  it("does not treat a zero-latency reading as the worst exit", () => {
    const exits = [
      { id: "loopback", protocol: "socks5", latency_ms: 0, load: 0.1, load_updated_at: NOW },
      { id: "remote", protocol: "socks5", latency_ms: 200, load: 0.1, load_updated_at: NOW }
    ];
    const ranked = rankExits(exits, {}, { now: NOW });
    assert.equal(ranked[0].id, "loopback");
    assert.equal(ranked[0].latency_ms, 0);
  });

  it("charges an unknown latency instead of scoring it as zero", () => {
    const scored = scoreExit({ id: "x", protocol: "socks5" }, { unknownLatencyMs: 400 }, { now: NOW });
    assert.equal(scored.latency, 400);
    assert.equal(scored.latency_known, false);
  });

  it("explains why each exit was skipped", () => {
    const ranked = rankExits(mockCatalog(), {}, { now: NOW });
    const byId = Object.fromEntries(ranked.map((r) => [r.id, r]));
    assert.equal(byId["direct-local"].eligible, false);
    assert.equal(byId["direct-local"].reason, "direct");
    assert.equal(byId["share-vn-1"].eligible, true);
    assert.equal(byId["share-vn-1"].load_basis, "fraction");
  });
});

describe("balancer / distribution across a mock catalog", () => {
  it("spreads 500 connections instead of pinning them on one exit", () => {
    const result = simulate(mockCatalog(), 500, { rng: seeded(42) }, { now: NOW });
    const share = Object.fromEntries(result.distribution.map((d) => [d.id, d.connections]));
    assert.ok(!share["direct-local"], "direct must never take share traffic");
    assert.ok(result.distribution.length >= 3, "traffic must reach several share exits");
    const busiest = Math.max(...Object.values(share));
    assert.ok(busiest < 500 * 0.7, `busiest exit took ${busiest}/500 - still a herd`);
    // Spreading is not round-robin: cheap exits still win more often.
    assert.ok((share["share-vn-1"] || 0) > (share["share-us-1"] || 0));
  });

  it("keeps the ordering sane: cheaper exits get more of the traffic", () => {
    const result = simulate(mockCatalog(), 1000, { rng: seeded(7) }, { now: NOW });
    const ordered = result.distribution.map((d) => d.id);
    assert.equal(ordered[0], "share-vn-1", "the cheapest exit should lead");
    assert.ok(!ordered.includes("share-us-1"), "the far busy exit is not needed while cheaper ones are free");
  });

  it("pulls in the expensive exit once the cheap ones fill up", () => {
    // `hold` keeps each placed connection on the books, so the assumed load of
    // the popular exits climbs while the simulation runs - the feedback loop
    // the static snapshot never had.
    const result = simulate(mockCatalog(), 500, { rng: seeded(42) }, { now: NOW, hold: true });
    const ids = result.distribution.map((d) => d.id);
    assert.equal(ids.length, 4, "every share exit takes traffic once the good ones load up");
    assert.equal(result.distribution[0].id, "share-vn-1");
    assert.equal(result.distribution[result.distribution.length - 1].id, "share-us-1");
  });

  it("is reproducible for a given seed", () => {
    const a = simulate(mockCatalog(), 200, { rng: seeded(11) }, { now: NOW });
    const b = simulate(mockCatalog(), 200, { rng: seeded(11) }, { now: NOW });
    assert.deepEqual(a.distribution, b.distribution);
  });

  it("lowest-latency reproduces the old pinned behaviour", () => {
    const result = simulate(mockCatalog(), 100, { strategy: "lowest-latency", rng: seeded(5) }, { now: NOW });
    assert.equal(result.distribution.length, 1);
    assert.equal(result.distribution[0].id, "share-vn-1");
  });

  it("round-robin walks the eligible pool", () => {
    const tracker = new SessionTracker();
    const result = simulate(mockCatalog(), 8, { strategy: "round-robin" }, { now: NOW, tracker });
    assert.equal(result.distribution.length, 4);
    for (const row of result.distribution) {
      assert.equal(row.connections, 2);
    }
  });

  it("least-loaded follows load, not latency", () => {
    const exits = [
      { id: "near-busy", protocol: "socks5", latency_ms: 10, load: 0.7, load_updated_at: NOW },
      { id: "far-idle", protocol: "socks5", latency_ms: 250, load: 0.05, load_updated_at: NOW }
    ];
    const chosen = chooseExit(exits, { strategy: "least-loaded" }, { now: NOW });
    assert.equal(chosen.id, "far-idle");
  });
});

describe("balancer / local session accounting", () => {
  it("counts sessions this client placed before the catalog catches up", () => {
    const tracker = new SessionTracker();
    tracker.place("share-vn-1");
    tracker.place("share-vn-1");
    const ranked = rankExits(mockCatalog(), {}, { now: NOW, sessions: tracker.counts() });
    const vn1 = ranked.find((r) => r.id === "share-vn-1");
    assert.equal(vn1.local_sessions, 2);
    assert.ok(vn1.load > 0.2, "locally placed sessions must raise the assumed load");
  });

  it("releases placements on disconnect", () => {
    const tracker = new SessionTracker();
    tracker.place("a");
    tracker.place("a");
    tracker.release("a");
    assert.deepEqual(tracker.counts(), { a: 1 });
    tracker.release("a");
    assert.deepEqual(tracker.counts(), {});
    assert.equal(tracker.total(), 0);
    tracker.release("missing");
    assert.deepEqual(tracker.counts(), {});
  });

  it("held connections drain away from an exit as it fills up", () => {
    const result = simulate(mockCatalog(), 40, { strategy: "least-loaded" }, { now: NOW, hold: true });
    assert.ok(result.distribution.length > 1, "held sessions must push later ones elsewhere");
  });
});

describe("balancer / region preference", () => {
  it("stays inside the requested region when it has capacity", () => {
    for (let i = 0; i < 30; i++) {
      const chosen = chooseExit(mockCatalog(), { rng: seeded(i + 1) }, { now: NOW, region: "vn" });
      assert.equal(chosen.region, "vn");
    }
  });

  it("leaves the region when every exit in it is saturated", () => {
    const exits = mockCatalog().map((e) =>
      e.region === "vn" ? { ...e, load: 1 } : e
    );
    const chosen = chooseExit(exits, { rng: seeded(9) }, { now: NOW, region: "vn" });
    assert.notEqual(chosen.region, "vn");
  });

  it("ignores an unknown region rather than failing the connection", () => {
    const chosen = chooseExit(mockCatalog(), { rng: seeded(2) }, { now: NOW, region: "antarctica" });
    assert.ok(chosen && chosen.protocol !== "direct");
  });
});

describe("catalog / pickExit still honours its contract", () => {
  it("throws on an empty catalog", () => {
    assert.throws(() => pickExit([], "auto"), /no exits available/);
  });

  it("returns a usable non-direct exit by default", () => {
    const exit = pickExit(mockCatalog(), "auto", { rng: seeded(4) }, { now: NOW });
    assert.ok(exit.id);
    assert.notEqual(exit.protocol, "direct");
  });

  it("respects the preferred region argument", () => {
    const exit = pickExit(mockCatalog(), "sg", { rng: seeded(4) }, { now: NOW });
    assert.equal(exit.id, "share-sg-1");
  });
});

describe("balancer / option hardening", () => {
  it("ignores junk numbers in a user config instead of scoring NaN", () => {
    const ranked = rankExits(
      mockCatalog(),
      { latencyWeightMs: "abc", saturationLoad: null, loadStaleMs: -5 },
      { now: NOW }
    );
    for (const row of ranked) {
      assert.ok(Number.isFinite(row.score), `${row.id} scored ${row.score}`);
    }
    assert.equal(ranked.find((r) => r.eligible).id, "share-vn-1");
  });

  it("falls back to the default strategy when asked for an unknown one", () => {
    const chosen = chooseExit(mockCatalog(), { strategy: "teleport", rng: seeded(1) }, { now: NOW });
    assert.ok(chosen && chosen.protocol !== "direct");
  });
});
