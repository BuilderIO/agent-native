import { describe, expect, it } from "vitest";

import {
  openingTab,
  runOverlay,
  stepOverlayFromSteps,
} from "./workflow-run-overlay";

describe("stepOverlayFromSteps", () => {
  it("keeps one entry per node with its status and port counts", () => {
    expect(
      stepOverlayFromSteps([
        { nodeId: "a", status: "succeeded", ports: { out: { count: 5 } } },
        {
          nodeId: "b",
          status: "failed",
          ports: { match: { count: 1 }, otherwise: { count: 2 } },
        },
      ]),
    ).toEqual({
      a: { status: "succeeded", ports: { out: { count: 5 } } },
      b: {
        status: "failed",
        ports: { match: { count: 1 }, otherwise: { count: 2 } },
      },
    });
  });

  it("sums the passes of a loop and shows the status that most needs a look", () => {
    expect(
      stepOverlayFromSteps([
        { nodeId: "a", status: "succeeded", ports: { out: { count: 3 } } },
        { nodeId: "a", status: "needs_check", ports: { out: { count: 1 } } },
        { nodeId: "a", status: "succeeded", ports: { out: { count: 2 } } },
      ]),
    ).toEqual({
      a: { status: "needs_check", ports: { out: { count: 6 } } },
    });
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
        statuses.map((s) => ({ nodeId: "a", status: s, ports: {} })),
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
          ports: { replied: { count: 2 }, parked: { count: 3 } },
        },
        {
          nodeId: "wait",
          status: "succeeded",
          ports: { parked: { count: 1 } },
        },
      ]),
    ).toEqual({
      wait: { status: "succeeded", ports: { replied: { count: 2 } } },
    });
  });

  it("carries the reason of the step that decides the status", () => {
    const credentialMissing = {
      code: "credential_missing",
      message: "Connect slack in Dispatch.",
    };
    expect(
      stepOverlayFromSteps([
        { nodeId: "a", status: "succeeded", error: null, ports: {} },
        { nodeId: "a", status: "failed", error: credentialMissing, ports: {} },
        { nodeId: "a", status: "succeeded", error: null, ports: {} },
      ]).a,
    ).toEqual({ status: "failed", error: credentialMissing, ports: {} });
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
      runOverlay([{ nodeId: "a", status: "succeeded", ports: {} }]),
    ).toEqual({ stepByNodeId: { a: { status: "succeeded", ports: {} } } });
    expect(runOverlay([])).toEqual({ stepByNodeId: {} });
  });
});
