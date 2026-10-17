import { describe, expect, it } from "vitest";

import {
  looksLikeLegacyChartShorthand,
  parseLegacyChartShorthand,
  wrapLegacyChartShorthandLines,
} from "./legacy-chart-shorthand.js";

describe("looksLikeLegacyChartShorthand", () => {
  it("matches any /word line with labels= and data=", () => {
    expect(looksLikeLegacyChartShorthand('/chart labels=["a"] data=[1]')).toBe(
      true,
    );
    expect(looksLikeLegacyChartShorthand('/plot labels=["a"] data=[1]')).toBe(
      true,
    );
  });

  it("rejects text without both labels= and data=", () => {
    expect(looksLikeLegacyChartShorthand("/chart title=x")).toBe(false);
    expect(looksLikeLegacyChartShorthand("just some text")).toBe(false);
  });

  it("rejects overly long lines", () => {
    const huge = `/chart labels=["a"] data=[${"1,".repeat(15_000)}1]`;
    expect(looksLikeLegacyChartShorthand(huge)).toBe(false);
  });

  it("rejects slash commands where labels=/data= aren't real arrays", () => {
    expect(
      looksLikeLegacyChartShorthand("/report labels=bug,urgent data=summary"),
    ).toBe(false);
    expect(
      looksLikeLegacyChartShorthand("/api/export?labels=true&data=csv"),
    ).toBe(false);
  });
});

describe("parseLegacyChartShorthand", () => {
  it("parses a single-series bar shorthand", () => {
    const parsed = parseLegacyChartShorthand(
      '/chart type=bar title="Visitors" labels=["Mon","Tue","Wed"] data=[5,8,14] color=#6366f1',
    );
    expect(parsed).toEqual({
      type: "bar",
      title: "Visitors",
      labels: ["Mon", "Tue", "Wed"],
      series: [{ label: "Visitors", data: [5, 8, 14], color: "#6366f1" }],
    });
  });

  it("parses multi-series data", () => {
    const parsed = parseLegacyChartShorthand(
      '/chart type=bar title="PRs" labels=["Mar","Apr"] data=[{"label":"Created","data":[115,277],"color":"#6366f1"},{"label":"Merged","data":[103,258],"color":"#22c55e"}]',
    );
    expect(parsed?.series).toHaveLength(2);
    expect(parsed?.series[0].label).toBe("Created");
    expect(parsed?.series[1].label).toBe("Merged");
  });

  it("handles escaped quotes inside the title", () => {
    const q = String.fromCharCode(34);
    const bs = String.fromCharCode(92);
    const line =
      "/chart title=" +
      q +
      "Sales " +
      bs +
      q +
      "Metrics" +
      bs +
      q +
      q +
      " labels=[" +
      q +
      "A" +
      q +
      "] data=[1]";
    const parsed = parseLegacyChartShorthand(line);
    expect(parsed?.title).toBe("Sales " + q + "Metrics" + q);
  });

  it("returns null when a series length does not match labels", () => {
    const parsed = parseLegacyChartShorthand(
      '/chart labels=["Mar","Apr","May"] data=[115,277]',
    );
    expect(parsed).toBeNull();
  });

  it("returns null for negative values", () => {
    const parsed = parseLegacyChartShorthand(
      '/chart labels=["Mar","Apr"] data=[-10,5]',
    );
    expect(parsed).toBeNull();
  });

  it("returns null when labels= is not immediately followed by an array", () => {
    const parsed = parseLegacyChartShorthand("/chart labels=oops data=[1,2]");
    expect(parsed).toBeNull();
  });

  it("handles labels containing bracket characters", () => {
    const parsed = parseLegacyChartShorthand(
      '/chart labels=["[Direct]","Organic"] data=[10,20]',
    );
    expect(parsed?.labels).toEqual(["[Direct]", "Organic"]);
  });

  it("returns null for deeply nested label arrays instead of throwing", () => {
    let nested = "1";
    for (let i = 0; i < 2000; i++) nested = `[${nested}]`;
    expect(() =>
      parseLegacyChartShorthand(`/chart labels=[${nested}] data=[1]`),
    ).not.toThrow();
    expect(
      parseLegacyChartShorthand(`/chart labels=[${nested}] data=[1]`),
    ).toBeNull();
  });

  it("does not crash on an oversized data array", () => {
    const hugeData = Array.from({ length: 200_000 }, () => 1).join(",");
    expect(() =>
      parseLegacyChartShorthand(`/chart labels=["A"] data=[${hugeData}]`),
    ).not.toThrow();
  });

  it("returns null for unrelated /commands without labels/data", () => {
    expect(parseLegacyChartShorthand("/charting some other text")).toBeNull();
  });

  it("skips a data= that appears inside an unrelated quoted string", () => {
    const parsed = parseLegacyChartShorthand(
      '/chart title="data=quality" labels=["A"] data=[1]',
    );
    expect(parsed?.series[0].data).toEqual([1]);
  });

  it("renders a single-label series without throwing", () => {
    const parsed = parseLegacyChartShorthand(
      '/chart type=line labels=["Now"] data=[5]',
    );
    expect(parsed?.labels).toEqual(["Now"]);
  });

  it("skips a data= embedded inside a label's own quoted text", () => {
    const parsed = parseLegacyChartShorthand(
      '/chart labels=["data=[1,2]","B"] data=[5,8]',
    );
    expect(parsed?.labels).toEqual(["data=[1,2]", "B"]);
    expect(parsed?.series[0].data).toEqual([5, 8]);
  });

  it("rejects rather than truncates when series count exceeds the limit", () => {
    const series = Array.from({ length: 7 }, (_, i) => ({
      label: `S${i}`,
      data: [1],
    }));
    const parsed = parseLegacyChartShorthand(
      `/chart labels=["A"] data=${JSON.stringify(series)}`,
    );
    expect(parsed).toBeNull();
  });

  it("accepts exactly the series limit", () => {
    const series = Array.from({ length: 6 }, (_, i) => ({
      label: `S${i}`,
      data: [1],
    }));
    const parsed = parseLegacyChartShorthand(
      `/chart labels=["A"] data=${JSON.stringify(series)}`,
    );
    expect(parsed?.series).toHaveLength(6);
  });
});

describe("wrapLegacyChartShorthandLines", () => {
  it("wraps a matching line in a chart-shorthand fence", () => {
    const wrapped = wrapLegacyChartShorthandLines(
      'Here you go:\n\n/chart labels=["a"] data=[1]\n\nDone.',
    );
    expect(wrapped).toContain("```chart-shorthand");
    expect(wrapped).toContain('/chart labels=["a"] data=[1]');
  });

  it("does not touch lines already inside a real fence", () => {
    const input = '```js\n/chart labels=["a"] data=[1]\n```';
    expect(wrapLegacyChartShorthandLines(input)).toBe(input);
  });

  it("returns the input unchanged when there is no labels=/data= pair", () => {
    const input = "Just a normal message with no charts.";
    expect(wrapLegacyChartShorthandLines(input)).toBe(input);
  });

  it("does not touch lines inside a tilde fence", () => {
    const input = '~~~text\n/chart labels=["a"] data=[1]\n~~~';
    expect(wrapLegacyChartShorthandLines(input)).toBe(input);
  });

  it("does not touch lines inside a four-backtick fence", () => {
    const input = '````md\n```js\n/chart labels=["a"] data=[1]\n```\n````';
    expect(wrapLegacyChartShorthandLines(input)).toBe(input);
  });

  it("does not touch 4-space indented code", () => {
    const input = '    /chart labels=["a"] data=[1]';
    expect(wrapLegacyChartShorthandLines(input)).toBe(input);
  });

  it("does not treat a 4-space indented ``` line as a real fence marker", () => {
    const input =
      'Example:\n\n    ```\n\n/chart labels=["a"] data=[1]\n\nDone.';
    const wrapped = wrapLegacyChartShorthandLines(input);
    expect(wrapped).toContain("```chart-shorthand");
    expect(wrapped).toContain('/chart labels=["a"] data=[1]');
  });

  it("preserves list-item indentation on the emitted fence", () => {
    const input = '1. Intro\n   /chart labels=["a"] data=[1]';
    const wrapped = wrapLegacyChartShorthandLines(input);
    expect(wrapped).toContain("   ```chart-shorthand");
    expect(wrapped).toContain('   /chart labels=["a"] data=[1]');
    expect(wrapped.trimEnd().endsWith("   ```")).toBe(true);
  });
});
