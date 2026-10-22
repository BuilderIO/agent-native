import { describe, expect, it } from "vitest";

import type { FieldBinding } from "../contract.js";
import { operationDefinitionSchema } from "../operations.js";
import { buildScope, checkFieldValue, resolveBindings } from "./bindings.js";
import type { FlowItem } from "./types.js";

const def = operationDefinitionSchema.parse({
  id: "test.typed",
  provider: "test",
  label: "Typed",
  nodeKinds: ["action"],
  effect: "write",
  fields: [
    { name: "text", type: "text", required: true },
    { name: "count", type: "number" },
    { name: "flag", type: "boolean" },
    { name: "level", type: "enum", enum: ["low", "high"] },
    { name: "extra", type: "json" },
    { name: "note", type: "text", default: "fallback" },
  ],
  implementation: { type: "action", action: "test-typed" },
  receipt: { externalRef: "id" },
  credential: { provider: "test" },
});

const item: FlowItem = {
  id: "item-1",
  data: {
    title: "Crash",
    id: "stale",
    extras: { n: 4 },
    thread: { channelId: "C1" },
  },
  nodes: { assess: { risk: "low", score: 0.5 } },
  inbox: true,
};

const context = {
  graph: {
    nodes: [],
    edges: [],
    settings: {
      checkCadenceMinutes: 15,
      modelCallCap: 50,
      triageOwnerEmail: "owner@example.test",
      extras: { repo: "acme/app" },
    },
  },
  run: { id: "run-1", startedAt: "2026-10-19T12:00:00.000Z" },
  mode: "live",
  window: {
    start: "2026-10-19T11:55:00.000Z",
    end: "2026-10-19T12:00:00.000Z",
    firstRun: false,
  },
  scheduledFor: null,
} as const;

const scope = buildScope(context as never, item, { attempts: 2 });

const fixed = (value: unknown): FieldBinding => ({ mode: "fixed", value });
const path = (value: string): FieldBinding => ({ mode: "path", path: value });

describe("buildScope", () => {
  it("reads the item, its attached nodes, the settings and the run", () => {
    expect(scope.item).toMatchObject({ title: "Crash", extras: { n: 4 } });
    expect(scope.nodes).toEqual({ assess: { risk: "low", score: 0.5 } });
    expect(scope.settings).toMatchObject({ extras: { repo: "acme/app" } });
    expect(scope.run).toMatchObject({
      id: "run-1",
      windowStart: "2026-10-19T11:55:00.000Z",
      windowEnd: "2026-10-19T12:00:00.000Z",
      scheduledFor: null,
    });
  });

  it("lets the engine's own id and counters win over a field of the same name", () => {
    expect(scope.item).toMatchObject({ id: "item-1", attempts: 2, nudges: 0 });
  });

  it("has no item for a source, which runs before any exists", () => {
    expect(buildScope(context as never, undefined).item).toBeUndefined();
  });

  it("gives the nodes of a loop its pass count and limit, and every other node nothing to read", () => {
    const withLoop = {
      ...context,
      loops: [
        {
          edgeId: "e4",
          head: "ask",
          tail: "pause",
          max: 3,
          body: new Set(["ask", "pause"]),
        },
      ],
    };

    expect(
      buildScope(withLoop as never, item, { "loop:e4": 2 }, "ask").loop,
    ).toEqual({ iteration: 2, max: 3 });
    // The first pass has no counter yet: it is pass zero, not a missing value.
    expect(buildScope(withLoop as never, item, {}, "pause").loop).toEqual({
      iteration: 0,
      max: 3,
    });
    expect(buildScope(withLoop as never, item, {}, "elsewhere").loop).toEqual(
      {},
    );
    expect(buildScope(withLoop as never, item, {}).loop).toEqual({});
  });
});

describe("resolveBindings", () => {
  it("fills fixed text, paths, and defaults", () => {
    const resolved = resolveBindings(
      {
        text: fixed("Crash {{ item.title }} is {{ nodes.assess.risk }}"),
        count: path("item.extras.n"),
        level: fixed("high"),
      },
      def,
      scope,
    );
    expect(resolved).toEqual({
      ok: true,
      fields: {
        text: "Crash Crash is low",
        count: 4,
        level: "high",
        note: "fallback",
      },
      aiBindings: [],
    });
  });

  it("resolves holes inside a json value and keeps a whole hole's type", () => {
    const resolved = resolveBindings(
      {
        text: fixed("x"),
        extra: fixed({
          channel: "{{ item.thread.channelId }}",
          n: "{{ item.extras.n }}",
        }),
      },
      def,
      scope,
    );
    expect(resolved).toMatchObject({
      ok: true,
      fields: { extra: { channel: "C1", n: 4 } },
    });
  });

  it("fails an item whose path has no value, naming the field", () => {
    const resolved = resolveBindings({ text: path("item.nope") }, def, scope);
    expect(resolved).toEqual({
      ok: false,
      failure: {
        code: "expression_failed",
        message: 'args.text: "item.nope" has no value here.',
      },
    });
  });

  it("fails an item whose template hole has no value", () => {
    const resolved = resolveBindings(
      { text: fixed("hello {{ item.missing }}") },
      def,
      scope,
    );
    expect(resolved).toMatchObject({
      ok: false,
      failure: { code: "expression_failed" },
    });
  });

  it("fails a value of the wrong type before it reaches the provider", () => {
    const resolved = resolveBindings(
      { text: fixed("x"), count: path("item.title") },
      def,
      scope,
    );
    expect(resolved).toMatchObject({
      ok: false,
      failure: {
        code: "expression_failed",
        message: expect.stringContaining("expected a number"),
      },
    });
  });

  it("fails an enum value outside the declared list", () => {
    const resolved = resolveBindings(
      { text: fixed("x"), level: path("item.title") },
      def,
      scope,
    );
    expect(resolved).toMatchObject({
      ok: false,
      failure: {
        message: expect.stringContaining("expected one of low, high"),
      },
    });
  });

  it("hands AI-written bindings back instead of resolving them", () => {
    const resolved = resolveBindings(
      { text: { mode: "ai", instruction: "Write it." } },
      def,
      scope,
    );
    expect(resolved).toMatchObject({
      ok: true,
      aiBindings: [{ name: "text", instruction: "Write it." }],
    });
    expect(resolved.ok && "text" in resolved.fields).toBe(false);
  });

  it("refuses an AI-written json field, which has no answer shape", () => {
    const resolved = resolveBindings(
      { text: fixed("x"), extra: { mode: "ai", instruction: "Write it." } },
      def,
      scope,
    );
    expect(resolved).toMatchObject({
      ok: false,
      failure: { code: "graph_invalid" },
    });
  });

  it("refuses a field the operation does not have", () => {
    const resolved = resolveBindings({ nope: fixed("x") }, def, scope);
    expect(resolved).toMatchObject({
      ok: false,
      failure: { code: "graph_invalid" },
    });
  });
});

describe("checkFieldValue", () => {
  const field = (type: string, extra: object = {}) =>
    ({ name: "f", type, ...extra }) as never;

  it("accepts a value of the declared type and names the mismatch otherwise", () => {
    expect(checkFieldValue(field("string"), "x")).toBeNull();
    expect(checkFieldValue(field("string"), 3)).toMatch(/text/);
    expect(checkFieldValue(field("number"), Number.NaN)).toMatch(/number/);
    expect(checkFieldValue(field("boolean"), "true")).toMatch(/true or false/);
    expect(checkFieldValue(field("json"), undefined)).toMatch(/value/);
    expect(checkFieldValue(field("json"), null)).toBeNull();
  });
});
