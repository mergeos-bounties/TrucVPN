"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { sampleExits, pickExit, findExit } = require("../src/catalog");

describe("catalog", () => {
  it("has sample residential exits", () => {
    const exits = sampleExits();
    assert.ok(exits.length >= 3);
    assert.ok(exits.some((e) => e.residential));
    assert.ok(exits.some((e) => e.protocol === "direct"));
  });

  it("pickExit prefers low latency", () => {
    const exits = sampleExits().filter((e) => e.protocol !== "direct");
    const pick = pickExit(exits, "auto");
    assert.ok(pick.id);
  });

  it("findExit by id", () => {
    const exits = sampleExits();
    const e = findExit(exits, "direct-local");
    assert.equal(e.protocol, "direct");
  });
});
