import { describe, expect, it } from "vitest";

import { statusToneOf, summarizeMonitors } from "./status-summary";

const m = (id: string, lastStatus: string | null) =>
  ({ id, lastStatus }) as never;

const stats = (uptime24h: number | null) => ({ windows: { uptime24h } });

describe("statusToneOf", () => {
  it("maps error to down and unknown/running to neutral", () => {
    expect(statusToneOf("up")).toBe("up");
    expect(statusToneOf("down")).toBe("down");
    expect(statusToneOf("error")).toBe("down");
    expect(statusToneOf("degraded")).toBe("degraded");
    expect(statusToneOf("running")).toBe("neutral");
    expect(statusToneOf("unknown")).toBe("neutral");
    expect(statusToneOf(null)).toBe("neutral");
  });
});

describe("summarizeMonitors", () => {
  it("counts by health tone and treats error as down", () => {
    const summary = summarizeMonitors([
      m("a", "up"),
      m("b", "up"),
      m("c", "down"),
      m("d", "error"),
      m("e", "degraded"),
      m("f", "running"),
    ]);
    expect(summary.total).toBe(6);
    expect(summary.up).toBe(2);
    expect(summary.down).toBe(2);
    expect(summary.degraded).toBe(1);
    expect(summary.pending).toBe(1);
  });

  it("open incidents = currently failing (down + degraded)", () => {
    const summary = summarizeMonitors([
      m("a", "down"),
      m("b", "error"),
      m("c", "degraded"),
      m("d", "up"),
    ]);
    expect(summary.openIncidents).toBe(3);
  });

  it("overall tone escalates down > degraded > up", () => {
    expect(summarizeMonitors([m("a", "up"), m("b", "degraded")]).overall).toBe(
      "degraded",
    );
    expect(
      summarizeMonitors([m("a", "degraded"), m("b", "down")]).overall,
    ).toBe("down");
    expect(summarizeMonitors([m("a", "up")]).overall).toBe("up");
    expect(summarizeMonitors([]).overall).toBe("neutral");
  });

  it("averages 24h uptime only across monitors that report data", () => {
    const byId = new Map([
      ["a", stats(100)],
      ["b", stats(98)],
      ["c", stats(null)],
    ]);
    const summary = summarizeMonitors(
      [m("a", "up"), m("b", "degraded"), m("c", "up"), m("d", "up")],
      byId,
    );
    expect(summary.overallUptimePct).toBe(99);
  });

  it("returns null overall uptime when nothing reports", () => {
    const summary = summarizeMonitors([m("a", "up")], new Map());
    expect(summary.overallUptimePct).toBeNull();
  });
});
