import { describe, expect, it } from "vitest";

import {
  effectiveColumnRatios,
  formatColumnRatio,
  normalizeColumnRatios,
  parseColumnRatio,
  resizeColumnPair,
  seamPairRatio,
} from "./column-ratios";

describe("parseColumnRatio", () => {
  it("reads a percentage written as a number or a string", () => {
    expect(parseColumnRatio(60)).toBe(60);
    expect(parseColumnRatio("60")).toBe(60);
    expect(parseColumnRatio(" 33.333 ")).toBe(33.33);
    expect(parseColumnRatio("25%")).toBe(25);
  });

  it("refuses what isn't a share of the row", () => {
    for (const value of [0, -5, 101, Number.NaN, "", "wide", "1e2", null]) {
      expect(parseColumnRatio(value)).toBeNull();
    }
  });

  it("writes a ratio without trailing zeros", () => {
    expect(formatColumnRatio(50)).toBe("50");
    expect(formatColumnRatio(33.333333)).toBe("33.33");
  });
});

describe("normalizeColumnRatios", () => {
  it("leaves a set that gives no widths without any", () => {
    expect(normalizeColumnRatios([null, undefined, null])).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("keeps widths that already fill the row", () => {
    expect(normalizeColumnRatios([60, 40])).toEqual([60, 40]);
    expect(normalizeColumnRatios([33.33, 33.33, 33.33])).toEqual([
      33.33, 33.33, 33.33,
    ]);
  });

  it("shares what the given widths leave among the columns without one", () => {
    expect(normalizeColumnRatios([50, null, null])).toEqual([50, 25, 25]);
  });

  it("scales widths that don't add up to the whole row", () => {
    expect(normalizeColumnRatios([30, 30])).toEqual([50, 50]);
    expect(normalizeColumnRatios([80, 80, null])).toEqual([
      33.33, 33.33, 33.33,
    ]);
  });
});

describe("resizeColumnPair", () => {
  it("moves one seam and keeps the other columns' widths", () => {
    expect(resizeColumnPair([50, 25, 25], 1, 0.8)).toEqual([50, 40, 10]);
    expect(resizeColumnPair([null, null], 0, 0.7)).toEqual([70, 30]);
  });

  it("stops each column at its narrowest", () => {
    expect(resizeColumnPair([50, 50], 0, 0)).toEqual([10, 90]);
    expect(resizeColumnPair([50, 50], 0, 1)).toEqual([90, 10]);
    expect(resizeColumnPair([50, 50], 0, 0.1, 30)).toEqual([30, 70]);
  });

  it("splits two narrow columns evenly rather than overlap their minimums", () => {
    expect(resizeColumnPair([84, 8, 8], 1, 0)).toEqual([84, 8, 8]);
  });

  it("ignores a seam that isn't there", () => {
    expect(resizeColumnPair([60, 40], 1, 0.5)).toEqual([60, 40]);
  });

  it("measures the two columns beside a seam", () => {
    expect(seamPairRatio([50, 25, 25], 1)).toBe(50);
    expect(seamPairRatio([60, 40], 1)).toBe(40);
  });

  it("draws columns without widths as equal parts", () => {
    expect(effectiveColumnRatios([null, null, null, null])).toEqual([
      25, 25, 25, 25,
    ]);
  });
});
