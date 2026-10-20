import { describe, expect, it } from "vitest";

import { MAX_ITEM_CONTEXT_BYTES } from "../items.js";
import { buildGraph, parseNode } from "../story-graphs.fixture.js";
import { EVERY_5M, endWith } from "../testing/engine-fixtures.js";
import { contextPlanFor } from "./context-plan.js";
import type { FlowItem, TickContext } from "./types.js";
import {
  buildWake,
  contextOverflow,
  decodeContext,
  encodeContext,
  laterCheck,
} from "./wait-park.js";

const TICK_START = new Date("2026-10-19T12:00:00.000Z");
// The item reaches its Wait 40 seconds into the tick; every wake is still counted from the tick's start.
const PARKED_AT = new Date(TICK_START.getTime() + 40_000);
const ctx = {
  now: () => PARKED_AT,
  run: { startedAt: TICK_START.toISOString() },
  graph: {
    nodes: [
      {
        id: "post",
        name: "post",
        kind: "action",
        position: { x: 0, y: 0 },
        settings: { operation: "test.write", args: {} },
      },
    ],
    edges: [],
    settings: { checkCadenceMinutes: 20, modelCallCap: 50 },
  },
} as unknown as TickContext;

// A model after the Wait reads the whole item, so this plan keeps everything.
const keepsAll = contextPlanFor(
  buildGraph({
    nodes: [
      ["start", "trigger", EVERY_5M],
      ["post", "action", { operation: "test.write", args: {} }],
      ["pause", "wait", { wait: "reply" }],
      [
        "judge",
        "ai",
        {
          instruction: "Judge the reply.",
          mode: "perItem",
          result: { fine: { type: "boolean" } },
        },
      ],
      ["done", "end", endWith("done")],
    ],
    edges: [
      ["start", "out", "post"],
      ["post", "out", "pause"],
      ["pause", "replied", "judge"],
      ["pause", "timedOut", "done"],
      ["judge", "out", "done"],
    ],
  }),
  "pause",
);

const item: FlowItem = {
  id: "a",
  data: { title: "A", thread: { channelId: "C1", threadTs: "1.1" } },
  nodes: { post: { channel: "C9", ts: "9.9" } },
  inbox: true,
  members: ["m1"],
  cut: { taken: 1, totalAvailable: 9 },
};

describe("a parked context", () => {
  it("round-trips an item, its nodes, its members and its cut-off, with when the wait began", () => {
    const context = encodeContext(item, "2026-10-19T12:00:00.000Z", keepsAll);

    const decoded = decodeContext("a", JSON.parse(JSON.stringify(context)));

    expect(decoded).toEqual({
      ok: true,
      item,
      waitSince: "2026-10-19T12:00:00.000Z",
      kept: ["item", "nodes.post"],
    });
  });

  it("says how far over a context is that does not fit, and nothing for one that does", () => {
    expect(
      contextOverflow(
        encodeContext(item, "2026-10-19T12:00:00.000Z", keepsAll),
      ),
    ).toBeNull();
    const big = encodeContext(
      { ...item, data: { text: "x".repeat(MAX_ITEM_CONTEXT_BYTES) } },
      "2026-10-19T12:00:00.000Z",
      keepsAll,
    );

    expect(contextOverflow(big)).toMatchObject({
      maxBytes: MAX_ITEM_CONTEXT_BYTES,
      bytes: expect.any(Number),
    });
  });

  it.each([
    [
      "data is not an object",
      {
        data: [],
        nodes: {},
        inbox: true,
        waitSince: "2026-10-19T12:00:00.000Z",
      },
    ],
    [
      "nodes is not an object",
      {
        data: {},
        nodes: 1,
        inbox: true,
        waitSince: "2026-10-19T12:00:00.000Z",
      },
    ],
    [
      "inbox is not a boolean",
      {
        data: {},
        nodes: {},
        inbox: "yes",
        waitSince: "2026-10-19T12:00:00.000Z",
      },
    ],
    [
      "members is not a list of ids",
      {
        data: {},
        nodes: {},
        inbox: true,
        members: [1],
        waitSince: "2026-10-19T12:00:00.000Z",
      },
    ],
    [
      "the cut-off is not a pair of counts",
      {
        data: {},
        nodes: {},
        inbox: true,
        cut: { taken: "1" },
        waitSince: "2026-10-19T12:00:00.000Z",
      },
    ],
    [
      "kept is not a list of paths",
      {
        data: {},
        nodes: {},
        inbox: true,
        waitSince: "2026-10-19T12:00:00.000Z",
        kept: ["settings.timezone"],
      },
    ],
    ["the wait has no start", { data: {}, nodes: {}, inbox: true }],
    [
      "the wait start is not a date",
      { data: {}, nodes: {}, inbox: true, waitSince: "soon" },
    ],
  ])(
    "reports a context that cannot be read, never an empty item: %s",
    (_name, context) => {
      expect(decodeContext("a", context)).toMatchObject({
        ok: false,
        message: expect.stringContaining('"a" is unreadable'),
      });
    },
  );
});

describe("the wake an item is parked with", () => {
  it("is a deadline alone for a time wait, in whichever unit", () => {
    const node = parseNode("wait", {
      wait: "time",
      duration: { amount: 90, unit: "minutes" },
    });

    expect(buildWake(ctx, node as never, item)).toMatchObject({
      ok: true,
      wake: { wait: "time", dueAt: "2026-10-19T13:30:00.000Z" },
    });
  });

  it("checks a reply on the graph's cadence, a condition on its own, and leaves the check off when the deadline is sooner", () => {
    const reply = parseNode("wait", { wait: "reply", limitHours: 1 });
    const soon = parseNode("wait", { wait: "reply", limitHours: 0.1 });
    const condition = parseNode("wait", {
      wait: "condition",
      operation: "test.read",
      args: {},
      rule: { left: "item.x", op: "isTrue" },
      everyMinutes: 45,
      limitHours: 2,
    });

    expect(buildWake(ctx, reply as never, item)).toMatchObject({
      wake: { nextCheckAt: "2026-10-19T12:20:00.000Z" },
    });
    expect(buildWake(ctx, soon as never, item)).toMatchObject({
      ok: true,
      wake: { dueAt: "2026-10-19T12:06:00.000Z" },
    });
    expect(
      (buildWake(ctx, soon as never, item) as { wake: object }).wake,
    ).not.toHaveProperty("nextCheckAt");
    expect(buildWake(ctx, condition as never, item)).toMatchObject({
      wake: { nextCheckAt: "2026-10-19T12:45:00.000Z" },
    });
  });

  it("watches the item's own thread, and refuses a thread with nothing to find it by", () => {
    const reply = parseNode("wait", { wait: "reply" });

    expect(buildWake(ctx, reply as never, item)).toMatchObject({
      wake: { thread: { channelId: "C1", threadTs: "1.1" } },
    });
    expect(
      buildWake(ctx, reply as never, {
        ...item,
        data: { thread: { channelId: "C1" } },
      }),
    ).toMatchObject({ ok: false, failure: { code: "expression_failed" } });
  });

  it("reads a pull request or a ticket as a thread too, from an upstream result", () => {
    const watching = parseNode("wait", {
      wait: "reply",
      watch: { fromNode: "post" },
    });
    const upstream = (result: unknown) =>
      buildWake(ctx, watching as never, { ...item, nodes: { post: result } });

    expect(upstream({ thread: { repo: "a/b", number: 4 } })).toMatchObject({
      wake: { thread: { repo: "a/b", number: 4 } },
    });
    expect(upstream({ thread: { ticketId: "T-1" } })).toMatchObject({
      wake: { thread: { ticketId: "T-1" } },
    });
    expect(
      upstream({ channel: "C2", threadTs: "2.2", ts: "3.3" }),
    ).toMatchObject({
      wake: { thread: { channelId: "C2", threadTs: "2.2" } },
    });
    expect(upstream({ channel: "C2", ts: "3.3" })).toMatchObject({
      wake: { thread: { channelId: "C2", threadTs: "3.3" } },
    });
    expect(upstream({ channel: "C2", externalRef: "4.4" })).toMatchObject({
      wake: { thread: { channelId: "C2", threadTs: "4.4" } },
    });
    expect(upstream({ thread: {} })).toMatchObject({ ok: false });
    expect(upstream("not a result")).toMatchObject({ ok: false });
  });

  it("moves the check on from the tick's start, keeping the deadline, and drops it when the deadline is next", () => {
    const wake = {
      wait: "reply" as const,
      dueAt: "2026-10-19T12:30:00.000Z",
      nextCheckAt: "2026-10-19T12:00:00.000Z",
      thread: { channelId: "C1", threadTs: "1.1" },
    };
    const reply = parseNode("wait", { wait: "reply" });

    expect(laterCheck(ctx, reply as never, wake)).toEqual({
      ...wake,
      nextCheckAt: "2026-10-19T12:20:00.000Z",
    });
    const sooner = { ...wake, dueAt: "2026-10-19T12:10:00.000Z" };
    expect(laterCheck(ctx, reply as never, sooner)).toEqual({
      wait: "reply",
      dueAt: "2026-10-19T12:10:00.000Z",
      thread: wake.thread,
    });
  });
});
