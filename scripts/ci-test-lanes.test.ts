import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFullCoverage,
  partitionTargetedWeighted,
  partitionWeighted,
  requiresFullCoreFastTests,
  splitLargePackages,
} from "./ci-test-lanes.ts";

const pkgs = (...entries: Array<[string, number]>) =>
  entries.map(([name, files]) => ({ name, files }));

test("gives a package a core shard would push past a fair share its own lane", () => {
  const rest = pkgs(["design", 850], ["a", 400], ["b", 300], ["c", 200]);
  const lanes = partitionWeighted(rest, 4, 1200);
  const design = lanes.find((lane) => lane.packages.includes("design"));
  assert.deepEqual(design?.packages, ["design"]);
  assert.equal(design?.coreShard, "");
  assert.deepEqual(
    lanes
      .map((lane) => lane.coreShard)
      .filter(Boolean)
      .sort(),
    ["1/3", "2/3", "3/3"],
  );
  assert.ok(Math.max(...lanes.map((lane) => lane.files)) <= 850);
  assertFullCoverage(lanes, rest, true);
});

test("shards core across every lane when no package dominates", () => {
  const rest = pkgs(["a", 200], ["b", 150], ["c", 100]);
  const lanes = partitionWeighted(rest, 3, 900);
  assert.deepEqual(lanes.map((lane) => lane.coreShard).sort(), [
    "1/3",
    "2/3",
    "3/3",
  ]);
  assertFullCoverage(lanes, rest, true);
});

test("keeps a solo lane only when it shrinks the largest lane", () => {
  const rest = pkgs(["x", 5000], ["y", 5000]);
  const lanes = partitionWeighted(rest, 2, 100);
  assert.deepEqual(lanes.map((lane) => lane.coreShard).sort(), ["1/2", "2/2"]);
  assert.equal(Math.max(...lanes.map((lane) => lane.files)), 5050);
  assertFullCoverage(lanes, rest, true);
});

test("balances packages without core and never solos them", () => {
  const rest = pkgs(["design", 850], ["a", 100]);
  const lanes = partitionWeighted(rest, 5, null);
  assert.equal(lanes.length, 2);
  assert.ok(lanes.every((lane) => lane.coreShard === ""));
  assertFullCoverage(lanes, rest);
});

test("uses one core shard for a one-file changed selection", () => {
  const rest = pkgs(["design", 8]);
  const lanes = partitionTargetedWeighted(rest, 5, 1, "changed", [
    "src/example.test.ts",
  ]);

  assert.equal(lanes.length, 1);
  assert.equal(lanes[0]?.coreShard, "1/1");
  assert.equal(lanes[0]?.coreMode, "changed");
  assertFullCoverage(lanes, rest, true);
  assert.throws(() => partitionTargetedWeighted(rest, 5, 1, "changed", []));
});

test("does not create a core lane for an empty changed selection", () => {
  const lanes = partitionTargetedWeighted([], 5, 0, "changed");
  assert.deepEqual(lanes, []);
  assertFullCoverage(lanes, []);
});

test("falls back to all core tests for fixture, config, and instruction changes", () => {
  assert.equal(
    requiresFullCoreFastTests([
      "packages/core/src/templates/default/app/config.json",
    ]),
    true,
  );
  assert.equal(
    requiresFullCoreFastTests(["packages/core/src/vitest-config.ts"]),
    true,
  );
  assert.equal(requiresFullCoreFastTests(["vitest.shared.ts"]), true);
  assert.equal(requiresFullCoreFastTests([".agents/skills/qa/SKILL.md"]), true);
  assert.equal(requiresFullCoreFastTests(["AGENTS.md"]), true);
  assert.equal(requiresFullCoreFastTests(["README.md"]), false);
  assert.equal(
    requiresFullCoreFastTests(["packages/core/docs/content/deployment.mdx"]),
    false,
  );
});

test("refuses lanes that skip or repeat a core shard", () => {
  const lane = (coreShard: string, packages: string[] = []) => ({
    lane: "lane",
    filters: "",
    packages,
    packageShards: [],
    files: 1,
    coreShard,
    coreMode: coreShard ? "full" : "",
  });
  assert.throws(
    () => assertFullCoverage([lane("1/2"), lane("1/2")], [], true),
    /missing or duplicated/,
  );
  assert.throws(
    () => assertFullCoverage([lane("1/3"), lane("2/3")], [], true),
    /missing or duplicated/,
  );
});

test("shards a Vitest package heavier than a fair lane share", () => {
  const rest = [
    { name: "design", files: 900, shardable: true },
    { name: "a", files: 300 },
    { name: "b", files: 300 },
  ];
  const lanes = partitionWeighted(rest, 6, 900);
  const designShards = lanes
    .flatMap((lane) => lane.packageShards)
    .filter((shard) => shard.name === "design")
    .map((shard) => shard.shard)
    .sort();
  assert.deepEqual(designShards, ["1/3", "2/3", "3/3"]);
  assert.ok(lanes.every((lane) => !lane.packages.includes("design")));
  assert.ok(Math.max(...lanes.map((lane) => lane.files)) <= 450);
  assertFullCoverage(lanes, rest, true);
});

test("keeps packages whole when they are unshardable or too small to split", () => {
  assert.deepEqual(splitLargePackages([{ name: "custom", files: 900 }], 6, 0), [
    { name: "custom", files: 900 },
  ]);
  assert.deepEqual(
    splitLargePackages([{ name: "small", files: 150, shardable: true }], 8, 0),
    [{ name: "small", files: 150 }],
  );
});

test("shards a targeted package alongside changed core tests", () => {
  const rest = [{ name: "design", files: 800, shardable: true }];
  const lanes = partitionTargetedWeighted(rest, 4, 4, "changed", [
    "src/a.test.ts",
    "src/b.test.ts",
    "src/c.test.ts",
    "src/d.test.ts",
  ]);
  assert.equal(lanes.flatMap((lane) => lane.packageShards).length, 4);
  assertFullCoverage(lanes, rest, true);
});

test("refuses lanes that skip, repeat, or also run a sharded package whole", () => {
  const lane = (
    packageShards: Array<{ name: string; shard: string }>,
    packages: string[] = [],
  ) => ({
    lane: "lane",
    filters: "",
    packages,
    packageShards,
    files: 1,
    coreShard: "",
    coreMode: "" as const,
  });
  const expected = [{ name: "design" }];
  assert.throws(
    () =>
      assertFullCoverage([lane([{ name: "design", shard: "1/2" }])], expected),
    /design test shards are missing or duplicated/,
  );
  assert.throws(
    () =>
      assertFullCoverage(
        [
          lane([{ name: "design", shard: "1/2" }], ["design"]),
          lane([{ name: "design", shard: "2/2" }]),
        ],
        expected,
      ),
    /design test shards are missing or duplicated/,
  );
  assertFullCoverage(
    [
      lane([{ name: "design", shard: "1/2" }]),
      lane([{ name: "design", shard: "2/2" }]),
    ],
    expected,
  );
});
