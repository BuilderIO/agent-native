import { describe, expect, it } from "vitest";

import {
  openingTab,
  runOverlay,
  stepOverlayFromSteps,
} from "./workflow-run-overlay";

const T0 = "2026-10-20T10:00:00.000Z";
const T1 = "2026-10-20T10:01:00.000Z";
const T2 = "2026-10-20T10:02:00.000Z";

describe("stepOverlayFromSteps", () => {
  it("keeps one entry per node with its status, port counts and passes", () => {
    expect(
      stepOverlayFromSteps([
        {
          nodeId: "a",
          status: "succeeded",
          startedAt: T0,
          ports: { out: { count: 5 } },
        },
        {
          nodeId: "b",
          status: "failed",
          startedAt: T0,
          ports: { match: { count: 1 }, otherwise: { count: 2 } },
        },
      ]),
    ).toEqual({
      a: { status: "succeeded", ports: { out: { count: 5 } }, passes: 1 },
      b: {
        status: "failed",
        ports: { match: { count: 1 }, otherwise: { count: 2 } },
        passes: 1,
      },
    });
  });

  it("sums the passes of a loop and shows the status that most needs a look", () => {
    expect(
      stepOverlayFromSteps([
        {
          nodeId: "a",
          status: "succeeded",
          startedAt: T0,
          ports: { out: { count: 3 } },
        },
        {
          nodeId: "a",
          status: "needs_check",
          startedAt: T1,
          ports: { out: { count: 1 } },
        },
        {
          nodeId: "a",
          status: "succeeded",
          startedAt: T2,
          ports: { out: { count: 2 } },
        },
      ]),
    ).toEqual({
      a: { status: "needs_check", ports: { out: { count: 6 } }, passes: 3 },
    });
  });

  it("counts a row's own passes when it covers more than one", () => {
    expect(
      stepOverlayFromSteps([
        {
          nodeId: "a",
          status: "succeeded",
          startedAt: T0,
          ports: { out: { count: 4 } },
          passes: 4,
        },
      ]).a?.passes,
    ).toBe(4);
  });

  it("ranks failed above needs_check above running above done", () => {
    const status = (
      ...statuses: (
        | "failed"
        | "needs_check"
        | "running"
        | "succeeded"
        | "skipped"
      )[]
    ) =>
      stepOverlayFromSteps(
        statuses.map((s) => ({
          nodeId: "a",
          status: s,
          startedAt: T0,
          ports: {},
        })),
      ).a?.status;
    expect(status("succeeded", "running")).toBe("running");
    expect(status("running", "needs_check")).toBe("needs_check");
    expect(status("needs_check", "failed", "succeeded")).toBe("failed");
    expect(status("skipped", "succeeded")).toBe("succeeded");
  });

  it("never draws the parked count as an output", () => {
    expect(
      stepOverlayFromSteps([
        {
          nodeId: "wait",
          status: "succeeded",
          startedAt: T0,
          ports: { replied: { count: 2 }, parked: { count: 3 } },
        },
        {
          nodeId: "wait",
          status: "succeeded",
          startedAt: T1,
          ports: { parked: { count: 1 } },
        },
      ]),
    ).toEqual({
      wait: {
        status: "succeeded",
        ports: { replied: { count: 2 } },
        passes: 2,
      },
    });
  });

  it("carries the reason of the step that decides the status", () => {
    const credentialMissing = {
      code: "credential_missing",
      message: "Connect slack in Dispatch.",
    };
    expect(
      stepOverlayFromSteps([
        {
          nodeId: "a",
          status: "succeeded",
          startedAt: T0,
          error: null,
          ports: {},
        },
        {
          nodeId: "a",
          status: "failed",
          startedAt: T1,
          error: credentialMissing,
          ports: {},
        },
        {
          nodeId: "a",
          status: "succeeded",
          startedAt: T2,
          error: null,
          ports: {},
        },
      ]).a,
    ).toEqual({
      status: "failed",
      error: credentialMissing,
      ports: {},
      passes: 3,
    });
  });

  it("is empty for a run with no steps", () => {
    expect(stepOverlayFromSteps([])).toEqual({});
  });
});

describe("openingTab", () => {
  it("opens Audit on a failed step, where the reason is, and Settings on any other", () => {
    expect(openingTab({ status: "failed", ports: {} })).toBe("audit");
    expect(openingTab({ status: "needs_check", ports: {} })).toBe("settings");
    expect(openingTab({ status: "succeeded", ports: {} })).toBe("settings");
    expect(openingTab(undefined)).toBe("settings");
  });
});

describe("runOverlay", () => {
  it("is nothing when no run is showing", () => {
    expect(runOverlay(undefined)).toBeUndefined();
  });

  it("is the step overlay of the run, and empty for a run with no steps", () => {
    expect(
      runOverlay([
        { nodeId: "a", status: "succeeded", startedAt: T0, ports: {} },
      ]),
    ).toEqual({
      stepByNodeId: { a: { status: "succeeded", ports: {}, passes: 1 } },
    });
    expect(runOverlay([])).toEqual({ stepByNodeId: {} });
  });

  it("marks the node whose step started last as the current one while the run goes", () => {
    const steps = [
      { nodeId: "a", status: "succeeded" as const, startedAt: T0, ports: {} },
      { nodeId: "b", status: "running" as const, startedAt: T1, ports: {} },
    ];
    expect(runOverlay(steps, { running: true })?.currentNodeId).toBe("b");
    expect(runOverlay(steps)?.currentNodeId).toBe("b");
  });

  it("keeps the current node on a finished step until the next step starts", () => {
    const first = [
      { nodeId: "a", status: "succeeded" as const, startedAt: T0, ports: {} },
      { nodeId: "b", status: "succeeded" as const, startedAt: T1, ports: {} },
    ];
    expect(runOverlay(first, { running: true })?.currentNodeId).toBe("b");
    const next = [
      ...first,
      { nodeId: "c", status: "running" as const, startedAt: T2, ports: {} },
    ];
    expect(runOverlay(next, { running: true })?.currentNodeId).toBe("c");
  });

  it("has no current node once the run has ended", () => {
    const steps = [
      { nodeId: "a", status: "succeeded" as const, startedAt: T0, ports: {} },
      { nodeId: "b", status: "succeeded" as const, startedAt: T1, ports: {} },
    ];
    expect(
      runOverlay(steps, { running: false })?.currentNodeId,
    ).toBeUndefined();
  });

  it("without a run status, has a current node only while a step is still running", () => {
    const done = [
      { nodeId: "a", status: "succeeded" as const, startedAt: T0, ports: {} },
      { nodeId: "b", status: "succeeded" as const, startedAt: T1, ports: {} },
    ];
    expect(runOverlay(done)?.currentNodeId).toBeUndefined();
  });
});
