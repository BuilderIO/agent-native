import { expect, it } from "vitest";

import {
  authoringFilterError,
  parseShard,
  readValueOption,
  selectShard,
} from "./run-options.ts";

it("reads one value and ignores an absent option", () => {
  expect(readValueOption(["--seed", "2"], "--seed")).toBe("2");
  expect(readValueOption(["--browser", "webkit"], "--seed")).toBeUndefined();
});

it("rejects missing values and repeated value-taking options", () => {
  expect(() => readValueOption(["--seed"], "--seed")).toThrow(
    "--seed requires a value",
  );
  expect(() => readValueOption(["--seed", "2", "--seed"], "--seed")).toThrow(
    "--seed may be provided only once",
  );
  expect(() => readValueOption(["--seed", "--steps", "500"], "--seed")).toThrow(
    "--seed requires a value",
  );
});

it("rejects a flow filter for the largest-slide latency-only source", () => {
  expect(authoringFilterError("largest", "slash")).toBe(
    "--authoring-flow cannot be combined with --authoring-source largest",
  );
  expect(authoringFilterError("flex-grid", "slash")).toBeUndefined();
  expect(authoringFilterError("largest")).toBeUndefined();
});

it("parses a 1-based shard position and rejects malformed ones", () => {
  expect(parseShard(undefined)).toBeUndefined();
  expect(parseShard("2/3")).toEqual({ index: 1, total: 3 });
  for (const bad of ["0/3", "4/3", "1/0", "1", "a/b", "1/3/5", "-1/3"]) {
    expect(() => parseShard(bad), bad).toThrow("--authoring-shard expects");
  }
});

it("splits items into disjoint shards that together cover every item", () => {
  const items = Array.from({ length: 55 }, (_, index) => index);
  for (const total of [1, 2, 3, 7]) {
    const shards = Array.from({ length: total }, (_, index) =>
      selectShard(items, { index, total }),
    );
    expect(shards.flat().sort((a, b) => a - b)).toEqual(items);
    const sizes = shards.map((shard) => shard.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  }
  expect(selectShard(items, undefined)).toEqual(items);
});
