"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULTS = {
  version: require("../package.json").version,
  localSocksHost: "127.0.0.1",
  localSocksPort: 17880,
  localHttpHost: "127.0.0.1",
  localHttpPort: 17881,
  dashboardHost: "127.0.0.1",
  dashboardPort: 17888,
  shareDiscoveryUrl: process.env.TRUCVPN_SHARE_URL || "http://127.0.0.1:17890",
  mergeosUrl: process.env.MERGEOS_URL || "https://mergeos.shop",
  killSwitch: false,
  splitTunnel: [],
  preferredRegion: "auto",
  /** Exit load balancing - see docs/load-balancing.md. */
  balanceStrategy: "p2c",
  balanceLatencyWeightMs: 250,
  balanceSaturationLoad: 0.9,
  balanceLoadStaleMs: 60000,
  /** MRG billed to consumer per GB through residential exit (mock economy). */
  consumerMrgPerGb: 2,
  stateDir: path.join(os.homedir(), ".trucvpn")
};

function statePath(...parts) {
  return path.join(DEFAULTS.stateDir, ...parts);
}

function ensureStateDir() {
  fs.mkdirSync(DEFAULTS.stateDir, { recursive: true });
}

function loadConfig() {
  ensureStateDir();
  const file = statePath("config.json");
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      user = {};
    }
  }
  return { ...DEFAULTS, ...user };
}

function saveConfig(partial) {
  ensureStateDir();
  const next = { ...loadConfig(), ...partial };
  fs.writeFileSync(statePath("config.json"), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

function loadSession() {
  ensureStateDir();
  const file = statePath("session.json");
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function saveSession(session) {
  ensureStateDir();
  if (!session) {
    const file = statePath("session.json");
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    return null;
  }
  fs.writeFileSync(statePath("session.json"), JSON.stringify(session, null, 2) + "\n", "utf8");
  return session;
}

/** Map user config onto the balancer's option names. */
function balancerOptions(config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  return {
    strategy: cfg.balanceStrategy,
    latencyWeightMs: Number(cfg.balanceLatencyWeightMs),
    saturationLoad: Number(cfg.balanceSaturationLoad),
    loadStaleMs: Number(cfg.balanceLoadStaleMs)
  };
}

module.exports = {
  DEFAULTS,
  balancerOptions,
  statePath,
  ensureStateDir,
  loadConfig,
  saveConfig,
  loadSession,
  saveSession
};
