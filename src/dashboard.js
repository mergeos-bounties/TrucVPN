"use strict";

const http = require("node:http");
const os = require("node:os");
const { loadConfig, saveConfig, balancerOptions } = require("./config");
const session = require("./session");
const { listExits, rankCatalog } = require("./catalog");
const { STRATEGIES } = require("./balancer");
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
      if (url.pathname === "/") {
        return html(res, dashboardHtml());
      }
      if (url.pathname === "/api/health") {
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
            "GET /api/balance",
            "GET /api/config",
            "POST /api/config",
            "POST /api/connect",
            "POST /api/disconnect",
            "GET /api/proxy.pac"
          ]
        });
      }
      if (url.pathname === "/api/status") {
        return json(res, await session.status());
      }
      if (url.pathname === "/api/exits") {
        return json(res, { exits: await listExits(loadConfig()) });
      }
      if (url.pathname === "/api/balance") {
        const cfg = loadConfig();
        const sessions = session.getTracker().counts();
        return json(res, {
          strategy: cfg.balanceStrategy,
          saturation_load: cfg.balanceSaturationLoad,
          local_sessions: sessions,
          exits: rankCatalog(await listExits(cfg), balancerOptions(cfg), { sessions })
        });
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

function html(res, body) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
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

function normalizeConfig(data) {
  const updates = {};
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
    ["consumerMrgPerGb", "consumerMrgPerGb"],
    ["balance_strategy", "balanceStrategy"],
    ["balanceStrategy", "balanceStrategy"],
    ["balance_saturation_load", "balanceSaturationLoad"],
    ["balanceSaturationLoad", "balanceSaturationLoad"],
    ["balance_latency_weight_ms", "balanceLatencyWeightMs"],
    ["balanceLatencyWeightMs", "balanceLatencyWeightMs"]
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
  if (updates.balanceStrategy !== undefined) {
    const strategy = String(updates.balanceStrategy);
    if (!STRATEGIES.includes(strategy)) {
      throw new Error(`balance_strategy must be one of: ${STRATEGIES.join(", ")}`);
    }
    updates.balanceStrategy = strategy;
  }
  if (updates.balanceSaturationLoad !== undefined) {
    const value = Number(updates.balanceSaturationLoad);
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new Error("balance_saturation_load must be a fraction between 0 and 1");
    }
    updates.balanceSaturationLoad = value;
  }
  if (updates.balanceLatencyWeightMs !== undefined) {
    const value = Number(updates.balanceLatencyWeightMs);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("balance_latency_weight_ms must be a positive number of milliseconds");
    }
    updates.balanceLatencyWeightMs = value;
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
    consumerMrgPerGb: config.consumerMrgPerGb,
    balanceStrategy: config.balanceStrategy,
    balanceSaturationLoad: config.balanceSaturationLoad,
    balanceLatencyWeightMs: config.balanceLatencyWeightMs
  };
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TrucVPN Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #eef3f7;
      --card: #ffffff;
      --ink: #101828;
      --muted: #667085;
      --green: #0e8a5f;
      --green-soft: #e7f8ef;
      --amber-soft: #fff7df;
      --amber: #b54708;
      --red-soft: #fee4e2;
      --red: #b42318;
      --line: #d0d5dd;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top left, #dff7ec, var(--bg) 34rem);
      color: var(--ink);
    }
    main {
      width: min(1120px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0 42px;
    }
    .hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 20px;
    }
    h1 { margin: 0; font-size: clamp(2rem, 5vw, 4rem); letter-spacing: -0.06em; }
    .subtle { color: var(--muted); margin: 6px 0 0; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid #bfe8d2;
      border-radius: 999px;
      padding: 8px 12px;
      background: var(--green-soft);
      color: var(--green);
      font-weight: 700;
      white-space: nowrap;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
      gap: 18px;
    }
    .card {
      background: color-mix(in srgb, var(--card) 94%, transparent);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 20px;
      box-shadow: 0 18px 50px rgba(16, 24, 40, 0.08);
    }
    .status-card.connected {
      background: linear-gradient(135deg, #0b3324, #0e8a5f);
      color: white;
    }
    .status-card.connected .subtle,
    .status-card.connected .stat-label { color: #c9f0dd; }
    .status-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
    }
    .state { font-size: clamp(1.7rem, 4vw, 3.2rem); margin: 0; letter-spacing: -0.04em; }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-top: 18px;
    }
    .stat {
      border: 1px solid rgba(208, 213, 221, 0.8);
      border-radius: 16px;
      padding: 12px;
      background: rgba(248, 250, 252, 0.92);
    }
    .connected .stat { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.22); }
    .stat-label {
      display: block;
      font-size: 0.72rem;
      color: var(--muted);
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .stat-value {
      display: block;
      margin-top: 4px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .traffic-chart {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: 54px 1fr 86px;
      gap: 10px;
      align-items: center;
      font-size: 0.9rem;
      color: var(--muted);
    }
    .bar {
      min-height: 13px;
      overflow: hidden;
      border-radius: 999px;
      background: #e4e7ec;
    }
    .bar > span {
      display: block;
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, #1db875, #0e8a5f);
      transition: width 240ms ease;
    }
    .exit-list { display: grid; gap: 10px; margin-top: 14px; }
    .exit {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 13px;
      background: #fff;
    }
    .exit strong { display: block; }
    .exit small { color: var(--muted); }
    .latency-badge {
      border-radius: 999px;
      padding: 7px 10px;
      font-weight: 800;
      background: var(--green-soft);
      color: var(--green);
      border: 1px solid #bfe8d2;
      min-width: 68px;
      text-align: center;
    }
    .latency-badge.medium { background: var(--amber-soft); color: var(--amber); border-color: #fedf89; }
    .latency-badge.slow { background: var(--red-soft); color: var(--red); border-color: #fecdca; }
    @media (max-width: 760px) {
      .hero, .grid { display: block; }
      .pill { margin-top: 12px; }
      .card { margin-top: 14px; }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .bar-row { grid-template-columns: 44px 1fr; }
      .bar-row output { grid-column: 2; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <h1>TrucVPN</h1>
        <p class="subtle">Live daemon dashboard for traffic, MRG metering, and residential exit health.</p>
      </div>
      <span class="pill" id="refresh-state">polling</span>
    </section>
    <section class="grid">
      <article class="card status-card" id="status-card">
        <div class="status-row">
          <div>
            <span class="stat-label">Secure tunnel</span>
            <h2 class="state" id="state">Checking</h2>
          </div>
          <span class="pill" id="connection-pill">Daemon</span>
        </div>
        <p class="subtle" id="hint">Loading status from the local control daemon...</p>
        <div class="stats">
          <div class="stat"><span class="stat-label">Exit</span><span class="stat-value" id="exit">-</span></div>
          <div class="stat"><span class="stat-label">HTTP proxy</span><span class="stat-value" id="http">-</span></div>
          <div class="stat"><span class="stat-label">SOCKS5</span><span class="stat-value" id="socks">-</span></div>
          <div class="stat"><span class="stat-label">MRG cost</span><span class="stat-value" id="mrg">0</span></div>
        </div>
        <div class="traffic-chart" aria-label="Live traffic chart">
          <div class="bar-row"><span>In</span><div class="bar"><span id="bar-in"></span></div><output id="bytes-in">0 B</output></div>
          <div class="bar-row"><span>Out</span><div class="bar"><span id="bar-out"></span></div><output id="bytes-out">0 B</output></div>
          <div class="bar-row"><span>Total</span><div class="bar"><span id="bar-total"></span></div><output id="bytes-total">0 B</output></div>
        </div>
      </article>
      <article class="card">
        <span class="stat-label">Exit network</span>
        <h2 style="margin: 4px 0 0;">Latency badges</h2>
        <p class="subtle">Routes are grouped with fast/medium/slow badges so the dashboard is readable at a glance.</p>
        <div class="exit-list" id="exits"></div>
      </article>
    </section>
  </main>
  <script>
    const text = (id, value) => { document.getElementById(id).textContent = value; };
    const endpoint = (value, fallback) => value ? \`\${value.host || fallback.host}:\${value.port || fallback.port}\` : \`\${fallback.host}:\${fallback.port}\`;
    const bytes = (n) => {
      const value = Number(n) || 0;
      if (value < 1024) return \`\${value} B\`;
      if (value < 1024 * 1024) return \`\${(value / 1024).toFixed(1)} KB\`;
      if (value < 1024 * 1024 * 1024) return \`\${(value / 1024 / 1024).toFixed(2)} MB\`;
      return \`\${(value / 1024 / 1024 / 1024).toFixed(3)} GB\`;
    };
    const latencyClass = (latency) => latency <= 60 ? "fast" : latency <= 150 ? "medium" : "slow";
    function renderTraffic(traffic) {
      const input = Number(traffic?.bytes_in || 0);
      const output = Number(traffic?.bytes_out || 0);
      const total = Number(traffic?.bytes_total || input + output);
      const max = Math.max(input, output, total, 1);
      text("bytes-in", bytes(input));
      text("bytes-out", bytes(output));
      text("bytes-total", bytes(total));
      document.getElementById("bar-in").style.width = \`\${Math.max(3, (input / max) * 100)}%\`;
      document.getElementById("bar-out").style.width = \`\${Math.max(3, (output / max) * 100)}%\`;
      document.getElementById("bar-total").style.width = \`\${Math.max(3, (total / max) * 100)}%\`;
    }
    function renderExits(exits) {
      const root = document.getElementById("exits");
      root.innerHTML = "";
      for (const exit of exits || []) {
        const latency = Number(exit.latency_ms ?? -1);
        const cls = latency >= 0 ? latencyClass(latency) : "slow";
        const item = document.createElement("div");
        item.className = "exit";
        item.innerHTML = \`
          <div>
            <strong>\${exit.name || exit.id}</strong>
            <small>\${exit.region || "auto"} / \${exit.protocol || "proxy"} / load \${Math.round(Number(exit.load || 0) * 100)}% / \${exit.residential ? "residential" : "direct"}</small>
          </div>
          <span class="latency-badge \${cls}">\${latency >= 0 ? latency + "ms" : "?ms"}</span>
        \`;
        root.appendChild(item);
      }
      if (!root.children.length) {
        root.innerHTML = '<p class="subtle">No exits returned by /api/exits.</p>';
      }
    }
    async function refresh() {
      try {
        const [statusRes, exitsRes] = await Promise.all([fetch("/api/status"), fetch("/api/exits")]);
        const status = await statusRes.json();
        const catalog = await exitsRes.json();
        const connected = Boolean(status.connected);
        document.getElementById("status-card").classList.toggle("connected", connected);
        text("state", connected ? "Protected" : "Disconnected");
        text("connection-pill", connected ? "Connected" : "Daemon ready");
        text("hint", connected ? "Traffic is routed through local TrucVPN proxies." : (status.hint || "Choose an exit, then connect."));
        text("exit", status.exit?.name || status.exit?.id || "Not connected");
        text("http", endpoint(status.http, { host: "127.0.0.1", port: 17881 }));
        text("socks", endpoint(status.socks, { host: "127.0.0.1", port: 17880 }));
        text("mrg", String(status.traffic?.estimated_mrg_cost ?? 0));
        renderTraffic(status.traffic);
        renderExits(catalog.exits);
        text("refresh-state", "updated " + new Date().toLocaleTimeString());
      } catch (err) {
        text("state", "Offline");
        text("hint", err.message);
        text("refresh-state", "daemon unreachable");
      }
    }
    refresh();
    setInterval(refresh, 2500);
  </script>
</body>
</html>`;
}

module.exports = { startControlDaemon, startDashboard, dashboardHtml };
