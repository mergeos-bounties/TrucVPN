"use strict";

class BandwidthMeter {
  constructor() {
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.startedAt = Date.now();
    this.connections = 0;
  }

  record(direction, n) {
    const v = Math.max(0, Number(n) || 0);
    if (direction === "in") {
      this.bytesIn += v;
    } else {
      this.bytesOut += v;
    }
  }

  openConn() {
    this.connections += 1;
  }

  closeConn() {
    this.connections = Math.max(0, this.connections - 1);
  }

  totalBytes() {
    return this.bytesIn + this.bytesOut;
  }

  snapshot(consumerMrgPerGb = 2) {
    const total = this.totalBytes();
    const gb = total / (1024 * 1024 * 1024);
    return {
      bytes_in: this.bytesIn,
      bytes_out: this.bytesOut,
      bytes_total: total,
      connections: this.connections,
      uptime_sec: Math.round((Date.now() - this.startedAt) / 1000),
      estimated_mrg_cost: Math.round(gb * consumerMrgPerGb * 1000) / 1000
    };
  }
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) {
    return `${v} B`;
  }
  if (v < 1024 * 1024) {
    return `${(v / 1024).toFixed(1)} KB`;
  }
  if (v < 1024 * 1024 * 1024) {
    return `${(v / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(v / (1024 * 1024 * 1024)).toFixed(3)} GB`;
}

module.exports = { BandwidthMeter, formatBytes };
