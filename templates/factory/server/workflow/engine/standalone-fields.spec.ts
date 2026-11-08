import { describe, expect, it } from "vitest";

import type { WorkflowNodeOfKind } from "../contract.js";
import {
  aiWritten,
  buildGraph,
  fixed,
  fromPath,
} from "../story-graphs.fixture.js";
import { buildTestCatalog } from "../testing/test-catalog.js";
import { resolveStandaloneFields } from "./standalone-fields.js";

const NOW = new Date("2026-10-30T12:00:00.000Z");

function resolve(
  args: Record<string, unknown>,
  options: {
    lastTriggerAt?: string | null;
    settings?: Record<string, unknown>;
  } = {},
) {
  const graph = buildGraph({
    settings: options.settings ?? {},
    nodes: [
      ["start", "trigger", { schedule: { every: "15m" } }],
      ["read", "lookup", { operation: "test.typed", args }],
      ["done", "end", { outcome: "done" }],
    ],
    edges: [
      ["start", "out", "read"],
      ["read", "out", "done"],
    ],
  });
  const node = graph.nodes.find(
    (candidate): candidate is WorkflowNodeOfKind<"lookup"> =>
      candidate.id === "read" && candidate.kind === "lookup",
  );
  const def = buildTestCatalog().get("test.typed");
  if (!node || !def) throw new Error("the fixture is missing a piece");
  return resolveStandaloneFields({
    node,
    def,
    graph,
    lastTriggerAt: options.lastTriggerAt ?? null,
    now: NOW,
    runId: "run-1",
  });
}

describe("resolveStandaloneFields", () => {
  it("fills fixed values, settings and the run the way a run does, with no item", () => {
    const resolved = resolve(
      {
        note: fromPath("settings.extras.note"),
        level: fixed("high"),
        extra: fixed({ at: "{{ run.startedAt }}", mode: "{{ run.mode }}" }),
      },
      { settings: { extras: { note: "from settings" } } },
    );
    expect(resolved).toEqual({
      ok: true,
      fields: {
        note: "from settings",
        level: "high",
        extra: { at: NOW.toISOString(), mode: "test" },
      },
    });
  });

  it("reads the window from the Trigger's schedule ending now, or from the last firing", () => {
    const first = resolve({
      extra: fixed({
        from: "{{ run.windowStart }}",
        to: "{{ run.windowEnd }}",
      }),
    });
    expect(first).toMatchObject({
      ok: true,
      fields: {
        extra: { from: "2026-10-30T11:45:00.000Z", to: NOW.toISOString() },
      },
    });

    const after = resolve(
      { extra: fixed({ from: "{{ run.windowStart }}" }) },
      { lastTriggerAt: "2026-10-30T10:00:00.000Z" },
    );
    expect(after).toMatchObject({
      ok: true,
      fields: { extra: { from: "2026-10-30T10:00:00.000Z" } },
    });
  });

  it("fails a path with no value, as a run fails the item", () => {
    expect(resolve({ note: fromPath("settings.extras.missing") })).toEqual({
      ok: false,
      failure: {
        code: "expression_failed",
        message: 'args.note: "settings.extras.missing" has no value here.',
      },
    });
  });

  it("fails a value of the wrong type before anything is sent", () => {
    expect(resolve({ count: fixed("many") })).toMatchObject({
      ok: false,
      failure: { code: "expression_failed" },
    });
  });

  it("will not resolve a field a model writes, which needs an item", () => {
    expect(resolve({ note: aiWritten("Write a note.") })).toMatchObject({
      ok: false,
      failure: { code: "graph_invalid" },
    });
  });

  it("fails a graph whose window cannot be read instead of guessing one", () => {
    expect(
      resolve(
        { note: fixed("x") },
        { lastTriggerAt: "2027-01-01T00:00:00.000Z" },
      ),
    ).toMatchObject({ ok: false, failure: { code: "engine_error" } });
  });
});
