"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { BandwidthMeter, formatBytes } = require("../src/meter");

describe("meter", () => {
  it("tracks bytes and mrg cost", () => {
    const m = new BandwidthMeter();
    m.record("in", 1024 * 1024);
    m.record("out", 1024 * 1024);
    const snap = m.snapshot(2);
    assert.equal(snap.bytes_total, 2 * 1024 * 1024);
    assert.ok(snap.estimated_mrg_cost >= 0);
  });

  it("formats bytes", () => {
    assert.match(formatBytes(500), /B/);
    assert.match(formatBytes(2048), /KB/);
  });
});
