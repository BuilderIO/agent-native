import { describe, expect, it } from "vitest";

import type { NodeKind } from "@/lib/workflow-editor";

import {
  openingTab,
  recordedStepsKey,
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

describe("steps no item reached", () => {
  const row = (
    nodeId: string,
    nodeKind: NodeKind,
    received: number,
    ports: Record<string, { count: number }> = {},
    over: Partial<Parameters<typeof stepOverlayFromSteps>[0][number]> = {},
  ) => ({
    nodeId,
    nodeKind,
    status: "succeeded" as const,
    startedAt: T0,
    fields: { in: received },
    ports,
    ...over,
  });
  const marked = (steps: Parameters<typeof stepOverlayFromSteps>[0]) =>
    Object.keys(stepOverlayFromSteps(steps)).sort();

  it("marks only the Trigger and the Source in a run that took nothing", () => {
    expect(
      marked([
        row("start", "trigger", 0, { out: { count: 0 } }),
        row("messages", "source", 0, { out: { count: 0 } }),
        row("filter", "switch", 0, {
          match: { count: 0 },
          otherwise: { count: 0 },
        }),
        row("reply", "action", 0, { out: { count: 0 } }),
        row("done", "end", 0),
      ]),
    ).toEqual(["messages", "start"]);
  });

  it("marks every step the items passed", () => {
    expect(
      marked([
        row("start", "trigger", 0, { out: { count: 0 } }),
        row("messages", "source", 0, { out: { count: 2 } }),
        row("filter", "switch", 2, {
          match: { count: 1 },
          otherwise: { count: 1 },
        }),
        row("reply", "action", 1, { out: { count: 1 } }),
        row("done", "end", 1),
        row("ignored", "end", 1),
      ]),
    ).toEqual(["done", "filter", "ignored", "messages", "reply", "start"]);
  });

  it("keeps the mark of a step that handed items on after it was woken with none", () => {
    expect(marked([row("wait", "wait", 0, { replied: { count: 2 } })])).toEqual(
      ["wait"],
    );
  });

  it("keeps the error mark of a step that failed, and draws none after it for steps no item reached", () => {
    const reply = {
      code: "slack_post_rejected",
      message: "Slack rejected the message.",
    };
    const overlay = stepOverlayFromSteps([
      row("filter", "switch", 1, { match: { count: 1 } }),
      row("reply", "action", 1, {}, { status: "failed", error: reply }),
      row("done", "end", 0),
      row("ignored", "end", 0),
    ]);
    expect(overlay.reply).toMatchObject({ status: "failed", error: reply });
    expect(overlay.filter?.status).toBe("succeeded");
    expect(overlay).not.toHaveProperty("done");
    expect(overlay).not.toHaveProperty("ignored");
  });

  it("keeps a failed step even when nothing reached it", () => {
    expect(
      stepOverlayFromSteps([
        row("reply", "action", 0, {}, { status: "failed" }),
      ]).reply?.status,
    ).toBe("failed");
  });

  it("leaves a step the engine skipped as it was recorded", () => {
    expect(
      stepOverlayFromSteps([row("done", "end", 0, {}, { status: "skipped" })])
        .done?.status,
    ).toBe("skipped");
  });

  it("shows a row as recorded when it cannot say what reached it or what it is", () => {
    const status = (over: Parameters<typeof row>[4]) =>
      stepOverlayFromSteps([row("a", "end", 0, {}, over)]).a?.status;
    expect(status({ fields: null })).toBe("succeeded");
    expect(status({ fields: {} })).toBe("succeeded");
    expect(status({ nodeKind: null })).toBe("succeeded");
    expect(
      stepOverlayFromSteps([
        {
          nodeId: "a",
          status: "succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          ports: {},
          fields: { in: 0 },
        },
      ]).a?.status,
    ).toBe("succeeded");
  });

  it("still lights the node the run is on, whatever it has taken in", () => {
    const steps = [
      row("start", "trigger", 0, { out: { count: 0 } }),
      row("filter", "switch", 0, { match: { count: 0 } }),
    ];
    expect(runOverlay(steps, { running: true })).toMatchObject({
      currentNodeId: "filter",
      stepByNodeId: { start: { status: "succeeded" } },
    });
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

describe("recordedStepsKey", () => {
  const filter = (status: "running" | "succeeded", match: number) => ({
    status,
    ports: { match: { count: match }, otherwise: { count: 0 } },
    passes: 1,
  });

  it("is empty until a step is recorded", () => {
    expect(recordedStepsKey(undefined)).toBe("");
    expect(recordedStepsKey({})).toBe("");
  });

  it("changes when a step finishes, so a read made before it did is read again", () => {
    const beforeFinish = recordedStepsKey({ pick: filter("running", 0) });
    const afterFinish = recordedStepsKey({ pick: filter("succeeded", 2) });
    expect(afterFinish).not.toBe(beforeFinish);
  });

  it("changes when only a count does", () => {
    expect(recordedStepsKey({ pick: filter("succeeded", 1) })).not.toBe(
      recordedStepsKey({ pick: filter("succeeded", 2) }),
    );
  });

  it("is the same for the same record, whatever order it is listed in", () => {
    const a = { status: "succeeded" as const, ports: { out: { count: 2 } } };
    expect(recordedStepsKey({ src: a, pick: filter("succeeded", 2) })).toBe(
      recordedStepsKey({ pick: filter("succeeded", 2), src: a }),
    );
  });
});
