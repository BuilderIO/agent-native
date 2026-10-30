import { describe, expect, it } from "vitest";

import { workflowNodeSchema, type WorkflowNode } from "@/lib/workflow-editor";

import type { NodeAudit } from "./items/read-types";
import { sampleItemIdsFor, stepNeedsItems } from "./test-step";

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

describe("sampleItemIdsFor", () => {
  const step = (startedAt: string, ids: (string | null)[]) =>
    ({
      latest: {
        startedAt,
        in: [
          {
            items: ids.map((itemId, index) => ({
              itemId: itemId ?? `blank-${index}`,
              title: itemId === null ? null : `Item ${itemId}`,
            })),
          },
        ],
      },
    }) as unknown as NodeAudit;

  it("takes at most three titled items from the newest run", () => {
    expect(
      sampleItemIdsFor([
        step("2026-10-01T00:00:00.000Z", ["old"]),
        step("2026-10-02T00:00:00.000Z", ["a", "b", "c", "d", null]),
      ]),
    ).toEqual(["a", "b", "c"]);
  });

  it("has nothing to give before any run has shown the step an item", () => {
    expect(sampleItemIdsFor([undefined, undefined])).toEqual([]);
  });
});
