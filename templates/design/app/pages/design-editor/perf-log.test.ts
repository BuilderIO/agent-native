import { describe, expect, it } from "vitest";

import {
  buildPerfReport,
  createPerfRecorder,
  resolvePerfEnabled,
} from "./perf-log";

function fakeClock() {
  let value = 0;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

describe("createPerfRecorder", () => {
  it("records nothing while disabled", () => {
    const recorder = createPerfRecorder({ enabled: false });
    recorder.start("zoom")();
    recorder.count("render");
    recorder.record("save", 12);
    expect(recorder.snapshot()).toEqual({});
  });

  it("returns a shared no-op from start() while disabled so it allocates nothing", () => {
    const recorder = createPerfRecorder({ enabled: false });
    expect(recorder.start("a")).toBe(recorder.start("b"));
  });

  it("times a span between start and end", () => {
    const clock = fakeClock();
    const recorder = createPerfRecorder({ enabled: true, now: clock.now });
    const end = recorder.start("zoom");
    clock.advance(16);
    expect(end()).toBe(16);
    expect(recorder.snapshot().zoom).toEqual({
      count: 1,
      totalMs: 16,
      maxMs: 16,
      lastMs: 16,
    });
  });

  it("aggregates repeated samples and tracks the worst frame", () => {
    const clock = fakeClock();
    const recorder = createPerfRecorder({ enabled: true, now: clock.now });
    for (const ms of [4, 40, 8]) {
      const end = recorder.start("wheel");
      clock.advance(ms);
      end();
    }
    expect(recorder.snapshot().wheel).toEqual({
      count: 3,
      totalMs: 52,
      maxMs: 40,
      lastMs: 8,
    });
  });

  it("counts occurrences with no duration", () => {
    const recorder = createPerfRecorder({ enabled: true });
    recorder.count("render");
    recorder.count("render", 3);
    expect(recorder.snapshot().render).toMatchObject({
      count: 4,
      totalMs: 0,
    });
  });

  it("hands out copies so a caller cannot mutate live samples", () => {
    const recorder = createPerfRecorder({ enabled: true });
    recorder.count("render");
    const first = recorder.snapshot();
    first.render!.count = 999;
    expect(recorder.snapshot().render?.count).toBe(1);
  });

  it("clears samples when switched off so a later session starts clean", () => {
    const recorder = createPerfRecorder({ enabled: true });
    recorder.count("render");
    recorder.setEnabled(false);
    expect(recorder.snapshot()).toEqual({});
    recorder.setEnabled(true);
    recorder.count("render");
    expect(recorder.snapshot().render?.count).toBe(1);
  });

  it("resets on demand without disabling", () => {
    const recorder = createPerfRecorder({ enabled: true });
    recorder.count("render");
    recorder.reset();
    expect(recorder.snapshot()).toEqual({});
    expect(recorder.isEnabled()).toBe(true);
  });
});

describe("buildPerfReport", () => {
  it("sorts by total time so the hotspot is first", () => {
    const rows = buildPerfReport({
      cheap: { count: 10, totalMs: 5, maxMs: 1, lastMs: 0.5 },
      expensive: { count: 2, totalMs: 400, maxMs: 300, lastMs: 100 },
    });
    expect(rows.map((row) => row.label)).toEqual(["expensive", "cheap"]);
  });

  it("computes averages and rounds to two decimals", () => {
    const [row] = buildPerfReport({
      zoom: { count: 3, totalMs: 10, maxMs: 5, lastMs: 2 },
    });
    expect(row).toEqual({
      label: "zoom",
      count: 3,
      totalMs: 10,
      avgMs: 3.33,
      maxMs: 5,
    });
  });

  it("does not divide by zero for count-only labels", () => {
    const [row] = buildPerfReport({
      render: { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
    });
    expect(row?.avgMs).toBe(0);
  });

  it("orders count-only labels after timed ones", () => {
    const rows = buildPerfReport({
      renders: { count: 500, totalMs: 0, maxMs: 0, lastMs: 0 },
      timed: { count: 1, totalMs: 1, maxMs: 1, lastMs: 1 },
    });
    expect(rows.map((row) => row.label)).toEqual(["timed", "renders"]);
  });
});

describe("resolvePerfEnabled", () => {
  it("defaults to off", () => {
    expect(resolvePerfEnabled({})).toEqual({
      enabled: false,
      source: "default",
    });
  });

  it("turns on from the query string", () => {
    expect(resolvePerfEnabled({ search: "?perf=1" })).toEqual({
      enabled: true,
      source: "query",
    });
    expect(resolvePerfEnabled({ search: "view=overview&perf" })).toMatchObject({
      enabled: true,
    });
  });

  it("lets the query string force it off over a stored opt-in", () => {
    expect(resolvePerfEnabled({ search: "?perf=0", stored: "1" })).toEqual({
      enabled: false,
      source: "query",
    });
  });

  it("reads the stored opt-in when the query says nothing", () => {
    expect(resolvePerfEnabled({ stored: "1" })).toEqual({
      enabled: true,
      source: "storage",
    });
    expect(resolvePerfEnabled({ stored: "0" })).toEqual({
      enabled: false,
      source: "storage",
    });
  });

  it("ignores an unrelated query string", () => {
    expect(
      resolvePerfEnabled({ search: "?view=overview&zoom=24.52" }),
    ).toMatchObject({ source: "default" });
  });
});
