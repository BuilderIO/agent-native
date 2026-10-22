import { describe, expect, it } from "vitest";

import {
  buildGraph,
  fixed,
  fromPath,
  aiWritten,
  rule,
  type EdgeSpec,
  type NodeSpec,
} from "../story-graphs.fixture.js";
import { EVERY_5M, endWith } from "../testing/engine-fixtures.js";
import {
  contextPlanFor,
  coverageGap,
  isKeptPaths,
  pruneItem,
} from "./context-plan.js";
import type { FlowItem } from "./types.js";

const trigger: NodeSpec = ["start", "trigger", EVERY_5M];
const lookup = (name: string, args: Record<string, unknown> = {}): NodeSpec => [
  name,
  "lookup",
  { operation: "test.read", args },
];
const action = (name: string, args: Record<string, unknown> = {}): NodeSpec => [
  name,
  "action",
  { operation: "test.write", args },
];
const gate = (name: string, left: string): NodeSpec => [
  name,
  "filter",
  { combinator: "all", rules: [rule(left, "isEmpty")] },
];
const pause: NodeSpec = [
  "pause",
  "wait",
  { wait: "time", duration: { amount: 1, unit: "hours" } },
];
const ai: NodeSpec = [
  "judge",
  "ai",
  {
    instruction: "Judge it.",
    mode: "perItem",
    result: { fine: { type: "boolean" } },
  },
];
const done: NodeSpec = ["done", "end", endWith("done")];

/** A straight line through `names`, every edge from `out`. */
const line = (...names: string[]): EdgeSpec[] =>
  names.slice(1).map((to, index): EdgeSpec => [names[index], "out", to]);

const planOf = (nodes: NodeSpec[], edges: EdgeSpec[], waitId = "pause") =>
  contextPlanFor(buildGraph({ nodes, edges }), waitId);

const flow = (over: Partial<FlowItem> = {}): FlowItem => ({
  id: "a",
  data: {},
  nodes: {},
  inbox: true,
  ...over,
});

describe("what an item keeps when it parks", () => {
  it("keeps nothing when no node after the Wait reads the item or a result", () => {
    const plan = planOf(
      [trigger, lookup("read"), pause, done],
      line("start", "read", "pause", "done"),
    );

    expect(plan.kept).toEqual([]);
    expect(
      pruneItem(
        flow({ data: { title: "A" }, nodes: { read: { n: 1 } } }),
        plan,
      ),
    ).toEqual({ data: {}, nodes: {} });
  });

  it("keeps the item fields and the paths of results that the nodes after it name, and nothing else", () => {
    const plan = planOf(
      [
        trigger,
        lookup("read"),
        pause,
        gate("emptyTitle", "item.title"),
        gate("deep", "nodes.read.reply.author"),
        done,
      ],
      line("start", "read", "pause", "emptyTitle", "deep", "done"),
    );

    expect(plan.kept).toEqual(["item.title", "nodes.read.reply.author"]);
    expect(
      pruneItem(
        flow({
          data: { title: "A", text: "x".repeat(5000) },
          nodes: {
            read: {
              reply: { author: "ana", text: "y".repeat(5000) },
              thread: ["z".repeat(5000)],
            },
            other: { big: "w".repeat(5000) },
          },
        }),
        plan,
      ),
    ).toEqual({
      data: { title: "A" },
      nodes: { read: { reply: { author: "ana" } } },
    });
  });

  it("reads holes in fixed text, and an End's reason, as paths too", () => {
    const plan = planOf(
      [
        trigger,
        lookup("read"),
        pause,
        action("tell", {
          text: fixed("{{ item.title }} / {{ nodes.read.summary }}"),
        }),
        ["done", "end", endWith("done", { reason: "{{ item.author }}" })],
      ],
      line("start", "read", "pause", "tell", "done"),
    );

    expect(plan.kept).toEqual([
      "item.author",
      "item.title",
      "nodes.read.summary",
    ]);
  });

  it("keeps a whole result when a node names the result, and folds a deeper path into it", () => {
    const plan = planOf(
      [
        trigger,
        lookup("read"),
        pause,
        action("tell", { all: fromPath("nodes.read") }),
        gate("deep", "nodes.read.a.b"),
        done,
      ],
      line("start", "read", "pause", "tell", "deep", "done"),
    );

    expect(plan.kept).toEqual(["nodes.read"]);
  });

  it("keeps one entry of a list when a path indexes it, in place, so the index still means the same entry", () => {
    const plan = planOf(
      [
        trigger,
        lookup("read"),
        pause,
        action("tell", { id: fromPath("nodes.read.data[2].id") }),
        done,
      ],
      line("start", "read", "pause", "tell", "done"),
    );

    expect(plan.kept).toEqual(["nodes.read.data[2].id"]);
    const { nodes } = pruneItem(
      flow({
        nodes: {
          read: {
            data: [
              { id: "m0", text: "x".repeat(3000) },
              { id: "m1", text: "x".repeat(3000) },
              { id: "m2", text: "x".repeat(3000) },
              { id: "m3", text: "x".repeat(3000) },
            ],
          },
        },
      }),
      plan,
    );
    expect(nodes).toEqual({ read: { data: [null, null, { id: "m2" }] } });
  });

  it("keeps everything a model after the Wait could be shown, because it reads the whole item", () => {
    const plan = planOf(
      [trigger, lookup("read"), action("ask"), pause, ai, done],
      line("start", "read", "ask", "pause", "judge", "done"),
    );

    expect(plan.kept).toEqual(["item", "nodes.ask", "nodes.read"]);
  });

  it("keeps everything for an argument a model writes, the same way", () => {
    const plan = planOf(
      [
        trigger,
        lookup("read"),
        pause,
        action("tell", { text: aiWritten("Say it kindly.") }),
        done,
      ],
      line("start", "read", "pause", "tell", "done"),
    );

    expect(plan.kept).toEqual(["item", "nodes.read"]);
  });

  describe("a result the way on rewrites before anything reads it", () => {
    it("is dropped even though a model reads the whole item: the loop head writes it again first", () => {
      // read -> judge (a model) -> ask -> pause, and a reply goes back to `read`.
      const plan = planOf(
        [trigger, lookup("read"), ai, action("ask"), pause, done],
        [
          ["start", "out", "read"],
          ["read", "out", "judge"],
          ["judge", "out", "ask"],
          ["ask", "out", "pause"],
          ["pause", "replied", "read", 2],
          ["pause", "timedOut", "done"],
          ["pause", "limitReached", "done"],
        ],
      );

      // The model is only reached through `read`, so what `read` left is never seen.
      // What the model wrote last time, and what `ask` left, it does see.
      expect(plan.kept).toEqual(["item", "nodes.ask", "nodes.judge"]);
      expect(plan.nodes.has("read")).toBe(false);
    });

    it("is dropped when the only node that names it is reached through the node that writes it", () => {
      const plan = planOf(
        [trigger, lookup("read"), gate("check", "nodes.read.n"), pause, done],
        [
          ["start", "out", "read"],
          ["read", "out", "pause"],
          ["pause", "replied", "read", 2],
          ["pause", "timedOut", "done"],
          ["pause", "limitReached", "done"],
          ["read", "out", "check"],
          ["check", "out", "done"],
        ],
      );

      expect(plan.kept).toEqual([]);
    });

    it("is kept when some way on reaches a reader without passing the node that writes it", () => {
      const plan = planOf(
        [trigger, lookup("read"), pause, ai, done],
        [
          ["start", "out", "read"],
          ["read", "out", "pause"],
          ["pause", "replied", "judge"],
          ["pause", "timedOut", "done"],
          ["judge", "out", "done"],
        ],
      );

      expect(plan.kept).toEqual(["item", "nodes.read"]);
    });
  });

  it("does not plan for a result only a node after the Wait writes, since no item can carry one yet", () => {
    const plan = planOf(
      [trigger, pause, lookup("later"), gate("check", "nodes.later.n"), done],
      line("start", "pause", "later", "check", "done"),
    );

    expect(plan.nodes.has("later")).toBe(false);
    expect(plan.kept).toEqual([]);
  });

  it("includes the nodes a back edge returns to, and the loop body, in what is read", () => {
    const plan = planOf(
      [trigger, lookup("read"), gate("check", "nodes.read.n"), pause, done],
      [
        ["start", "out", "read"],
        ["read", "out", "check"],
        ["check", "out", "pause"],
        ["pause", "replied", "check", 3],
        ["pause", "timedOut", "done"],
        ["pause", "limitReached", "done"],
      ],
    );

    // The reply returns to `check`, which reads `nodes.read.n` from the parked item.
    expect(plan.kept).toEqual(["nodes.read.n"]);
  });

  it("keeps what a condition Wait reads from its parked item every time it checks", () => {
    const plan = planOf(
      [
        trigger,
        lookup("read"),
        [
          "pause",
          "wait",
          {
            wait: "condition",
            operation: "test.read",
            args: { id: { mode: "path", path: "nodes.read.id" } },
            rule: { left: "item.state", op: "isTrue" },
            everyMinutes: 15,
            limitHours: 24,
          },
        ],
        done,
      ],
      line("start", "read", "pause", "done"),
    );

    expect(plan.kept).toEqual(["item.state", "nodes.read.id"]);
  });

  it("keeps the item's thread for a reply Wait after this one, and the watched result when it names one", () => {
    const plain = planOf(
      [
        trigger,
        pause,
        ["again", "wait", { wait: "reply", limitHours: 1 }],
        done,
      ],
      [
        ["start", "out", "pause"],
        ["pause", "done", "again"],
        ["again", "replied", "done"],
        ["again", "timedOut", "done"],
      ],
    );
    expect(plain.kept).toEqual(["item.thread"]);

    const watching = planOf(
      [
        trigger,
        action("post"),
        pause,
        [
          "again",
          "wait",
          { wait: "reply", limitHours: 1, watch: { fromNode: "post" } },
        ],
        done,
      ],
      [
        ["start", "out", "post"],
        ["post", "out", "pause"],
        ["pause", "done", "again"],
        ["again", "replied", "done"],
        ["again", "timedOut", "done"],
      ],
    );
    expect(watching.kept).toEqual(["nodes.post"]);
  });

  it("does not keep the thread for the Wait the item is parking at: that one reads it before it parks", () => {
    const plan = planOf(
      [trigger, ["pause", "wait", { wait: "reply", limitHours: 1 }], done],
      [
        ["start", "out", "pause"],
        ["pause", "replied", "done"],
        ["pause", "timedOut", "done"],
      ],
    );

    expect(plan.kept).toEqual([]);
  });

  it("keeps the fields a list or a group of items is built from, because it reads them without a path", () => {
    const list = planOf(
      [trigger, pause, ["all", "combine", { mode: "list" }], done],
      line("start", "pause", "all", "done"),
    );
    expect(list.kept).toEqual([
      "item.author",
      "item.extras",
      "item.kind",
      "item.occurredAt",
      "item.provider",
      "item.thread",
      "item.title",
      "item.url",
    ]);

    const field = planOf(
      [
        trigger,
        pause,
        ["all", "combine", { mode: "list", field: "item.title" }],
        done,
      ],
      line("start", "pause", "all", "done"),
    );
    expect(field.kept).toEqual(["item.title"]);
  });

  it("keeps the two fields of an earlier Wait's result that decide where the next reply search starts", () => {
    const plan = planOf(
      [
        trigger,
        ["first", "wait", { wait: "reply", limitHours: 1 }],
        ["second", "wait", { wait: "reply", limitHours: 1 }],
        done,
      ],
      [
        ["start", "out", "first"],
        ["first", "replied", "second"],
        ["first", "timedOut", "done"],
        ["second", "replied", "done"],
        ["second", "timedOut", "done"],
      ],
      "second",
    );

    expect(plan.kept).toEqual([
      "nodes.first.lastReplyAt",
      "nodes.first.outcome",
    ]);
  });

  it("works a plan out once for each Wait of a loaded graph", () => {
    const graph = buildGraph({
      nodes: [trigger, pause, done],
      edges: line("start", "pause", "done"),
    });

    expect(contextPlanFor(graph, "pause")).toBe(contextPlanFor(graph, "pause"));
  });
});

describe("cutting an item down to its plan", () => {
  const plan = planOf(
    [
      trigger,
      lookup("read"),
      pause,
      gate("check", "nodes.read.a.b"),
      gate("title", "item.title"),
      action("tell", { whole: fromPath("nodes.read.list") }),
      done,
    ],
    line("start", "read", "pause", "check", "title", "tell", "done"),
  );

  it("leaves out what is not there instead of inventing it", () => {
    expect(pruneItem(flow({ data: {}, nodes: {} }), plan)).toEqual({
      data: {},
      nodes: {},
    });
  });

  it("keeps a stored null, an empty list, and a falsy value whole where a path names them", () => {
    expect(
      pruneItem(
        flow({
          data: { title: "" },
          nodes: { read: { list: [], a: { b: null } } },
        }),
        plan,
      ),
    ).toEqual({
      data: { title: "" },
      nodes: { read: { list: [], a: { b: null } } },
    });
  });

  it("drops a value whose shape cannot have the path below it, since the path would find nothing there either way", () => {
    expect(
      pruneItem(flow({ nodes: { read: { a: "text", list: [1] } } }), plan),
    ).toEqual({ data: {}, nodes: { read: { list: [1] } } });
  });

  it("does not alter the item it is given", () => {
    const item = flow({
      data: { title: "A", text: "x" },
      nodes: { read: { a: { b: 1, c: 2 }, list: [1] } },
    });
    const before = JSON.stringify(item);

    pruneItem(item, plan);

    expect(JSON.stringify(item)).toBe(before);
  });
});

describe("what a changed graph needs from an item that is already waiting", () => {
  const plan = planOf(
    [trigger, lookup("read"), pause, gate("check", "nodes.read.a"), done],
    line("start", "read", "pause", "check", "done"),
  );

  it("is nothing when the item kept every path the graph reads now", () => {
    expect(
      coverageGap(
        buildGraph({
          nodes: [
            trigger,
            lookup("read"),
            pause,
            gate("check", "nodes.read.a"),
            done,
          ],
          edges: line("start", "read", "pause", "check", "done"),
        }),
        "pause",
        plan.kept,
      ),
    ).toBeNull();
  });

  it("names the first path the graph reads now that the item did not keep", () => {
    const edited = buildGraph({
      nodes: [
        trigger,
        lookup("read"),
        pause,
        gate("check", "nodes.read.a"),
        gate("title", "item.title"),
        done,
      ],
      edges: line("start", "read", "pause", "check", "title", "done"),
    });

    expect(coverageGap(edited, "pause", plan.kept)).toBe("item.title");
    expect(coverageGap(edited, "pause", [])).toBe("item.title");
  });

  it("counts a kept ancestor as keeping everything under it, and a kept descendant as not", () => {
    const deeper = buildGraph({
      nodes: [
        trigger,
        lookup("read"),
        pause,
        gate("check", "nodes.read.a.b"),
        done,
      ],
      edges: line("start", "read", "pause", "check", "done"),
    });
    const whole = buildGraph({
      nodes: [
        trigger,
        lookup("read"),
        pause,
        gate("check", "nodes.read"),
        done,
      ],
      edges: line("start", "read", "pause", "check", "done"),
    });

    expect(coverageGap(deeper, "pause", ["nodes.read.a"])).toBeNull();
    expect(coverageGap(whole, "pause", ["nodes.read.a"])).toBe("nodes.read");
    expect(coverageGap(whole, "pause", ["nodes.read"])).toBeNull();
    expect(coverageGap(whole, "pause", ["item"])).toBe("nodes.read");
  });
});

describe("the list of kept paths in a parked context", () => {
  it("accepts what a plan writes and nothing else", () => {
    expect(isKeptPaths([])).toBe(true);
    expect(
      isKeptPaths(["item", "item.thread.channelId", "nodes.read.data[2].id"]),
    ).toBe(true);
    expect(isKeptPaths("item")).toBe(false);
    expect(isKeptPaths([1])).toBe(false);
    expect(isKeptPaths(["settings.timezone"])).toBe(false);
    expect(isKeptPaths(["nodes"])).toBe(false);
    expect(isKeptPaths(["nodes[0]"])).toBe(false);
    expect(isKeptPaths(["item..x"])).toBe(false);
  });
});
