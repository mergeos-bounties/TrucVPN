"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { startDashboard, dashboardHtml } = require("../src/dashboard");

describe("public dashboard", () => {
  it("renders traffic chart and latency badge UI at the root route", async () => {
    const app = await startDashboard({ host: "127.0.0.1", port: 0 });
    try {
      const res = await fetch(app.url);
      const body = await res.text();

      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /text\/html/);
      assert.match(body, /TrucVPN Dashboard/);
      assert.match(body, /traffic-chart/);
      assert.match(body, /latency-badge/);
      assert.match(body, /fetch\("\/api\/status"\)/);
      assert.match(body, /fetch\("\/api\/exits"\)/);
      assert.match(body, /@media \(max-width: 760px\)/);
    } finally {
      app.server.close();
    }
  });

  it("keeps the health endpoint JSON-compatible for API clients", async () => {
    const app = await startDashboard({ host: "127.0.0.1", port: 0 });
    try {
      const res = await fetch(`${app.url}api/health`);
      const data = await res.json();

      assert.equal(res.status, 200);
      assert.equal(data.ok, true);
      assert.equal(data.service, "trucvpn-control");
      assert.ok(data.endpoints.includes("GET /api/status"));
    } finally {
      app.server.close();
    }
  });

  it("exports dashboard markup for smoke checks", () => {
    assert.match(dashboardHtml(), /Live daemon dashboard/);
  });
});
