"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SAMPLE = path.join(__dirname, "..", "data", "exits.sample.json");

/** Built-in offline residential-style exits (mock). */
function sampleExits() {
  if (fs.existsSync(SAMPLE)) {
    const data = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
    return Array.isArray(data.exits) ? data.exits : [];
  }
  return [
    {
      id: "mock-vn-hcm",
      name: "Vietnam - Ho Chi Minh",
      region: "vn",
      city: "Ho Chi Minh",
      latency_ms: 28,
      load: 0.22,
      protocol: "socks5",
      host: "127.0.0.1",
      port: 17890,
      residential: true,
      source: "mrgminner-share-mock"
    },
    {
      id: "mock-us-sfo",
      name: "United States - San Francisco",
      region: "us",
      city: "San Francisco",
      latency_ms: 120,
      load: 0.41,
      protocol: "socks5",
      host: "127.0.0.1",
      port: 17890,
      residential: true,
      source: "mrgminner-share-mock"
    },
    {
      id: "mock-sg-1",
      name: "Singapore",
      region: "sg",
      city: "Singapore",
      latency_ms: 45,
      load: 0.18,
      protocol: "http-connect",
      host: "127.0.0.1",
      port: 17891,
      residential: true,
      source: "mrgminner-share-mock"
    },
    {
      id: "direct-local",
      name: "Direct (no upstream - local proxy only)",
      region: "local",
      city: "Local",
      latency_ms: 1,
      load: 0,
      protocol: "direct",
      residential: false,
      source: "local"
    }
  ];
}

/**
 * Discover live exits from an MRGMinner share node.
 * GET {shareUrl}/v1/exits -> { exits: [...] }
 */
async function discoverShareExits(shareUrl, { timeoutMs = 2500 } = {}) {
  const base = String(shareUrl || "").replace(/\/$/, "");
  if (!base) {
    return [];
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/v1/exits`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    const exits = Array.isArray(data.exits) ? data.exits : [];
    return exits.map((e) => ({
      ...e,
      source: e.source || "mrgminner-share",
      residential: e.residential !== false
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

async function listExits(config) {
  const live = await discoverShareExits(config.shareDiscoveryUrl);
  const sample = sampleExits();
  if (live.length === 0) {
    return sample;
  }
  // Prefer live share exits, keep direct local for fallback
  const direct = sample.filter((e) => e.protocol === "direct");
  const byId = new Map();
  for (const e of [...live, ...direct]) {
    byId.set(e.id, e);
  }
  return [...byId.values()];
}

function pickExit(exits, preferredRegion = "auto") {
  if (!exits.length) {
    throw new Error("no exits available");
  }
  let pool = exits.filter((e) => e.protocol !== "direct");
  if (preferredRegion && preferredRegion !== "auto") {
    const region = preferredRegion.toLowerCase();
    const filtered = pool.filter(
      (e) => String(e.region || "").toLowerCase() === region || String(e.id).includes(region)
    );
    if (filtered.length) {
      pool = filtered;
    }
  }
  if (!pool.length) {
    pool = exits;
  }
  return pool.slice().sort((a, b) => {
    const la = Number(a.latency_ms || 9999) + Number(a.load || 0) * 100;
    const lb = Number(b.latency_ms || 9999) + Number(b.load || 0) * 100;
    return la - lb;
  })[0];
}

function findExit(exits, idOrName) {
  const key = String(idOrName || "").toLowerCase();
  return (
    exits.find((e) => String(e.id).toLowerCase() === key) ||
    exits.find((e) => String(e.name || "").toLowerCase().includes(key)) ||
    null
  );
}

module.exports = {
  sampleExits,
  discoverShareExits,
  listExits,
  pickExit,
  findExit
};
