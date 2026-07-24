"use strict";

const { loadConfig, saveConfig, balancerOptions } = require("./config");
const { listExits, pickExit, rankCatalog, findExit, sampleExits, summarizeRegions } = require("./catalog");
const { simulate, STRATEGIES } = require("./balancer");
const session = require("./session");
const { startControlDaemon } = require("./dashboard");
const { formatBytes } = require("./meter");
const pkg = require("../package.json");

async function main(argv) {
  const [command = "help", ...rest] = argv;
  const flags = parseFlags(rest);
  switch (command) {
    case "version":
      console.log(JSON.stringify({ name: "trucvpn", version: pkg.version }, null, 2));
      return;
    case "help":
    case "--help":
    case "-h":
      return help();
    case "configure":
      return configure(flags);
    case "list":
    case "exits":
      return listCommand(flags);
    case "regions":
      return regionsCommand(flags);
    case "balance":
      return balanceCommand(flags);
    case "connect":
      return connectCommand(flags);
    case "disconnect":
      return disconnectCommand(flags);
    case "status":
      return statusCommand(flags);
    case "demo":
      return demoCommand(flags);
    case "daemon":
    case "serve":
    case "dashboard":
    case "gui":
      return daemonCommand(flags);
    case "doctor":
      return doctorCommand(flags);
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

function help() {
  console.log(`TrucVPN ${pkg.version} - residential VPN client (MRGMinner share exits)

Usage:
  trucvpn version
  trucvpn configure [--socks-port N] [--http-port N] [--dashboard-host HOST] [--dashboard-port N] [--share-url URL] [--region CODE]
                    [--balance-strategy NAME] [--saturation-load 0..1] [--latency-weight MS]
  trucvpn list [--balance] [--json]
  trucvpn regions [--json]
  trucvpn balance [--count N] [--region CODE] [--strategy NAME] [--seed N] [--json]
  trucvpn connect [--exit ID] [--region CODE] [--json]
  trucvpn disconnect [--json]
  trucvpn status [--json]
  trucvpn doctor
  trucvpn demo
  trucvpn daemon [--host HOST] [--port N]

Architecture:
  Native apps/extensions -> TrucVPN control daemon -> local SOCKS5/HTTP -> MRGMinner share exit -> Internet
  Sharers earn MRG for bandwidth via: mrgminner share start

MergeOS: https://github.com/mergeos-bounties - Token: MRG
`);
}

function configure(flags) {
  const updates = {};
  if (flags["socks-port"]) {
    updates.localSocksPort = Number(flags["socks-port"]);
  }
  if (flags["http-port"]) {
    updates.localHttpPort = Number(flags["http-port"]);
  }
  if (flags["dashboard-host"]) {
    updates.dashboardHost = String(flags["dashboard-host"]);
  }
  if (flags["dashboard-port"]) {
    updates.dashboardPort = Number(flags["dashboard-port"]);
  }
  if (flags["share-url"]) {
    updates.shareDiscoveryUrl = String(flags["share-url"]);
  }
  if (flags.region) {
    updates.preferredRegion = String(flags.region);
  }
  if (flags["balance-strategy"]) {
    const strategy = String(flags["balance-strategy"]);
    if (!STRATEGIES.includes(strategy)) {
      throw new Error(`unknown balance strategy: ${strategy} (use: ${STRATEGIES.join(", ")})`);
    }
    updates.balanceStrategy = strategy;
  }
  if (flags["saturation-load"]) {
    updates.balanceSaturationLoad = Number(flags["saturation-load"]);
  }
  if (flags["latency-weight"]) {
    updates.balanceLatencyWeightMs = Number(flags["latency-weight"]);
  }
  if (flags["kill-switch"] === true || flags["kill-switch"] === "true") {
    updates.killSwitch = true;
  }
  if (flags["kill-switch"] === "false") {
    updates.killSwitch = false;
  }
  const cfg = saveConfig(updates);
  console.log(JSON.stringify({ ok: true, config: redact(cfg) }, null, 2));
}

async function regionsCommand(flags) {
  const cfg = loadConfig();
  const exits = await listExits(cfg);
  const regions = summarizeRegions(exits);
  if (flags.json) {
    console.log(JSON.stringify({ regions }, null, 2));
    return;
  }
  console.log(`Regions (${regions.length})  exits=${exits.length}`);
  for (const region of regions) {
    console.log(
      `  ${region.region.padEnd(8)}  ${String(region.exits).padStart(3)} exits  ${String(region.residential).padStart(3)} residential`
    );
  }
}

async function listCommand(flags) {
  const cfg = loadConfig();
  const exits = await listExits(cfg);
  if (flags.balance) {
    return listBalanceView(cfg, exits, flags);
  }
  if (flags.json) {
    console.log(JSON.stringify({ exits }, null, 2));
    return;
  }
  console.log(`Exits (${exits.length})  share=${cfg.shareDiscoveryUrl}`);
  for (const e of exits) {
    const res = e.residential ? "residential" : "local";
    console.log(
      `  ${e.id.padEnd(18)}  ${String(e.region || "-").padEnd(6)}  ${String(e.protocol).padEnd(12)}  ${res}  ${e.latency_ms ?? "?"}ms  ${e.name || ""}`
    );
  }
}

/** Scored view: what the balancer sees, and which exits it will not use. */
function listBalanceView(cfg, exits, flags) {
  const sessions = session.getTracker().counts();
  const ranked = rankCatalog(exits, balancerOptions(cfg), { sessions });
  if (flags.json) {
    console.log(JSON.stringify({ strategy: cfg.balanceStrategy, exits: ranked }, null, 2));
    return;
  }
  console.log(`Balancer view (${ranked.length})  strategy=${cfg.balanceStrategy}  saturation=${cfg.balanceSaturationLoad}`);
  for (const row of ranked) {
    const load = row.load === null ? "  ?" : `${String(Math.round(row.load * 100)).padStart(3)}%`;
    const state = row.eligible ? "eligible" : `skip:${row.reason}`;
    console.log(
      `  ${String(row.id).padEnd(18)}  ${String(row.region || "-").padEnd(6)}  ` +
        `score ${String(row.score).padStart(7)}  ${String(row.latency_ms).padStart(5)}ms  ` +
        `load ${load} (${row.load_basis}/${row.load_freshness})  ${state}`
    );
  }
}

/** Deterministic PRNG so `--seed` reproduces a distribution exactly. */
function seededRng(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Place N connections over the live catalog and show where they land. */
async function balanceCommand(flags) {
  const cfg = loadConfig();
  const exits = await listExits(cfg);
  const options = balancerOptions(cfg);
  if (flags.strategy) {
    const strategy = String(flags.strategy);
    if (!STRATEGIES.includes(strategy)) {
      throw new Error(`unknown balance strategy: ${strategy} (use: ${STRATEGIES.join(", ")})`);
    }
    options.strategy = strategy;
  }
  if (flags.seed) {
    options.rng = seededRng(flags.seed);
  }
  const count = flags.count ? Number(flags.count) : 100;
  const result = simulate(exits, count, options, {
    region: flags.region || cfg.preferredRegion,
    hold: Boolean(flags.hold)
  });
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `Balance plan: ${result.connections} connections  strategy=${result.strategy}  region=${flags.region || cfg.preferredRegion}`
  );
  for (const row of result.distribution) {
    const bar = "#".repeat(Math.round(row.share * 40));
    console.log(`  ${row.id.padEnd(18)}  ${String(row.connections).padStart(5)}  ${(row.share * 100).toFixed(1).padStart(5)}%  ${bar}`);
  }
}

async function connectCommand(flags) {
  const s = await session.connect({
    exitId: flags.exit || flags.e,
    region: flags.region,
    json: Boolean(flags.json)
  });
  if (flags.json) {
    console.log(JSON.stringify(s.status(), null, 2));
  }
}

async function disconnectCommand(flags) {
  const r = await session.disconnect();
  if (flags.json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log("TrucVPN disconnected");
    if (r.last && r.last.traffic) {
      console.log(`  traffic ${formatBytes(r.last.traffic.bytes_total)}  est_mrg ${r.last.traffic.estimated_mrg_cost}`);
    }
  }
}

async function statusCommand(flags) {
  const s = await session.status();
  if (flags.json) {
    console.log(JSON.stringify(s, null, 2));
    return;
  }
  if (!s.connected) {
    console.log("status: disconnected");
    if (s.hint) {
      console.log(`  ${s.hint}`);
    }
    return;
  }
  console.log("status: connected");
  console.log(`  exit   ${s.exit.id} (${s.exit.protocol})`);
  console.log(`  socks  ${s.socks.host}:${s.socks.port}`);
  console.log(`  http   ${s.http.host}:${s.http.port}`);
  console.log(
    `  traffic in=${formatBytes(s.traffic.bytes_in)} out=${formatBytes(s.traffic.bytes_out)} mrg~${s.traffic.estimated_mrg_cost}`
  );
}

async function doctorCommand() {
  const cfg = loadConfig();
  const sample = sampleExits();
  const live = await listExits(cfg);
  const report = {
    version: pkg.version,
    config: redact(cfg),
    sample_exits: sample.length,
    listed_exits: live.length,
    residential: live.filter((e) => e.residential).length,
    share_url: cfg.shareDiscoveryUrl,
    ok: true
  };
  console.log(JSON.stringify(report, null, 2));
}

async function demoCommand(flags) {
  const cfg = loadConfig();
  const exits = await listExits(cfg);
  const pick = pickExit(exits, "local") || exits[0];
  const direct = findExit(exits, "direct-local") || pick;
  console.log("TrucVPN demo");
  console.log(`  catalog exits: ${exits.length}`);
  console.log(`  connecting via ${direct.id} ...`);
  const s = await session.connect({ exitId: direct.id, json: true });
  const st = s.status();
  console.log(`  SOCKS5 ${st.socks.host}:${st.socks.port}`);
  console.log(`  HTTP   ${st.http.host}:${st.http.port}`);
  if (!flags.keep) {
    await session.disconnect();
    console.log("  demo complete (disconnected). For live share: mrgminner share start && trucvpn connect");
  } else {
    console.log("  keeping session (--keep). Ctrl+C to stop after daemon if needed.");
  }
}

async function daemonCommand(flags) {
  const host = flags.host ? String(flags.host) : undefined;
  const port = flags.port ? Number(flags.port) : undefined;
  const { url } = await startControlDaemon({ host, port });
  console.log(`TrucVPN control daemon: ${url}`);
  console.log("Native apps and browser extensions use this local API.");
  console.log("Press Ctrl+C to stop.");
  await new Promise(() => {});
}

function redact(cfg) {
  return { ...cfg };
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      if (!flags._) {
        flags._ = [];
      }
      flags._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return flags;
}

module.exports = { main };
