"use strict";

/**
 * Exit load balancer.
 *
 * The catalog can hand us several share exits at once. Every consumer that
 * discovers the same catalog used to run the same argmin over it, so the
 * lowest-latency node collected every new connection while its neighbours sat
 * idle - and the `load` field it was scored on only moves when the share node
 * re-reports it, so nothing pushed the herd off again.
 *
 * This module keeps the scoring (latency + load still decide) and adds the two
 * things that make it a balancer: exits that cannot take the connection are
 * filtered out, and the choice among the good ones is spread instead of pinned.
 */

const DEFAULT_OPTIONS = {
  /** p2c | least-loaded | lowest-latency | weighted-random | round-robin */
  strategy: "p2c",
  /** ms of latency an exit is "worth" going from idle to fully loaded. */
  latencyWeightMs: 250,
  /** Score for an exit that reports no latency at all. */
  unknownLatencyMs: 400,
  /** At or above this normalized load an exit stops accepting new connections. */
  saturationLoad: 0.9,
  /** After this age a reported load is no longer trusted as-is. */
  loadStaleMs: 60_000,
  /** Load one locally placed session is assumed to add to an exit. */
  localSessionLoad: 0.05,
  /** Load assumed when an exit reports none (and when a stale one decays). */
  neutralLoad: 0.5,
  /** The local no-upstream exit is a fallback, not something to balance onto. */
  allowDirect: false,
  rng: Math.random
};

const STRATEGIES = ["p2c", "least-loaded", "lowest-latency", "weighted-random", "round-robin"];

/** key -> [min, max] a value has to sit in to be usable. */
const NUMERIC_OPTIONS = {
  latencyWeightMs: [0, Infinity],
  unknownLatencyMs: [0, Infinity],
  saturationLoad: [Number.EPSILON, 1],
  loadStaleMs: [0, Infinity],
  localSessionLoad: [0, 1],
  neutralLoad: [0, 1]
};

function resolveOptions(options = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  if (!STRATEGIES.includes(merged.strategy)) {
    merged.strategy = DEFAULT_OPTIONS.strategy;
  }
  if (typeof merged.rng !== "function") {
    merged.rng = DEFAULT_OPTIONS.rng;
  }
  // A junk value in ~/.trucvpn/config.json must not turn every score into NaN,
  // and `saturationLoad: null` must not read as 0 and disqualify every exit.
  for (const [key, [min, max]] of Object.entries(NUMERIC_OPTIONS)) {
    const raw = merged[key];
    const value = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    merged[key] = Number.isFinite(value) && value >= min && value <= max ? value : DEFAULT_OPTIONS[key];
  }
  return merged;
}

function clamp01(n) {
  if (!Number.isFinite(n)) {
    return null;
  }
  if (n < 0) {
    return 0;
  }
  return n > 1 ? 1 : n;
}

/**
 * Share nodes do not agree on how to report load: some send a 0..1 fraction,
 * some send percent, some only send session counters. Scoring the raw number
 * meant a node reporting `load: 22` (percent, 22% busy) was charged 2200ms and
 * never picked again, while `load: 0.22` next to it looked cheap.
 */
function normalizeLoad(exit) {
  if (!exit || typeof exit !== "object") {
    return { load: null, basis: "unknown" };
  }
  const sessions = Number(exit.sessions ?? exit.active_sessions);
  const capacity = Number(exit.max_sessions ?? exit.capacity);
  if (Number.isFinite(sessions) && Number.isFinite(capacity) && capacity > 0 && sessions >= 0) {
    return { load: clamp01(sessions / capacity), basis: "sessions" };
  }
  const raw = Number(exit.load ?? exit.load_pct ?? exit.utilization);
  if (!Number.isFinite(raw) || raw < 0) {
    return { load: null, basis: "unknown" };
  }
  // 0..1 is a fraction; anything above that is percent. A bare 1 is read as
  // "100% busy" - the pessimistic reading, and the one a fraction would mean.
  if (raw <= 1) {
    return { load: raw, basis: "fraction" };
  }
  return { load: clamp01(raw / 100), basis: "percent" };
}

function reportedAt(exit) {
  const stamp = exit && (exit.load_updated_at ?? exit.updated_at ?? exit.reported_at ?? exit.ts);
  if (stamp === undefined || stamp === null) {
    return null;
  }
  if (typeof stamp === "number") {
    // Seconds or milliseconds since epoch.
    return stamp > 1e12 ? stamp : stamp * 1000;
  }
  const parsed = Date.parse(String(stamp));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * A load reported ten minutes ago describes a share node that has since taken
 * everyone else's connections too. Decay it toward neutral by age so a fresh
 * mediocre report beats a stale flattering one.
 */
function effectiveLoad(exit, options, context = {}) {
  const opts = resolveOptions(options);
  const now = Number.isFinite(context.now) ? context.now : Date.now();
  const local = Number(context.localSessions || 0);
  const { load, basis } = normalizeLoad(exit);

  let value = load;
  let freshness = "n/a";
  if (value === null) {
    value = opts.neutralLoad;
    freshness = "unknown";
  } else {
    const stamp = reportedAt(exit);
    if (stamp !== null && opts.loadStaleMs > 0) {
      const age = Math.max(0, now - stamp);
      const decay = Math.min(1, age / (opts.loadStaleMs * 2));
      if (age > opts.loadStaleMs) {
        freshness = "stale";
      } else {
        freshness = "fresh";
      }
      value = value + (opts.neutralLoad - value) * decay;
    }
  }

  const withLocal = clamp01(value + local * opts.localSessionLoad);
  return { load: withLocal, reported: load, basis, freshness };
}

function latencyOf(exit, options) {
  const opts = resolveOptions(options);
  const raw = Number(exit && exit.latency_ms);
  // `latency_ms: 0` is a real reading from a loopback share node; the old
  // `latency_ms || 9999` turned it into the worst exit in the catalog.
  if (!Number.isFinite(raw) || raw < 0) {
    return { latency: opts.unknownLatencyMs, known: false };
  }
  return { latency: raw, known: true };
}

/** Lower is better. Latency in ms, load charged as latencyWeightMs at 100%. */
function scoreExit(exit, options, context = {}) {
  const opts = resolveOptions(options);
  const { latency, known } = latencyOf(exit, opts);
  const load = effectiveLoad(exit, opts, context);
  return {
    score: latency + load.load * opts.latencyWeightMs,
    latency,
    latency_known: known,
    ...load
  };
}

function isDown(exit) {
  if (!exit) {
    return true;
  }
  if (exit.healthy === false || exit.online === false || exit.available === false) {
    return true;
  }
  const status = String(exit.status || "").toLowerCase();
  return status === "down" || status === "offline" || status === "draining";
}

/**
 * Why an exit may not take a new connection. `null` means it can.
 * Saturation is a filter, not a penalty: charging a full node 250ms still let
 * it win against anything more than a quarter second further away.
 */
function ineligibleReason(exit, options, context = {}) {
  const opts = resolveOptions(options);
  if (!exit || !exit.id) {
    return "invalid";
  }
  if (isDown(exit)) {
    return "down";
  }
  if (!opts.allowDirect && String(exit.protocol) === "direct") {
    return "direct";
  }
  const { load } = effectiveLoad(exit, opts, context);
  if (load >= opts.saturationLoad) {
    return "saturated";
  }
  return null;
}

function matchesRegion(exit, region) {
  const want = String(region || "").trim().toLowerCase();
  if (!want || want === "auto") {
    return true;
  }
  return (
    String(exit.region || "").toLowerCase() === want ||
    String(exit.id || "").toLowerCase().includes(want)
  );
}

/**
 * Full ranking of a catalog: score, normalized load and why an exit was
 * skipped. Drives `trucvpn exits --balance` and every strategy below.
 */
function rankExits(exits, options = {}, context = {}) {
  const opts = resolveOptions(options);
  const now = Number.isFinite(context.now) ? context.now : Date.now();
  const sessions = context.sessions || {};
  const rows = (Array.isArray(exits) ? exits : []).map((exit) => {
    const local = Number(sessions[exit && exit.id] || 0);
    const ctx = { now, localSessions: local };
    const scored = scoreExit(exit, opts, ctx);
    const reason = ineligibleReason(exit, opts, ctx);
    return {
      exit,
      id: exit && exit.id,
      region: exit && exit.region,
      score: Number(scored.score.toFixed(2)),
      latency_ms: scored.latency,
      latency_known: scored.latency_known,
      load: scored.load === null ? null : Number(scored.load.toFixed(3)),
      reported_load: scored.reported,
      load_basis: scored.basis,
      load_freshness: scored.freshness,
      local_sessions: local,
      eligible: reason === null,
      reason
    };
  });
  return rows.sort((a, b) => a.score - b.score || String(a.id).localeCompare(String(b.id)));
}

function pickIndex(rng, length) {
  const n = rng();
  const i = Math.floor((Number.isFinite(n) ? Math.abs(n) % 1 : 0) * length);
  return i >= length ? length - 1 : i;
}

/** Power of two choices: sample two, keep the better. */
function chooseP2C(rows, opts) {
  if (rows.length === 1) {
    return rows[0];
  }
  const a = pickIndex(opts.rng, rows.length);
  let b = pickIndex(opts.rng, rows.length);
  if (b === a) {
    b = (a + 1) % rows.length;
  }
  return rows[a].score <= rows[b].score ? rows[a] : rows[b];
}

/** Probability inversely proportional to score, so cheap exits win more often. */
function chooseWeightedRandom(rows, opts) {
  const weights = rows.map((r) => 1 / Math.max(1, r.score));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const draw = opts.rng();
  let ticket = (Number.isFinite(draw) ? Math.abs(draw) % 1 : 0) * total;
  for (let i = 0; i < rows.length; i++) {
    ticket -= weights[i];
    if (ticket <= 0) {
      return rows[i];
    }
  }
  return rows[rows.length - 1];
}

function chooseRoundRobin(rows, context) {
  const tracker = context.tracker;
  const cursor = tracker && typeof tracker.next === "function" ? tracker.next() : 0;
  return rows[cursor % rows.length];
}

/**
 * Pick one exit for a new connection.
 * Returns null only when `exits` holds nothing usable at all.
 */
function chooseExit(exits, options = {}, context = {}) {
  const opts = resolveOptions(options);
  const sessions = context.sessions || (context.tracker ? context.tracker.counts() : {});
  const ranked = rankExits(exits, opts, { ...context, sessions });
  if (!ranked.length) {
    return null;
  }

  const inRegion = ranked.filter((r) => matchesRegion(r.exit, context.region || opts.region));
  const ladder = [
    inRegion.filter((r) => r.eligible),
    ranked.filter((r) => r.eligible),
    // Everything is saturated or down: rather than refuse the connection, fall
    // back to the least-bad non-direct exit, then to direct.
    inRegion.filter((r) => r.reason !== "direct" && r.reason !== "invalid"),
    ranked.filter((r) => r.reason !== "direct" && r.reason !== "invalid"),
    ranked
  ];
  const pool = ladder.find((candidates) => candidates.length > 0) || ranked;

  let chosen;
  switch (opts.strategy) {
    case "lowest-latency":
      chosen = pool.slice().sort((a, b) => a.latency_ms - b.latency_ms || a.score - b.score)[0];
      break;
    case "least-loaded":
      chosen = pool.slice().sort((a, b) => a.load - b.load || a.score - b.score)[0];
      break;
    case "weighted-random":
      chosen = chooseWeightedRandom(pool, opts);
      break;
    case "round-robin":
      chosen = chooseRoundRobin(pool, context);
      break;
    case "p2c":
    default:
      chosen = chooseP2C(pool, opts);
      break;
  }
  return chosen ? chosen.exit : null;
}

/**
 * Local placement bookkeeping. One CLI process holds one session, but the
 * control daemon places many over its lifetime and the catalog will not have
 * caught up with any of them - this keeps consecutive placements from stacking
 * on the same node between two catalog refreshes.
 */
class SessionTracker {
  constructor() {
    this.byExit = new Map();
    this.cursor = 0;
  }

  place(exitId) {
    if (!exitId) {
      return 0;
    }
    const next = (this.byExit.get(exitId) || 0) + 1;
    this.byExit.set(exitId, next);
    return next;
  }

  release(exitId) {
    if (!exitId || !this.byExit.has(exitId)) {
      return 0;
    }
    const next = this.byExit.get(exitId) - 1;
    if (next <= 0) {
      this.byExit.delete(exitId);
      return 0;
    }
    this.byExit.set(exitId, next);
    return next;
  }

  counts() {
    return Object.fromEntries(this.byExit);
  }

  total() {
    let sum = 0;
    for (const n of this.byExit.values()) {
      sum += n;
    }
    return sum;
  }

  next() {
    const value = this.cursor;
    this.cursor += 1;
    return value;
  }

  reset() {
    this.byExit.clear();
    this.cursor = 0;
  }
}

/**
 * Place `count` connections over a catalog and report where they landed.
 * Backs `trucvpn balance --count N` and the distribution tests.
 */
function simulate(exits, count = 100, options = {}, context = {}) {
  const opts = resolveOptions(options);
  const tracker = context.tracker || new SessionTracker();
  const distribution = new Map();
  const total = Math.max(0, Math.floor(count));
  for (let i = 0; i < total; i++) {
    const exit = chooseExit(exits, opts, { ...context, tracker, sessions: tracker.counts() });
    const id = exit ? exit.id : "(none)";
    distribution.set(id, (distribution.get(id) || 0) + 1);
    if (context.hold) {
      tracker.place(id);
    }
  }
  return {
    strategy: opts.strategy,
    connections: total,
    distribution: [...distribution.entries()]
      .map(([id, connections]) => ({
        id,
        connections,
        share: total ? Number((connections / total).toFixed(3)) : 0
      }))
      .sort((a, b) => b.connections - a.connections || a.id.localeCompare(b.id))
  };
}

module.exports = {
  DEFAULT_OPTIONS,
  STRATEGIES,
  normalizeLoad,
  effectiveLoad,
  scoreExit,
  ineligibleReason,
  rankExits,
  chooseExit,
  simulate,
  SessionTracker
};
