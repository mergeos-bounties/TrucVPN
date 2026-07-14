"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("./config");
const session = require("./session");
const { listExits } = require("./catalog");

const PUBLIC = path.join(__dirname, "..", "public");

async function startDashboard({ host, port } = {}) {
  const config = loadConfig();
  const h = host || config.dashboardHost;
  const p = port || config.dashboardPort;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${h}:${p}`);
      if (url.pathname === "/api/status") {
        return json(res, await session.status());
      }
      if (url.pathname === "/api/exits") {
        return json(res, { exits: await listExits(config) });
      }
      if (url.pathname === "/api/connect" && req.method === "POST") {
        const body = await readBody(req);
        const data = body ? JSON.parse(body) : {};
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
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return file(res, path.join(PUBLIC, "index.html"), "text/html; charset=utf-8");
      }
      if (url.pathname === "/app.css") {
        return file(res, path.join(PUBLIC, "app.css"), "text/css; charset=utf-8");
      }
      if (url.pathname === "/app.js") {
        return file(res, path.join(PUBLIC, "app.js"), "application/javascript; charset=utf-8");
      }
      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(p, h, resolve);
  });
  return { server, host: h, port: p, url: `http://${h}:${p}/` };
}

function json(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function file(res, fp, type) {
  if (!fs.existsSync(fp)) {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  res.writeHead(200, { "Content-Type": type });
  res.end(fs.readFileSync(fp));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

module.exports = { startDashboard };
