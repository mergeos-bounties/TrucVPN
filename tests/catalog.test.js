"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { sampleExits, pickExit, findExit, summarizeRegions } = require("../src/catalog");

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

  it("summarizes the offline catalog by region", () => {
    const regions = summarizeRegions(sampleExits());
    assert.deepEqual(
      regions.map(({ region, exits, residential }) => ({ region, exits, residential })),
      [
        { region: "eu", exits: 1, residential: 1 },
        { region: "local", exits: 1, residential: 0 },
        { region: "sg", exits: 1, residential: 1 },
        { region: "us", exits: 1, residential: 1 },
        { region: "vn", exits: 2, residential: 2 }
      ]
    );
  });

  it("normalizes missing and mixed-case region names", () => {
    assert.deepEqual(summarizeRegions([
      { region: " US ", residential: true },
      { region: "us", residential: false },
      { residential: true }
    ]), [
      { region: "unknown", exits: 1, residential: 1 },
      { region: "us", exits: 2, residential: 1 }
    ]);
  });
});
