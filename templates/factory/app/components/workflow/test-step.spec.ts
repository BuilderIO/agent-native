import { describe, expect, it } from "vitest";

import { workflowNodeSchema, type WorkflowNode } from "@/lib/workflow-editor";

import type { NodeAudit } from "./items/read-types";
import { stepNeedsItems, testSampleFor } from "./test-step";

function node(kind: string, settings: unknown): WorkflowNode {
  return workflowNodeSchema.parse({
    id: "n1",
    name: "n1",
    kind,
    position: { x: 0, y: 0 },
    settings,
  });
}

const fixed = (value: unknown) => ({ mode: "fixed", value });
const fromPath = (path: string) => ({ mode: "path", path });

describe("stepNeedsItems", () => {
  it("lets a trigger and a source be tested on their own, as before", () => {
    expect(stepNeedsItems(node("trigger", { schedule: { every: "5m" } }))).toBe(
      false,
    );
    expect(
      stepNeedsItems(
        node("source", { source: "status", status: "received", takeLimit: 5 }),
      ),
    ).toBe(false);
  });

  it("lets a lookup that reads no item be tested on its own, once", () => {
    expect(
      stepNeedsItems(
        node("lookup", {
          operation: "github.apiRequest",
          args: {
            path: fixed("repos/acme/web/issues"),
            query: fixed({ state: "open" }),
          },
        }),
      ),
    ).toBe(false);
    expect(
      stepNeedsItems(
        node("lookup", {
          operation: "github.apiRequest",
          args: { path: fromPath("settings.extras.path") },
        }),
      ),
    ).toBe(false);
  });

  it("keeps the rule for a lookup that reads an item field, in a path or a hole", () => {
    expect(
      stepNeedsItems(
        node("lookup", {
          operation: "github.apiRequest",
          args: { path: fromPath("item.extras.path") },
        }),
      ),
    ).toBe(true);
    expect(
      stepNeedsItems(
        node("lookup", {
          operation: "github.apiRequest",
          args: { path: fixed("repos/{{ item.thread.repo }}/issues") },
        }),
      ),
    ).toBe(true);
  });

  it("keeps the rule for every step that is not a lookup", () => {
    expect(
      stepNeedsItems(
        node("action", {
          operation: "slack.postMessage",
          args: { to: fixed("C0123ABCD"), text: fixed("hi") },
        }),
      ),
    ).toBe(true);
    expect(stepNeedsItems(node("end", { outcome: "done" }))).toBe(true);
  });
});

describe("testSampleFor", () => {
  const step = (runId: string, startedAt: string, ids: (string | null)[]) => ({
    runId,
    startedAt,
    in: [
      {
        items: ids.map((itemId, index) => ({
          itemId: itemId ?? `blank-${index}`,
          title: itemId === null ? null : `Item ${itemId}`,
        })),
      },
    ],
  });
  /** An audit as the server returns it: `steps` are the latest runs, `latest` the newest that took items. */
  const audit = (
    steps: { runId: string; startedAt: string }[],
    latest: ReturnType<typeof step> | null,
  ) => ({ steps, latest }) as unknown as NodeAudit;

  it("takes at most three titled items from the newest run", () => {
    const old = step("r1", "2026-10-01T00:00:00.000Z", ["old"]);
    const newest = step("r2", "2026-10-02T00:00:00.000Z", [
      "a",
      "b",
      "c",
      "d",
      null,
    ]);
    expect(
      testSampleFor([audit([old], old), audit([newest, old], newest)]),
    ).toEqual({ itemIds: ["a", "b", "c"], fromOlderRun: false });
  });

  it("has nothing to give before any run has shown the step an item", () => {
    expect(testSampleFor([undefined, undefined])).toEqual({
      itemIds: [],
      fromOlderRun: false,
    });
  });

  it("samples an older run when the newest runs gave the step no items, and says so", () => {
    const empty = step("r3", "2026-10-03T00:00:00.000Z", []);
    const emptyLive = step("r2", "2026-10-02T00:00:00.000Z", []);
    const older = step("r1", "2026-10-01T00:00:00.000Z", ["a", "b"]);

    expect(
      testSampleFor([
        // The server hands back the newest step that took items: here the older one.
        audit([empty, older], older),
        audit([emptyLive], null),
      ]),
    ).toEqual({ itemIds: ["a", "b"], fromOlderRun: true });
  });

  it("does not call a sample old when it is from the newest run", () => {
    const newest = step("r2", "2026-10-02T00:00:00.000Z", ["a"]);
    expect(testSampleFor([audit([newest], newest)]).fromOlderRun).toBe(false);
  });

  it("is blocked, not sampled from an untitled item, when no run gave it an item that can be pinned", () => {
    const untitled = step("r1", "2026-10-01T00:00:00.000Z", [null]);
    expect(testSampleFor([audit([untitled], untitled)])).toEqual({
      itemIds: [],
      fromOlderRun: false,
    });
  });
});
