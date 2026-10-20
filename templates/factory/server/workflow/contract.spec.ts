import { describe, expect, it } from "vitest";

import {
  END_OUTCOMES,
  WORKFLOW_ERROR_CODES,
  WorkflowError,
  fieldBindingSchema,
  itemEventSchema,
  itemStateSchema,
  loopCounterKey,
  nodeScopeKey,
  receiptKey,
  receiptSchema,
  stepRecordSchema,
  workflowEdgeSchema,
  workflowGraphSchema,
  workflowNodeSchema,
  workflowSettingsSchema,
} from "./contract.js";
import {
  buildGraph,
  candidateNode,
  parseNode,
  rule,
  type NodeSpec,
} from "./story-graphs.fixture.js";

const accepts = (
  kind: Parameters<typeof candidateNode>[0],
  settings: unknown,
) => workflowNodeSchema.safeParse(candidateNode(kind, settings)).success;

const everyFiveMinutes = { schedule: { every: "5m" } };
const equalsRule = rule("item.kind", "equals", "x");

describe("workflow error", () => {
  it("carries a typed code and details on WorkflowError", () => {
    const error = new WorkflowError("output_over_cap", "too big", { bytes: 9 });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("WorkflowError");
    expect(error.code).toBe("output_over_cap");
    expect(error.details).toEqual({ bytes: 9 });
  });
});

describe("node envelope", () => {
  it("rejects a node kind outside the twelve", () => {
    expect(accepts("webhook" as never, {})).toBe(false);
  });

  it("requires a name that can be written in a path", () => {
    const named = (name: string) =>
      workflowNodeSchema.safeParse(
        candidateNode("end", { outcome: "done" }, name),
      ).success;
    expect(named("assess")).toBe(true);
    expect(named("assess_2")).toBe(true);
    expect(named("two words")).toBe(false);
    expect(named("2fast")).toBe(false);
    expect(named("a.b")).toBe(false);
    expect(named("constructor")).toBe(false);
    expect(named("__proto__")).toBe(false);
  });

  it("rejects unknown keys instead of dropping them", () => {
    expect(
      workflowNodeSchema.safeParse({
        ...candidateNode("end", { outcome: "done" }),
        label: "typo",
      }).success,
    ).toBe(false);
    expect(accepts("end", { outcome: "done", reasno: "typo" })).toBe(false);
  });

  it("reads a node under its name, or under into for a lookup", () => {
    const plain = parseNode("lookup", {
      operation: "slack.readThread",
      args: {},
    });
    const renamed = parseNode("lookup", {
      operation: "slack.readThread",
      args: {},
      into: "thread",
    });
    expect(nodeScopeKey(plain)).toBe("n1");
    expect(nodeScopeKey(renamed)).toBe("thread");
  });
});

describe("trigger settings", () => {
  it.each([
    [{ every: "5m" }],
    [{ every: "60m" }],
    [{ daily: { at: "08:30" } }],
    [{ weekdays: { at: "00:00" } }],
    [{ weekly: { day: 0, at: "23:59" } }],
  ])("accepts %j", (schedule) => {
    expect(accepts("trigger", { schedule })).toBe(true);
  });

  it.each([
    ["an unsupported interval", { every: "7m" }],
    ["two forms at once", { every: "5m", daily: { at: "08:00" } }],
    ["24:00", { daily: { at: "24:00" } }],
    ["a time without a leading zero", { daily: { at: "8:00" } }],
    ["a weekday number of 7", { weekly: { day: 7, at: "08:00" } }],
    ["no schedule form", {}],
  ])("rejects %s", (_name, schedule) => {
    expect(accepts("trigger", { schedule })).toBe(false);
  });

  it("checks the time zone against the real zone list", () => {
    expect(
      accepts("trigger", { ...everyFiveMinutes, timezone: "Europe/Paris" }),
    ).toBe(true);
    expect(
      accepts("trigger", { ...everyFiveMinutes, timezone: "Mars/Olympus" }),
    ).toBe(false);
  });
});

describe("source settings", () => {
  const poll = { source: "inbox-poll", poller: "slack", takeLimit: 5 };
  const query = {
    source: "provider-query",
    operation: "hubspot.newLeads",
    args: {},
    memory: "inbox",
    maxItems: 50,
  };

  it("accepts each of the four source shapes", () => {
    expect(accepts("source", poll)).toBe(true);
    expect(accepts("source", query)).toBe(true);
    expect(
      accepts("source", {
        source: "window",
        operation: "github.listCommits",
        args: {},
        maxItems: 100,
      }),
    ).toBe(true);
    expect(
      accepts("source", {
        source: "status",
        status: "automation_started",
        takeLimit: 50,
      }),
    ).toBe(true);
  });

  it("holds the inbox poller to 1 through 10 and the others to their caps", () => {
    expect(accepts("source", { ...poll, takeLimit: 0 })).toBe(false);
    expect(accepts("source", { ...poll, takeLimit: 11 })).toBe(false);
    expect(accepts("source", { ...poll, poller: "zendesk" })).toBe(false);
    expect(accepts("source", { ...query, maxItems: 101 })).toBe(false);
    expect(accepts("source", { ...query, maxItems: 0 })).toBe(false);
    expect(
      accepts("source", { source: "status", status: "x", takeLimit: 51 }),
    ).toBe(false);
  });

  it("defaults a provider query to 50 items", () => {
    const { maxItems: _omitted, ...withoutMax } = query;
    const node = parseNode("source", withoutMax);
    expect(node.kind === "source" && node.settings.source).toBe(
      "provider-query",
    );
    expect(
      node.kind === "source" &&
        node.settings.source === "provider-query" &&
        node.settings.maxItems,
    ).toBe(50);
  });

  it("requires an operation id shaped provider.name", () => {
    expect(accepts("source", { ...query, operation: "newLeads" })).toBe(false);
    expect(accepts("source", { ...query, operation: "HubSpot.newLeads" })).toBe(
      false,
    );
  });
});

describe("field bindings", () => {
  it("accepts fixed, path and ai", () => {
    expect(
      fieldBindingSchema.safeParse({
        mode: "fixed",
        value: "Hello {{ item.title }}",
      }).success,
    ).toBe(true);
    expect(
      fieldBindingSchema.safeParse({ mode: "fixed", value: null }).success,
    ).toBe(true);
    expect(
      fieldBindingSchema.safeParse({ mode: "path", path: "item.title" })
        .success,
    ).toBe(true);
    expect(
      fieldBindingSchema.safeParse({
        mode: "ai",
        instruction: "Write one line.",
      }).success,
    ).toBe(true);
  });

  it("rejects a fixed binding with no value, an empty instruction, or another mode", () => {
    expect(fieldBindingSchema.safeParse({ mode: "fixed" }).success).toBe(false);
    expect(
      fieldBindingSchema.safeParse({ mode: "ai", instruction: "" }).success,
    ).toBe(false);
    expect(
      fieldBindingSchema.safeParse({ mode: "code", source: "1+1" }).success,
    ).toBe(false);
  });

  it("rejects argument names that could reach the prototype", () => {
    expect(
      accepts("action", {
        operation: "slack.postMessage",
        args: { constructor: { mode: "fixed", value: 1 } },
      }),
    ).toBe(false);
  });
});

describe("rules", () => {
  const filter = (rules: unknown[]) =>
    accepts("filter", { combinator: "all", rules });

  it("requires an operand for comparisons and forbids one for the rest", () => {
    expect(filter([equalsRule])).toBe(true);
    expect(filter([rule("item.kind", "equals")])).toBe(false);
    expect(filter([rule("item.done", "isTrue")])).toBe(true);
    expect(filter([rule("item.done", "isTrue", true)])).toBe(false);
    expect(filter([rule("item.due", "pastDue")])).toBe(true);
    expect(
      filter([rule("item.due", "olderThan", "{{ settings.extras.age }}")]),
    ).toBe(true);
  });

  it("allows null, false and 0 as operands", () => {
    expect(filter([rule("item.a", "equals", null)])).toBe(true);
    expect(filter([rule("item.a", "equals", false)])).toBe(true);
    expect(filter([rule("item.a", "gt", 0)])).toBe(true);
  });

  it("rejects an unknown operator and an empty rule list", () => {
    expect(filter([rule("item.a", "matchesRegex", "x")])).toBe(false);
    expect(filter([])).toBe(false);
  });

  it("needs at least one route on a switch", () => {
    expect(accepts("switch", { routes: [] })).toBe(false);
    expect(
      accepts("switch", {
        routes: [
          { id: "a", label: "A", combinator: "any", rules: [equalsRule] },
        ],
      }),
    ).toBe(true);
  });
});

describe("combine and split", () => {
  it("requires what each mode needs and nothing it does not", () => {
    expect(accepts("combine", { mode: "list" })).toBe(true);
    expect(accepts("combine", { mode: "list", field: "item.title" })).toBe(
      true,
    );
    expect(accepts("combine", { mode: "count" })).toBe(true);
    expect(accepts("combine", { mode: "groupBy" })).toBe(false);
    expect(accepts("combine", { mode: "groupBy", key: "item.task" })).toBe(
      true,
    );
    expect(accepts("combine", { mode: "count", key: "item.task" })).toBe(false);
    expect(accepts("combine", { mode: "count", field: "item.task" })).toBe(
      false,
    );
    expect(accepts("combine", { mode: "summarize" })).toBe(false);
  });

  it("checks the summarize block, including that a comparison has a baseline", () => {
    const summarize = { group: "item.service", value: "item.cost", agg: "sum" };
    expect(accepts("combine", { mode: "summarize", summarize })).toBe(true);
    expect(
      accepts("combine", {
        mode: "summarize",
        summarize: {
          ...summarize,
          baseline: { window: 7, bucket: "day" },
          compare: "latestVsAverage",
        },
      }),
    ).toBe(true);
    expect(
      accepts("combine", {
        mode: "summarize",
        summarize: { ...summarize, compare: "latestVsAverage" },
      }),
    ).toBe(false);
    expect(
      accepts("combine", {
        mode: "summarize",
        summarize: { ...summarize, agg: "median" },
      }),
    ).toBe(false);
  });

  it("splits on one field", () => {
    expect(accepts("split", { field: "nodes.extract.actionItems" })).toBe(true);
    expect(accepts("split", {})).toBe(false);
  });
});

describe("ai settings", () => {
  const ai = {
    instruction: "Judge it.",
    mode: "perItem",
    result: { clear: { type: "boolean" } },
  };

  it("defaults tools to none and batch size to 10", () => {
    const node = parseNode("ai", ai);
    expect(node.kind === "ai" && node.settings.tools).toEqual([]);
    expect(node.kind === "ai" && node.settings.batchSize).toBe(10);
  });

  it("requires declared result fields with usable names", () => {
    expect(accepts("ai", { ...ai, result: {} })).toBe(false);
    expect(
      accepts("ai", { ...ai, result: { "two words": { type: "string" } } }),
    ).toBe(false);
    expect(
      accepts("ai", { ...ai, result: { constructor: { type: "string" } } }),
    ).toBe(false);
    expect(accepts("ai", { ...ai, mode: "batch" })).toBe(false);
  });

  it("makes an enum field list its values and nothing else do", () => {
    const field = (value: unknown) =>
      accepts("ai", { ...ai, result: { risk: value } });
    expect(field({ type: "enum", enum: ["low", "high"] })).toBe(true);
    expect(field({ type: "enum" })).toBe(false);
    expect(field({ type: "enum", enum: ["low", "low"] })).toBe(false);
    expect(field({ type: "string", enum: ["a"] })).toBe(false);
    expect(field({ type: "array", optional: true, description: "x" })).toBe(
      true,
    );
    expect(field({ type: "object" })).toBe(false);
  });
});

describe("agent settings", () => {
  it("names the agent and one of its three operations", () => {
    for (const op of ["start", "check", "followUp"]) {
      expect(accepts("agent", { agent: "builder", op, args: {} })).toBe(true);
    }
    expect(accepts("agent", { agent: "builder", op: "cancel", args: {} })).toBe(
      false,
    );
    expect(accepts("agent", { agent: "other", op: "start", args: {} })).toBe(
      false,
    );
  });
});

describe("wait settings", () => {
  it("defaults a reply wait to 24 hours from anyone", () => {
    const node = parseNode("wait", { wait: "reply" });
    expect(node.kind === "wait" && node.settings).toEqual({
      wait: "reply",
      limitHours: 24,
      acceptFrom: "anyone",
    });
  });

  it("accepts owner, a list of emails, a watched node and a reaction", () => {
    expect(accepts("wait", { wait: "reply", acceptFrom: "owner" })).toBe(true);
    expect(
      accepts("wait", {
        wait: "reply",
        acceptFrom: { emails: ["a@example.test"] },
        watch: { fromNode: "ask" },
        ackReaction: "white_check_mark",
      }),
    ).toBe(true);
    expect(accepts("wait", { wait: "reply", acceptFrom: { emails: [] } })).toBe(
      false,
    );
    expect(
      accepts("wait", { wait: "reply", acceptFrom: { emails: ["nope"] } }),
    ).toBe(false);
    expect(accepts("wait", { wait: "reply", acceptFrom: "nobody" })).toBe(
      false,
    );
  });

  it("allows a quarter of an hour but not zero or more than 30 days", () => {
    expect(accepts("wait", { wait: "reply", limitHours: 0.25 })).toBe(true);
    expect(accepts("wait", { wait: "reply", limitHours: 0 })).toBe(false);
    expect(accepts("wait", { wait: "reply", limitHours: 720 })).toBe(true);
    expect(accepts("wait", { wait: "reply", limitHours: 721 })).toBe(false);
  });

  it("caps a time wait at 30 days in whichever unit it is written", () => {
    const time = (amount: number, unit: string) =>
      accepts("wait", { wait: "time", duration: { amount, unit } });
    expect(time(3, "days")).toBe(true);
    expect(time(30, "days")).toBe(true);
    expect(time(31, "days")).toBe(false);
    expect(time(720, "hours")).toBe(true);
    expect(time(721, "hours")).toBe(false);
    expect(time(43_200, "minutes")).toBe(true);
    expect(time(43_201, "minutes")).toBe(false);
    expect(time(0, "minutes")).toBe(false);
    expect(time(1, "weeks")).toBe(false);
  });

  it("makes a condition wait carry an operation, a rule and its cadence", () => {
    const condition = {
      wait: "condition",
      operation: "sentry.issueStatus",
      args: {},
      rule: rule("item.status", "equals", "resolved"),
    };
    const node = parseNode("wait", condition);
    expect(node.kind === "wait" && node.settings).toMatchObject({
      everyMinutes: 15,
      limitHours: 24,
    });
    expect(accepts("wait", { ...condition, everyMinutes: 4 })).toBe(false);
    const { rule: _rule, ...withoutRule } = condition;
    expect(accepts("wait", withoutRule)).toBe(false);
  });
});

describe("end settings", () => {
  it("requires a reason when dismissing and allows setStatus anywhere", () => {
    expect(accepts("end", { outcome: "dismissed" })).toBe(false);
    expect(accepts("end", { outcome: "dismissed", reason: "activated" })).toBe(
      true,
    );
    expect(accepts("end", { outcome: "needsManual" })).toBe(true);
    expect(accepts("end", { outcome: "released" })).toBe(true);
    expect(accepts("end", { outcome: "done", setStatus: "merged" })).toBe(true);
    expect(accepts("end", { outcome: "needs_manual" })).toBe(false);
  });
});

describe("edges", () => {
  const edge = (back?: unknown) => ({
    id: "e1",
    from: { node: "a", port: "out" },
    to: { node: "b" },
    ...(back === undefined ? {} : { back }),
  });

  it("defaults a back-edge to 3 passes and bounds it to 1 through 25", () => {
    const parsed = workflowEdgeSchema.parse(edge({}));
    expect(parsed.back).toEqual({ maxIterations: 3 });
    expect(
      workflowEdgeSchema.safeParse(edge({ maxIterations: 25 })).success,
    ).toBe(true);
    expect(
      workflowEdgeSchema.safeParse(edge({ maxIterations: 26 })).success,
    ).toBe(false);
    expect(
      workflowEdgeSchema.safeParse(edge({ maxIterations: 0 })).success,
    ).toBe(false);
  });

  it("leaves an ordinary edge without a back flag", () => {
    expect(workflowEdgeSchema.parse(edge()).back).toBeUndefined();
  });
});

describe("graph and graph settings", () => {
  const end: NodeSpec = ["done", "end", { outcome: "done" }];

  it("defaults the check cadence to 15 minutes and the model cap to 50", () => {
    const settings = workflowSettingsSchema.parse({});
    expect(settings.checkCadenceMinutes).toBe(15);
    expect(settings.modelCallCap).toBe(50);
  });

  it("bounds the cadence at 5 minutes and rejects stray settings", () => {
    expect(
      workflowSettingsSchema.safeParse({ checkCadenceMinutes: 4 }).success,
    ).toBe(false);
    expect(
      workflowSettingsSchema.safeParse({ checkCadenceMinutes: 5 }).success,
    ).toBe(true);
    expect(workflowSettingsSchema.safeParse({ modelCap: 5 }).success).toBe(
      false,
    );
    expect(
      workflowSettingsSchema.safeParse({ triageOwnerEmail: "not an email" })
        .success,
    ).toBe(false);
  });

  it("keeps the lookback and the Builder stuck window optional, whole minutes, and inside their bounds", () => {
    expect(workflowSettingsSchema.parse({})).not.toHaveProperty(
      "lookbackMinutes",
    );
    expect(workflowSettingsSchema.parse({})).not.toHaveProperty(
      "builderStuckAfterMinutes",
    );
    const parses = (settings: Record<string, unknown>) =>
      workflowSettingsSchema.safeParse(settings).success;
    for (const lookbackMinutes of [5, 90, 43_200]) {
      expect(parses({ lookbackMinutes })).toBe(true);
    }
    for (const lookbackMinutes of [4, 43_201, 90.5, 0, -5, "soon", null]) {
      expect(parses({ lookbackMinutes })).toBe(false);
    }
    for (const builderStuckAfterMinutes of [5, 30, 1440]) {
      expect(parses({ builderStuckAfterMinutes })).toBe(true);
    }
    for (const builderStuckAfterMinutes of [4, 1441, 30.5, "soon", null]) {
      expect(parses({ builderStuckAfterMinutes })).toBe(false);
    }
  });

  it("keeps free-form extras but bounds their size", () => {
    expect(
      workflowSettingsSchema.safeParse({ extras: { channel: "C1", limit: 3 } })
        .success,
    ).toBe(true);
    expect(
      workflowSettingsSchema.safeParse({ extras: { blob: "x".repeat(40_000) } })
        .success,
    ).toBe(false);
  });

  it("allows 200 nodes and 400 edges and no more", () => {
    const node = (index: number) =>
      candidateNode("end", { outcome: "done" }, `n${index}`);
    const edge = (index: number) => ({
      id: `e${index}`,
      from: { node: "a", port: "out" },
      to: { node: "b" },
    });
    const graph = (nodes: number, edges: number) => ({
      nodes: Array.from({ length: nodes }, (_, index) => node(index)),
      edges: Array.from({ length: edges }, (_, index) => edge(index)),
      settings: {},
    });
    expect(workflowGraphSchema.safeParse(graph(200, 400)).success).toBe(true);
    expect(workflowGraphSchema.safeParse(graph(201, 0)).success).toBe(false);
    expect(workflowGraphSchema.safeParse(graph(0, 401)).success).toBe(false);
  });

  it("rejects a graph with an unknown top-level key", () => {
    expect(
      workflowGraphSchema.safeParse({
        nodes: [],
        edges: [],
        settings: {},
        version: 2,
      }).success,
    ).toBe(false);
  });

  it("fills defaults deep inside a built graph", () => {
    const graph = buildGraph({
      nodes: [["hold", "wait", { wait: "reply" }], end],
      edges: [["hold", "replied", "done", 2]],
    });
    expect(graph.settings.checkCadenceMinutes).toBe(15);
    expect(graph.edges[0].back).toEqual({ maxIterations: 2 });
  });
});

describe("receipts, events, steps and item state", () => {
  const at = "2026-10-18T10:00:00Z";

  it("builds a key from workflow, item, node and attempt", () => {
    expect(
      receiptKey({
        workflowId: "wf",
        itemId: "i1",
        nodeId: "send",
        attempt: 2,
      }),
    ).toBe("wf:i1:send:2");
  });

  it("adds a salt after the attempt, so one item id can have a receipt for each thing it stood for", () => {
    const key = (salt?: string) =>
      receiptKey({
        workflowId: "wf",
        itemId: "group:x",
        nodeId: "send",
        attempt: 0,
        ...(salt === undefined ? {} : { salt }),
      });

    expect(key("a1")).toBe("wf:group%3Ax:send:0:a1");
    expect(key("a1")).not.toBe(key("b2"));
    expect(key()).toBe("wf:group%3Ax:send:0");
  });

  it("encodes each part so a colon in an id cannot make two keys collide", () => {
    const a = receiptKey({
      workflowId: "wf",
      itemId: "a:b",
      nodeId: "c",
      attempt: 1,
    });
    const b = receiptKey({
      workflowId: "wf",
      itemId: "a",
      nodeId: "b:c",
      attempt: 1,
    });
    expect(a).not.toBe(b);
    expect(a.split(":")).toHaveLength(4);
  });

  it("names a loop counter by its edge", () => {
    expect(loopCounterKey("e4")).toBe("loop:e4");
  });

  it("accepts started, done and failed receipts and nothing else", () => {
    const receipt = (status: string) =>
      receiptSchema.safeParse({ key: "wf:i:n:1", status, at }).success;
    expect(receipt("started")).toBe(true);
    expect(receipt("done")).toBe(true);
    expect(receipt("failed")).toBe(true);
    expect(receipt("needs_check")).toBe(false);
    expect(
      receiptSchema.safeParse({
        key: "wf:i:n:1",
        status: "done",
        externalRef: "1700000000.123",
        url: "https://example.test/m/1",
        summary: "Posted",
        at,
      }).success,
    ).toBe(true);
    expect(
      receiptSchema.safeParse({
        key: "wf:i:n:1",
        status: "done",
        at: "yesterday",
      }).success,
    ).toBe(false);
  });

  it("bounds an item event summary to 2 KB and checks its kind and mode", () => {
    const event = (overrides: Record<string, unknown>) =>
      itemEventSchema.safeParse({
        workflowId: "wf",
        runId: "r1",
        itemId: "i1",
        nodeId: "assess",
        kind: "decision",
        at,
        mode: "live",
        summary: "Needs info",
        ...overrides,
      }).success;
    expect(event({})).toBe(true);
    expect(event({ summary: "x".repeat(2048) })).toBe(true);
    expect(event({ summary: "x".repeat(2049) })).toBe(false);
    expect(event({ kind: "vanished" })).toBe(false);
    expect(event({ mode: "staging" })).toBe(false);
  });

  it("makes an ended event carry its outcome and an error event its code, and no other event either", () => {
    const event = (overrides: Record<string, unknown>) =>
      itemEventSchema.safeParse({
        workflowId: "wf",
        runId: "r1",
        itemId: "i1",
        kind: "decision",
        at,
        mode: "live",
        summary: "",
        ...overrides,
      }).success;
    for (const outcome of END_OUTCOMES) {
      expect(event({ kind: "ended", outcome })).toBe(true);
    }
    for (const code of WORKFLOW_ERROR_CODES) {
      expect(event({ kind: "error", code })).toBe(true);
    }
    expect(event({ kind: "ended" })).toBe(false);
    expect(event({ kind: "error" })).toBe(false);
    expect(event({ kind: "ended", outcome: "finished" })).toBe(false);
    expect(event({ kind: "error", code: "mystery" })).toBe(false);
    expect(event({ kind: "taken", outcome: "done" })).toBe(false);
    expect(event({ kind: "taken", code: "provider_error" })).toBe(false);
    expect(
      event({ kind: "ended", outcome: "done", code: "provider_error" }),
    ).toBe(false);
  });

  it("describes a step with ports, a typed error and receipt keys", () => {
    const step = (overrides: Record<string, unknown>) =>
      stepRecordSchema.safeParse({
        runId: "r1",
        nodeId: "assess",
        status: "failed",
        mode: "dry",
        startedAt: at,
        ports: { out: { count: 1, itemIds: ["i1"] } },
        ...overrides,
      }).success;
    expect(
      step({
        error: { code: "ai_invalid_output", message: "no result tool call" },
      }),
    ).toBe(true);
    expect(step({ error: { code: "mystery", message: "?" } })).toBe(false);
    expect(step({ status: "needs_check", receiptKeys: ["wf:i:n:1"] })).toBe(
      true,
    );
    expect(step({ ports: { out: { count: -1, itemIds: [] } } })).toBe(false);
  });

  it("describes a parked item with its wake, counters and lease", () => {
    const state = {
      workflowId: "wf",
      graphVersion: 3,
      itemId: "i1",
      parkedAtNode: "waitReply",
      wake: {
        wait: "reply",
        dueAt: at,
        thread: { channelId: "C1", threadTs: "1700000000.123" },
      },
      context: { assess: { risk: "low" } },
      counters: { attempts: 1, [loopCounterKey("e4")]: 1 },
      leasedBy: "run-1",
      leaseUntil: at,
      updatedAt: at,
    };
    expect(itemStateSchema.safeParse(state).success).toBe(true);
    expect(
      itemStateSchema.safeParse({ ...state, graphVersion: 0 }).success,
    ).toBe(false);
    expect(
      itemStateSchema.safeParse({ ...state, counters: { attempts: -1 } })
        .success,
    ).toBe(false);
    expect(
      itemStateSchema.safeParse({
        ...state,
        wake: { wait: "forever", dueAt: at },
      }).success,
    ).toBe(false);
  });
});
