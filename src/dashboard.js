"use strict";

const http = require("node:http");
const os = require("node:os");
const { loadConfig, saveConfig } = require("./config");
const session = require("./session");
const { listExits } = require("./catalog");
const handshake = require("./handshake");
const pkg = require("../package.json");

async function startDashboard({ host, port } = {}) {
  return startControlDaemon({ host, port });
}

async function startControlDaemon({ host, port } = {}) {
  const config = loadConfig();
  const h = host || config.dashboardHost;
  const p = port ?? config.dashboardPort;
  const startedAt = Date.now();

  const server = http.createServer(async (req, res) => {
    setCommonHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url, `http://${h}:${p}`);
      if (url.pathname === "/" || url.pathname === "/api/health") {
        return json(res, {
          ok: true,
          service: "trucvpn-control",
          version: pkg.version,
          host: h,
          port: Number(p),
          platform: `${os.type()} ${os.release()}`,
          uptime_ms: Date.now() - startedAt,
          endpoints: [
            "GET /api/health",
            "GET /api/status",
            "GET /api/exits",
            "GET /api/config",
            "POST /api/config",
            "POST /api/connect",
            "POST /api/disconnect",
            "GET /api/proxy.pac",
            "POST /api/handshake"
          ]
        });
      }
      if (url.pathname === "/api/status") {
        return json(res, await session.status());
      }
      if (url.pathname === "/api/exits") {
        return json(res, { exits: await listExits(loadConfig()) });
      }
      if (url.pathname === "/api/config" && req.method === "GET") {
        return json(res, { config: publicConfig(loadConfig()) });
      }
      if (url.pathname === "/api/config" && req.method === "POST") {
        const data = await readJsonBody(req);
        return json(res, { ok: true, config: publicConfig(saveConfig(normalizeConfig(data))) });
      }
      if (url.pathname === "/api/connect" && req.method === "POST") {
        const data = await readJsonBody(req);
        const s = await session.connect({
          exitId: data.exit_id,
          region: data.region,
          json: true
        });
        return json(res, s.status());
      }
      if (url.pathname === "/api/disconnect" && req.method === "POST") {
        return json(res, await session.disconnect());
      }
      if (url.pathname === "/api/proxy.pac") {
        return proxyPac(res, loadConfig());
      }
      if (url.pathname === "/api/handshake" && req.method === "POST") {
        return json(res, handleHandshake(await readJsonBody(req), loadConfig()));
      }
      return error(res, 404, "not found");
    } catch (err) {
      return error(res, err instanceof SyntaxError ? 400 : 500, err.message);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(p, h, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : Number(p);
  return { server, host: h, port: actualPort, url: `http://${h}:${actualPort}/` };
}

function json(res, data) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function error(res, statusCode, message) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: message }, null, 2));
}

function proxyPac(res, config) {
  const httpHost = JSON.stringify(config.localHttpHost);
  const httpPort = Number(config.localHttpPort);
  const body = `function FindProxyForURL(url, host) {
  if (isPlainHostName(host) || host === "localhost" || host === "127.0.0.1") {
    return "DIRECT";
  }
  return "PROXY ${JSON.parse(httpHost)}:${httpPort}; DIRECT";
}
`;
  res.writeHead(200, { "Content-Type": "application/x-ns-proxy-autoconfig; charset=utf-8" });
  res.end(body);
}

function setCommonHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept");
  res.setHeader("Cache-Control", "no-store");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const body = await readBody(req);
  if (!body) {
    return {};
  }
  return JSON.parse(body);
}

/**
 * Control-plane handler for the exit auth token handshake.
 * Drives the client->exit->client flow used to authorize a consumer against a
 * residential exit. The shared secret is taken from the configured share
 * discovery URL's secret (env/secret store); falls back to a demo secret so
 * the flow is exercisable end-to-end against the local daemon.
 */
function handleHandshake(data, config) {
  const secret =
    process.env.TRUCVPN_SHARE_SECRET ||
    config.shareSecret ||
    "demo-shared-secret";
  const role = String(data.role || "client").toLowerCase();
  const ttlMs = data.ttl_ms != null ? Number(data.ttl_ms) : undefined;

  if (role === "client") {
    const r = handshake.clientBegin({ sharedSecret: secret, ttlMs });
    return { ok: true, role: "client", token: r.token, client_nonce: r.clientNonce, expiry_ms: r.expiryMs };
  }
  if (role === "exit") {
    if (!data.client_token) {
      throw new Error("exit role requires client_token");
    }
    const r = handshake.exitAccept({ sharedSecret: secret, clientToken: data.client_token, ttlMs });
    return { ok: true, role: "exit", client_nonce: r.clientNonce, exit_nonce: r.exitNonce, exit_token: r.exitToken, expiry_ms: r.expiryMs };
  }
  throw new Error("role must be 'client' or 'exit'");
}

function normalizeConfig(data) {  const updates = {};
  const pairs = [
    ["local_socks_port", "localSocksPort"],
    ["localSocksPort", "localSocksPort"],
    ["local_http_port", "localHttpPort"],
    ["localHttpPort", "localHttpPort"],
    ["dashboard_port", "dashboardPort"],
    ["dashboardPort", "dashboardPort"],
    ["share_discovery_url", "shareDiscoveryUrl"],
    ["shareDiscoveryUrl", "shareDiscoveryUrl"],
    ["preferred_region", "preferredRegion"],
    ["preferredRegion", "preferredRegion"],
    ["kill_switch", "killSwitch"],
    ["killSwitch", "killSwitch"],
    ["consumer_mrg_per_gb", "consumerMrgPerGb"],
    ["consumerMrgPerGb", "consumerMrgPerGb"]
  ];

  for (const [from, to] of pairs) {
    if (Object.prototype.hasOwnProperty.call(data, from)) {
      updates[to] = data[from];
    }
  }

  for (const key of ["localSocksPort", "localHttpPort", "dashboardPort"]) {
    if (updates[key] !== undefined) {
      updates[key] = normalizePort(updates[key], key);
    }
  }
  if (updates.killSwitch !== undefined) {
    updates.killSwitch = Boolean(updates.killSwitch);
  }
  if (updates.consumerMrgPerGb !== undefined) {
    const value = Number(updates.consumerMrgPerGb);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("consumer_mrg_per_gb must be a positive number");
    }
    updates.consumerMrgPerGb = value;
  }
  return updates;
}

function normalizePort(value, key) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${key} must be a TCP port between 1 and 65535`);
  }
  return port;
}

function publicConfig(config) {
  return {
    version: config.version,
    localSocksHost: config.localSocksHost,
    localSocksPort: config.localSocksPort,
    localHttpHost: config.localHttpHost,
    localHttpPort: config.localHttpPort,
    dashboardHost: config.dashboardHost,
    dashboardPort: config.dashboardPort,
    shareDiscoveryUrl: config.shareDiscoveryUrl,
    mergeosUrl: config.mergeosUrl,
    killSwitch: config.killSwitch,
    splitTunnel: config.splitTunnel,
    preferredRegion: config.preferredRegion,
    consumerMrgPerGb: config.consumerMrgPerGb
  };
}

module.exports = { startControlDaemon, startDashboard };
