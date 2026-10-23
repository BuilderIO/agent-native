import { describe, expect, it } from "vitest";

import {
  WorkflowError,
  workflowGraphSchema,
  type WorkflowGraph,
} from "./contract.js";
import {
  pathsReadBy,
  validateWorkflowGraph,
  type WorkflowIssue,
  type WorkflowIssueCode,
} from "./graph-validation.js";
import {
  operationDefinitionSchema,
  type OperationDefinitionInput,
  type OperationNodeKind,
} from "./operations.js";
import {
  aiWritten,
  buildGraph,
  catalogOf,
  fixed,
  fromPath,
  rule,
  type EdgeSpec,
  type NodeSpec,
} from "./story-graphs.fixture.js";

// Structure tests run against a small catalog of their own, so a field renamed
// in the real catalog cannot break them. Its fields take any constant, which
// lets a test bind whatever name it needs to check a reference.
const ANYTHING = ["text", "value", "a", "b", "c", "d", "e", "f", "v"].map(
  (name) => ({ name, type: "json" as const }),
);

function stub(
  id: string,
  nodeKinds: OperationNodeKind[],
  effect: "read" | "write",
  extra: Partial<OperationDefinitionInput> = {},
) {
  const [provider] = id.split(".");
  return operationDefinitionSchema.parse({
    id,
    provider,
    label: id,
    nodeKinds,
    effect,
    fields: ANYTHING,
    implementation: {
      type: "provider-request",
      method: effect === "read" ? "GET" : "POST",
      pathTemplate: "/example",
    },
    ...(nodeKinds.includes("source")
      ? {
          itemMapping: {
            kind: "message",
            fields: { title: "title", occurredAt: "createdAt" },
            dedupeKey: "id",
          },
        }
      : {}),
    credential: { provider },
    ...extra,
  });
}

const builderStub = (op: "start" | "check" | "followUp") =>
  stub(`builder.${op}`, ["agent"], op === "check" ? "read" : "write", {
    fields: [],
    implementation: { type: "builder", op },
  });

const TEST_OPERATIONS = [
  stub("slack.readThread", ["lookup"], "read"),
  stub("slack.postMessage", ["action"], "write"),
  stub("hubspot.newLeads", ["source"], "read"),
  stub("github.listSecurityAlerts", ["source"], "read"),
  builderStub("start"),
  builderStub("check"),
  builderStub("followUp"),
];
const testCatalog = catalogOf(TEST_OPERATIONS);

const trigger: NodeSpec = ["start", "trigger", { schedule: { every: "5m" } }];
const lookup = (name: string, args: Record<string, unknown> = {}): NodeSpec => [
  name,
  "lookup",
  { operation: "slack.readThread", args },
];
const post = (name: string, args: Record<string, unknown> = {}): NodeSpec => [
  name,
  "action",
  { operation: "slack.postMessage", args: { text: fixed("hi"), ...args } },
];
const finish: NodeSpec = ["finish", "end", { outcome: "done" }];
const waitReply = (name: string): NodeSpec => [
  name,
  "wait",
  { wait: "reply", limitHours: 24 },
];

function validate(nodes: NodeSpec[], edges: EdgeSpec[], catalog = testCatalog) {
  return validateWorkflowGraph(buildGraph({ nodes, edges }), catalog);
}

function issueCodes(nodes: NodeSpec[], edges: EdgeSpec[]): WorkflowIssueCode[] {
  return validate(nodes, edges).issues.map((issue) => issue.code);
}

const chain: [NodeSpec[], EdgeSpec[]] = [
  [trigger, lookup("fetch"), post("send"), finish],
  [
    ["start", "out", "fetch"],
    ["fetch", "out", "send"],
    ["send", "out", "finish"],
  ],
];

describe("pathsReadBy", () => {
  const node = (spec: NodeSpec) =>
    buildGraph({ nodes: [spec], edges: [] }).nodes[0];
  const shown = (spec: NodeSpec) =>
    pathsReadBy(node(spec)).map(({ root, segments }) => [root, ...segments]);

  it("lists the paths a node's bindings, rules and reasons read, whichever way they are written", () => {
    expect(
      shown([
        "tell",
        "action",
        {
          operation: "slack.postMessage",
          args: {
            channel: fromPath("item.thread.channelId"),
            text: fixed("{{ item.title }} ({{ nodes.read.rows[1].id }})"),
            note: aiWritten("Say it kindly."),
          },
        },
      ]),
    ).toEqual([
      ["item", "thread", "channelId"],
      ["item", "title"],
      ["nodes", "read", "rows", 1, "id"],
    ]);
    expect(
      shown([
        "check",
        "filter",
        {
          combinator: "all",
          rules: [rule("item.x", "equals", "{{ settings.limit }}")],
        },
      ]),
    ).toEqual([
      ["item", "x"],
      ["settings", "limit"],
    ]);
    expect(
      shown(["finish", "end", { outcome: "done", reason: "{{ item.id }}" }]),
    ).toEqual([["item", "id"]]);
    expect(shown(["start", "trigger", { schedule: { every: "5m" } }])).toEqual(
      [],
    );
  });

  it("fails with graph_invalid for a path that does not parse, rather than leaving it out", () => {
    const broken = node([
      "check",
      "filter",
      { combinator: "all", rules: [rule("item..x", "isEmpty")] },
    ]);

    expect(() => pathsReadBy(broken)).toThrow(WorkflowError);
    expect(() => pathsReadBy(broken)).toThrow(/check/);
  });
});

describe("validateWorkflowGraph", () => {
  it("accepts a complete graph and reports ok", () => {
    expect(validate(...chain)).toEqual({ ok: true, issues: [] });
  });

  describe("the trigger", () => {
    it("requires one", () => {
      const nodes = [lookup("fetch"), finish];
      const issues = validate(nodes, [["fetch", "out", "finish"]]).issues;
      expect(issues.map((issue) => issue.code)).toContain("trigger_count");
    });

    it("rejects a second one", () => {
      const second: NodeSpec = [
        "other",
        "trigger",
        { schedule: { every: "5m" } },
      ];
      const codes = issueCodes(
        [trigger, second, finish],
        [
          ["start", "out", "finish"],
          ["other", "out", "finish"],
        ],
      );
      expect(codes).toEqual(["trigger_count"]);
    });

    it("rejects an edge into it", () => {
      const result = validate(chain[0], [
        ...chain[1],
        ["send", "out", "start"],
      ]);
      expect(result.issues).toContainEqual({
        code: "edge_into_trigger",
        edgeId: "e4",
        nodeId: "start",
      });
    });
  });

  describe("ids and names", () => {
    it("rejects two nodes with one id", () => {
      const codes = issueCodes(
        [trigger, lookup("fetch"), lookup("fetch"), finish],
        [
          ["start", "out", "fetch"],
          ["fetch", "out", "finish"],
        ],
      );
      expect(codes).toContain("duplicate_node_id");
    });

    it("rejects two nodes that answer to one name", () => {
      const graph = buildGraph({ nodes: chain[0], edges: chain[1] });
      const renamed: WorkflowGraph = {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === "send" ? { ...node, name: "fetch" } : node,
        ),
      };
      expect(validateWorkflowGraph(renamed, testCatalog).issues).toContainEqual(
        {
          code: "duplicate_node_name",
          nodeId: "send",
          detail: "fetch",
        },
      );
    });

    it("rejects a lookup that renames itself onto another node's name", () => {
      const into: NodeSpec = [
        "fetch",
        "lookup",
        { operation: "slack.readThread", args: {}, into: "send" },
      ];
      const issues = validate(
        [trigger, into, post("send"), finish],
        chain[1],
      ).issues;
      expect(issues.map((issue) => issue.code)).toContain(
        "duplicate_node_name",
      );
    });

    it("rejects two edges with one id", () => {
      const graph = buildGraph({ nodes: chain[0], edges: chain[1] });
      const dup: WorkflowGraph = {
        ...graph,
        edges: graph.edges.map((edge) => ({ ...edge, id: "same" })),
      };
      expect(
        validateWorkflowGraph(dup, testCatalog).issues.map((i) => i.code),
      ).toContain("duplicate_edge_id");
    });

    it("rejects a switch with two routes of one id", () => {
      const routeOf = (id: string) => ({
        id,
        label: id,
        combinator: "all",
        rules: [rule("item.kind", "equals", "x")],
      });
      const sw: NodeSpec = [
        "route",
        "switch",
        { routes: [routeOf("a"), routeOf("a")] },
      ];
      const result = validate(
        [trigger, sw, finish],
        [
          ["start", "out", "route"],
          ["route", "route:a", "finish"],
          ["route", "otherwise", "finish"],
        ],
      );
      expect(result.issues).toEqual([
        { code: "duplicate_switch_route", nodeId: "route", detail: "a" },
      ]);
    });
  });

  describe("edges", () => {
    it("rejects an edge to a node that does not exist", () => {
      const result = validate(chain[0], [
        ...chain[1],
        ["send", "out", "ghost"],
      ]);
      expect(result.issues).toContainEqual({
        code: "edge_unknown_node",
        edgeId: "e4",
        nodeId: "ghost",
      });
    });

    it("rejects an edge from a node that does not exist", () => {
      const result = validate(chain[0], [
        ...chain[1],
        ["ghost", "out", "finish"],
      ]);
      expect(result.issues).toContainEqual({
        code: "edge_unknown_node",
        edgeId: "e4",
        nodeId: "ghost",
      });
    });

    it("rejects a port the node does not have", () => {
      const result = validate(chain[0], [
        ["start", "out", "fetch"],
        ["fetch", "match", "send"],
        ["send", "out", "finish"],
      ]);
      expect(result.issues).toContainEqual({
        code: "edge_unknown_port",
        edgeId: "e2",
        nodeId: "fetch",
        port: "match",
      });
    });

    it("rejects limitReached on a node no back-edge leaves", () => {
      const result = validate(chain[0], [
        ...chain[1],
        ["send", "limitReached", "finish"],
      ]);
      expect(result.issues.map((issue) => issue.code)).toEqual([
        "edge_unknown_port",
      ]);
    });

    it("rejects a back-edge that leaves from limitReached itself", () => {
      const result = validate(
        [trigger, lookup("fetch"), waitReply("hold"), finish],
        [
          ["start", "out", "fetch"],
          ["fetch", "out", "hold"],
          ["hold", "replied", "fetch", 2],
          ["hold", "timedOut", "finish"],
          ["hold", "limitReached", "finish"],
          ["hold", "limitReached", "fetch", 2],
        ],
      );
      expect(result.issues).toContainEqual({
        code: "edge_unknown_port",
        edgeId: "e6",
        nodeId: "hold",
        port: "limitReached",
      });
    });
  });

  describe("outputs that lead nowhere", () => {
    it("rejects a filter whose otherwise port is dangling", () => {
      const filter: NodeSpec = [
        "check",
        "filter",
        { combinator: "all", rules: [rule("item.kind", "equals", "x")] },
      ];
      const result = validate(
        [trigger, filter, finish],
        [
          ["start", "out", "check"],
          ["check", "match", "finish"],
        ],
      );
      expect(result.issues).toEqual([
        { code: "port_leads_nowhere", nodeId: "check", port: "otherwise" },
      ]);
    });

    it("rejects a wait whose timedOut port is dangling", () => {
      const result = validate(
        [trigger, waitReply("hold"), finish],
        [
          ["start", "out", "hold"],
          ["hold", "replied", "finish"],
        ],
      );
      expect(result.issues).toEqual([
        { code: "port_leads_nowhere", nodeId: "hold", port: "timedOut" },
      ]);
    });

    it("rejects a switch route or otherwise left dangling", () => {
      const sw: NodeSpec = [
        "route",
        "switch",
        {
          routes: [
            {
              id: "a",
              label: "A",
              combinator: "all",
              rules: [rule("item.kind", "equals", "x")],
            },
          ],
        },
      ];
      const result = validate(
        [trigger, sw, finish],
        [
          ["start", "out", "route"],
          ["route", "route:a", "finish"],
        ],
      );
      expect(result.issues).toEqual([
        { code: "port_leads_nowhere", nodeId: "route", port: "otherwise" },
      ]);
    });

    it("rejects an unconnected limitReached port", () => {
      const result = validate(
        [trigger, lookup("fetch"), waitReply("hold"), finish],
        [
          ["start", "out", "fetch"],
          ["fetch", "out", "hold"],
          ["hold", "replied", "fetch", 2],
          ["hold", "timedOut", "finish"],
        ],
      );
      expect(result.issues).toEqual([
        { code: "port_leads_nowhere", nodeId: "hold", port: "limitReached" },
      ]);
    });

    it("rejects a trigger with nothing after it", () => {
      const result = validate([trigger], []);
      expect(result.issues).toEqual([
        { code: "port_leads_nowhere", nodeId: "start", port: "out" },
      ]);
    });
  });

  describe("reachability and cycles", () => {
    it("rejects a node the trigger cannot reach", () => {
      const result = validate(
        [...chain[0], post("orphan")],
        [...chain[1], ["orphan", "out", "finish"]],
      );
      expect(result.issues).toEqual([
        { code: "unreachable_node", nodeId: "orphan" },
      ]);
    });

    it("rejects a cycle that is not flagged as a back-edge", () => {
      const result = validate(chain[0], [
        ...chain[1],
        ["send", "out", "fetch"],
      ]);
      expect(result.issues).toEqual([
        { code: "cycle_without_back_edge", nodeId: "fetch" },
      ]);
    });

    it("rejects a back-edge that does not close a cycle", () => {
      const result = validate(chain[0], [
        ...chain[1],
        ["send", "out", "finish", 3],
      ]);
      expect(result.issues.map((issue) => issue.code)).toContain(
        "back_edge_without_cycle",
      );
    });
  });

  describe("loops", () => {
    const loop = (): [NodeSpec[], EdgeSpec[]] => [
      [trigger, lookup("fetch"), post("ask"), waitReply("hold"), finish],
      [
        ["start", "out", "fetch"],
        ["fetch", "out", "ask"],
        ["ask", "out", "hold"],
        ["hold", "replied", "fetch", 2],
        ["hold", "timedOut", "finish"],
        ["hold", "limitReached", "finish"],
      ],
    ];

    it("accepts a loop that passes through a wait", () => {
      expect(validate(...loop())).toEqual({ ok: true, issues: [] });
    });

    it("accepts a wait that loops back to itself", () => {
      const result = validate(
        [trigger, waitReply("hold"), finish],
        [
          ["start", "out", "hold"],
          ["hold", "replied", "hold", 2],
          ["hold", "timedOut", "finish"],
          ["hold", "limitReached", "finish"],
        ],
      );
      expect(result).toEqual({ ok: true, issues: [] });
    });

    it("accepts loops that run one after another", () => {
      const result = validate(
        [
          trigger,
          lookup("one"),
          waitReply("holdOne"),
          lookup("two"),
          waitReply("holdTwo"),
          finish,
        ],
        [
          ["start", "out", "one"],
          ["one", "out", "holdOne"],
          ["holdOne", "replied", "one", 2],
          ["holdOne", "timedOut", "two"],
          ["holdOne", "limitReached", "two"],
          ["two", "out", "holdTwo"],
          ["holdTwo", "replied", "two", 2],
          ["holdTwo", "timedOut", "finish"],
          ["holdTwo", "limitReached", "finish"],
        ],
      );
      expect(result).toEqual({ ok: true, issues: [] });
    });

    it("rejects a loop with no wait on it", () => {
      const result = validate(
        [trigger, lookup("fetch"), post("send"), finish],
        [
          ["start", "out", "fetch"],
          ["fetch", "out", "send"],
          ["send", "out", "fetch", 2],
          ["send", "out", "finish"],
          ["send", "limitReached", "finish"],
        ],
      );
      expect(result.issues).toEqual([
        { code: "loop_without_wait", edgeId: "e3", nodeId: "fetch" },
      ]);
    });

    it("rejects a loop when one path around it skips the wait", () => {
      const result = validate(
        [trigger, lookup("head"), waitReply("hold"), post("tail"), finish],
        [
          ["start", "out", "head"],
          ["head", "out", "hold"],
          ["head", "out", "tail"],
          ["hold", "replied", "tail"],
          ["hold", "timedOut", "finish"],
          ["tail", "out", "head", 2],
          ["tail", "limitReached", "finish"],
        ],
      );
      expect(result.issues).toEqual([
        { code: "loop_without_wait", edgeId: "e6", nodeId: "head" },
      ]);
    });

    it("rejects two back-edges into one loop head", () => {
      const result = validate(
        [trigger, lookup("fetch"), waitReply("hold"), finish],
        [
          ["start", "out", "fetch"],
          ["fetch", "out", "hold"],
          ["hold", "replied", "fetch", 2],
          ["hold", "timedOut", "fetch", 2],
          ["hold", "limitReached", "finish"],
        ],
      );
      expect(result.issues).toEqual([
        { code: "multiple_back_edges", edgeId: "e4", nodeId: "fetch" },
      ]);
    });

    it("rejects nested loops", () => {
      const result = validate(
        [
          trigger,
          lookup("outer"),
          lookup("inner"),
          waitReply("holdInner"),
          waitReply("holdOuter"),
          finish,
        ],
        [
          ["start", "out", "outer"],
          ["outer", "out", "inner"],
          ["inner", "out", "holdInner"],
          ["holdInner", "replied", "inner", 2],
          ["holdInner", "timedOut", "holdOuter"],
          ["holdInner", "limitReached", "finish"],
          ["holdOuter", "replied", "outer", 2],
          ["holdOuter", "timedOut", "finish"],
          ["holdOuter", "limitReached", "finish"],
        ],
      );
      expect(result.issues).toEqual([
        { code: "nested_loop", edgeId: "e7", nodeId: "outer" },
      ]);
    });

    it("rejects a status source as the target of a back-edge", () => {
      const status: NodeSpec = [
        "inFlight",
        "source",
        { source: "status", status: "automation_started", takeLimit: 5 },
      ];
      const pause: NodeSpec = [
        "pause",
        "wait",
        { wait: "time", duration: { amount: 1, unit: "hours" } },
      ];
      const result = validate(
        [trigger, status, pause, finish],
        [
          ["start", "out", "inFlight"],
          ["inFlight", "out", "pause"],
          ["pause", "done", "inFlight", 2],
          ["pause", "limitReached", "finish"],
        ],
      );
      expect(result.issues).toEqual([
        { code: "status_source_back_edge", edgeId: "e3", nodeId: "inFlight" },
      ]);
    });
  });

  describe("operations", () => {
    it("rejects an operation the catalog does not know", () => {
      const unknown: NodeSpec = [
        "fetch",
        "lookup",
        { operation: "slack.noSuchThing", args: {} },
      ];
      const result = validate(
        [trigger, unknown, finish],
        [
          ["start", "out", "fetch"],
          ["fetch", "out", "finish"],
        ],
      );
      expect(result.issues).toEqual([
        {
          code: "unknown_operation",
          nodeId: "fetch",
          detail: "slack.noSuchThing",
        },
      ]);
    });

    const mismatch = (node: NodeSpec) =>
      validate(
        [trigger, node, finish],
        [
          ["start", "out", node[0]],
          [node[0], "out", "finish"],
        ],
      ).issues.map(({ code, nodeId }) => ({ code, nodeId }));

    it("rejects a write operation on a lookup", () => {
      expect(
        mismatch([
          "fetch",
          "lookup",
          { operation: "slack.postMessage", args: {} },
        ]),
      ).toEqual([{ code: "operation_kind_mismatch", nodeId: "fetch" }]);
    });

    it("rejects a read operation on an action", () => {
      expect(
        mismatch([
          "send",
          "action",
          { operation: "slack.readThread", args: {} },
        ]),
      ).toEqual([{ code: "operation_kind_mismatch", nodeId: "send" }]);
    });

    it("rejects an operation that does not declare the node's kind", () => {
      expect(
        mismatch([
          "fetch",
          "lookup",
          { operation: "hubspot.newLeads", args: {} },
        ]),
      ).toEqual([{ code: "operation_kind_mismatch", nodeId: "fetch" }]);
    });

    it("rejects a window source on an operation with no window", () => {
      expect(
        mismatch([
          "alerts",
          "source",
          {
            source: "window",
            operation: "github.listSecurityAlerts",
            args: {},
            maxItems: 10,
          },
        ]),
      ).toEqual([{ code: "operation_kind_mismatch", nodeId: "alerts" }]);
    });

    it("rejects a condition wait on a write operation", () => {
      const wait: NodeSpec = [
        "hold",
        "wait",
        {
          wait: "condition",
          operation: "slack.postMessage",
          args: {},
          rule: rule("item.status", "equals", "resolved"),
        },
      ];
      const result = validate(
        [trigger, wait, finish],
        [
          ["start", "out", "hold"],
          ["hold", "met", "finish"],
          ["hold", "timedOut", "finish"],
        ],
      );
      expect(result.issues.map((issue) => issue.code)).toEqual([
        "operation_kind_mismatch",
      ]);
    });

    it("rejects an agent node whose operation is not the builder operation it names", () => {
      const start: NodeSpec = [
        "hand",
        "agent",
        { agent: "builder", op: "start", args: {} },
      ];
      const wrongImpl = TEST_OPERATIONS.map((def) =>
        def.id === "builder.start"
          ? {
              ...def,
              implementation: {
                type: "builder" as const,
                op: "check" as const,
              },
              effect: "read" as const,
            }
          : def,
      );
      const edges: EdgeSpec[] = [
        ["start", "out", "hand"],
        ["hand", "out", "finish"],
      ];
      expect(validate([trigger, start, finish], edges).ok).toBe(true);
      expect(
        validate(
          [trigger, start, finish],
          edges,
          catalogOf(wrongImpl),
        ).issues.map((issue) => issue.code),
      ).toEqual(["operation_kind_mismatch"]);
    });

    it("reports an agent operation the catalog does not carry", () => {
      const start: NodeSpec = [
        "hand",
        "agent",
        { agent: "builder", op: "followUp", args: {} },
      ];
      const catalog = catalogOf(
        TEST_OPERATIONS.filter((def) => def.id !== "builder.followUp"),
      );
      const result = validate(
        [trigger, start, finish],
        [
          ["start", "out", "hand"],
          ["hand", "out", "finish"],
        ],
        catalog,
      );
      expect(result.issues).toEqual([
        {
          code: "unknown_operation",
          nodeId: "hand",
          detail: "builder.followUp",
        },
      ]);
    });
  });

  describe("the tools of an AI node", () => {
    const assess = (tools: string[]): NodeSpec => [
      "assess",
      "ai",
      {
        instruction: "Judge the thread.",
        mode: "perItem",
        result: { fine: { type: "boolean" } },
        tools,
      },
    ];
    const withTools = (tools: string[]) =>
      validate(
        [trigger, assess(tools), finish],
        [
          ["start", "out", "assess"],
          ["assess", "out", "finish"],
        ],
      );

    it("accepts a tool that is a read operation in the catalog, and an AI node with none", () => {
      expect(withTools(["slack.readThread"])).toEqual({ ok: true, issues: [] });
      expect(withTools([])).toEqual({ ok: true, issues: [] });
    });

    it("rejects a tool that is not an operation in the catalog", () => {
      expect(withTools(["slack.noSuchThing"]).issues).toEqual([
        {
          code: "unknown_tool",
          nodeId: "assess",
          detail: "slack.noSuchThing is not an operation Factory has",
        },
      ]);
    });

    it("rejects a tool that writes, since a model may only be given reads", () => {
      expect(withTools(["slack.postMessage"]).issues).toEqual([
        {
          code: "unknown_tool",
          nodeId: "assess",
          detail:
            "slack.postMessage writes, and a model may only be given reads",
        },
      ]);
    });

    it("reports each bad tool of a node, and leaves the good ones alone", () => {
      const result = withTools([
        "slack.readThread",
        "slack.noSuchThing",
        "slack.postMessage",
      ]);

      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.detail)).toEqual([
        "slack.noSuchThing is not an operation Factory has",
        "slack.postMessage writes, and a model may only be given reads",
      ]);
    });
  });

  describe("target fields", () => {
    const targetCatalog = catalogOf([
      stub("acme.send", ["action"], "write", {
        fields: [
          { name: "to", type: "string", required: true, target: true },
          { name: "cc", type: "string", target: true },
          // A reviewed target the model may write.
          {
            name: "tag",
            type: "string",
            target: true,
            modelMayWrite: true,
          },
          { name: "subject", type: "string" },
        ],
      }),
      stub("acme.find", ["lookup"], "read", {
        fields: [{ name: "who", type: "string" }],
      }),
    ]);
    const assess: NodeSpec = [
      "assess",
      "ai",
      {
        instruction: "Pick the recipient.",
        mode: "perItem",
        result: { email: { type: "string" } },
        tools: [],
      },
    ];
    const find: NodeSpec = [
      "find",
      "lookup",
      { operation: "acme.find", args: { who: fixed("anyone") } },
    ];
    const send = (args: Record<string, unknown>): NodeSpec => [
      "mail",
      "action",
      { operation: "acme.send", args },
    ];
    const issuesOf = (args: Record<string, unknown>) =>
      validate(
        [trigger, find, assess, send(args), finish],
        [
          ["start", "out", "find"],
          ["find", "out", "assess"],
          ["assess", "out", "mail"],
          ["mail", "out", "finish"],
        ],
        targetCatalog,
      ).issues;
    const targetIssues = (args: Record<string, unknown>) =>
      issuesOf(args).filter((issue) => issue.code === "model_written_target");

    it("rejects a target the AI writes, naming the field", () => {
      expect(targetIssues({ to: aiWritten("Pick an address.") })).toEqual([
        {
          code: "model_written_target",
          nodeId: "mail",
          detail:
            "args.to decides who or where acme.send lands, and it is written by the AI. Type it in, or read it from a setting, an item field or a lookup.",
        },
      ]);
    });

    it("rejects a target that reads an AI step's result, by path or inside a fixed template", () => {
      for (const to of [
        fromPath("nodes.assess.email"),
        fixed("{{ nodes.assess.email }}"),
        fixed("ops+{{ nodes.assess.email }}@example.test"),
      ]) {
        expect(targetIssues({ to }), JSON.stringify(to)).toEqual([
          {
            code: "model_written_target",
            nodeId: "mail",
            detail: expect.stringContaining('it reads the AI step "assess"'),
          },
        ]);
      }
    });

    it("reports each target on the node that is model-written", () => {
      const issues = targetIssues({
        to: aiWritten("Pick an address."),
        cc: fromPath("nodes.assess.email"),
      });
      expect(issues.map((issue) => issue.detail?.split(" ")[0])).toEqual([
        "args.to",
        "args.cc",
      ]);
    });

    it("accepts a target typed in, or read from a setting, an item field or a lookup", () => {
      for (const to of [
        fixed("ops@example.test"),
        fixed("ops+{{ item.id }}@example.test"),
        fromPath("settings.ownerEmail"),
        fromPath("item.extras.customerEmail"),
        fromPath("nodes.find.user.id"),
      ]) {
        expect(issuesOf({ to }), JSON.stringify(to)).toEqual([]);
      }
    });

    it("accepts a model-written value in a field that is no target", () => {
      expect(
        issuesOf({
          to: fixed("ops@example.test"),
          subject: aiWritten("Write a subject."),
        }),
      ).toEqual([]);
    });

    it("accepts a model-written target only where the catalog says a model may write it", () => {
      expect(
        issuesOf({
          to: fixed("ops@example.test"),
          tag: aiWritten("Write a tag."),
        }),
      ).toEqual([]);
      expect(
        issuesOf({
          to: fixed("ops@example.test"),
          tag: fromPath("nodes.assess.email"),
        }),
      ).toEqual([]);
    });

    it("is not fooled by a malformed path, which bad_reference reports", () => {
      const codes = issuesOf({ to: fromPath("nodes..email") }).map(
        (issue) => issue.code,
      );
      expect(codes).toContain("bad_reference");
      expect(codes).not.toContain("model_written_target");
    });
  });

  describe("field bindings", () => {
    const fieldCatalog = catalogOf([
      stub("acme.lookup", ["lookup"], "read", {
        fields: [
          { name: "title", type: "string", required: true },
          { name: "count", type: "number" },
          { name: "flag", type: "boolean" },
          { name: "level", type: "enum", enum: ["low", "high"] },
          { name: "blob", type: "json" },
          // A default fills the field, so a node may leave it out.
          { name: "note", type: "text", required: true, default: "none" },
        ],
      }),
      stub("acme.feed", ["source"], "read", {
        fields: [{ name: "repo", type: "string", required: true }],
      }),
      stub("acme.write", ["action"], "write", {
        fields: [{ name: "repo", type: "string", required: true }],
      }),
      stub("builder.check", ["agent"], "read", {
        fields: [{ name: "projectId", type: "string", required: true }],
        implementation: { type: "builder", op: "check" },
      }),
    ]);

    const run = (node: NodeSpec, edges: EdgeSpec[]) =>
      validate([trigger, node, finish], edges, fieldCatalog).issues;
    const lookupIssues = (args: Record<string, unknown>) =>
      run(
        ["fetch", "lookup", { operation: "acme.lookup", args }],
        [
          ["start", "out", "fetch"],
          ["fetch", "out", "finish"],
        ],
      );
    const codesOf = (args: Record<string, unknown>) =>
      lookupIssues(args).map((issue) => issue.code);
    const title = { title: fixed("Hello") };

    it("accepts every field bound to a matching constant, path or AI binding", () => {
      expect(
        lookupIssues({
          title: fromPath("item.title"),
          count: fixed(3),
          flag: fixed(false),
          level: fixed("high"),
          blob: fixed({ any: ["thing", 1, null] }),
          note: aiWritten("Write a note."),
        }),
      ).toEqual([]);
    });

    it("lets a field with a default be left out", () => {
      expect(codesOf(title)).toEqual([]);
    });

    it("rejects a field the operation does not declare", () => {
      expect(lookupIssues({ ...title, colour: fixed("red") })).toEqual([
        {
          code: "unknown_field",
          nodeId: "fetch",
          detail: 'acme.lookup has no field "colour"',
        },
      ]);
    });

    it("rejects a required field nobody binds", () => {
      expect(lookupIssues({ count: fixed(1) })).toEqual([
        {
          code: "missing_required_field",
          nodeId: "fetch",
          detail: 'acme.lookup needs "title"',
        },
      ]);
    });

    it("reports each missing required field once", () => {
      expect(
        run(
          [
            "feed",
            "source",
            {
              source: "provider-query",
              operation: "acme.feed",
              args: {},
              memory: "none",
              maxItems: 5,
            },
          ],
          [
            ["start", "out", "feed"],
            ["feed", "out", "finish"],
          ],
        ).map((issue) => issue.code),
      ).toEqual(["missing_required_field"]);
    });

    it("rejects an enum constant outside the listed values", () => {
      expect(lookupIssues({ ...title, level: fixed("medium") })).toEqual([
        {
          code: "enum_value_invalid",
          nodeId: "fetch",
          detail: 'args.level: "medium" is not one of low, high',
        },
      ]);
    });

    it.each([
      ["a string field bound to a number", { title: fixed(5) }],
      ["a text field bound to a boolean", { ...title, note: fixed(true) }],
      ["a number field bound to a string", { ...title, count: fixed("3") }],
      ["a number field bound to null", { ...title, count: fixed(null) }],
      ["a boolean field bound to a number", { ...title, flag: fixed(1) }],
      ["an enum field bound to a number", { ...title, level: fixed(3) }],
      ["a string field bound to an object", { title: fixed({ a: 1 }) }],
    ])("rejects %s", (_name, args) => {
      const issues = lookupIssues(args);
      expect(issues.map((issue) => issue.code)).toEqual([
        "field_type_mismatch",
      ]);
      expect(issues[0].nodeId).toBe("fetch");
    });

    it("says what type it found", () => {
      expect(lookupIssues({ title: fixed(["a"]) })[0].detail).toBe(
        "args.title: expected a string but got a list",
      );
      expect(lookupIssues({ ...title, count: fixed("3") })[0].detail).toBe(
        "args.count: expected a number but got a string",
      );
    });

    it("checks only that an expression names a field, never its value", () => {
      expect(
        lookupIssues({
          ...title,
          count: fromPath("item.text"),
          flag: aiWritten("Decide."),
          level: fromPath("item.level"),
        }),
      ).toEqual([]);
      expect(
        lookupIssues({ ...title, colour: fromPath("item.colour") }).map(
          (issue) => issue.code,
        ),
      ).toEqual(["unknown_field"]);
    });

    it("treats a fixed string with a {{ }} hole as an expression", () => {
      expect(
        lookupIssues({
          ...title,
          count: fixed("{{ item.extras.n }}"),
          flag: fixed("{{ item.extras.on }}"),
          level: fixed("{{ item.extras.level }}"),
        }),
      ).toEqual([]);
    });

    it("lets a json field take any constant, including null", () => {
      expect(lookupIssues({ ...title, blob: fixed(null) })).toEqual([]);
      expect(lookupIssues({ ...title, blob: fixed("text") })).toEqual([]);
    });

    it("does not count an inherited name such as toString as a bound field", () => {
      const catalog = catalogOf([
        stub("acme.lookup", ["lookup"], "read", {
          fields: [{ name: "toString", type: "string", required: true }],
        }),
      ]);
      const issues = validate(
        [
          trigger,
          ["fetch", "lookup", { operation: "acme.lookup", args: {} }],
          finish,
        ],
        [
          ["start", "out", "fetch"],
          ["fetch", "out", "finish"],
        ],
        catalog,
      ).issues;
      expect(issues.map((issue) => issue.code)).toEqual([
        "missing_required_field",
      ]);
    });

    it("checks a source's arguments", () => {
      const feed = (args: Record<string, unknown>): NodeSpec => [
        "feed",
        "source",
        {
          source: "provider-query",
          operation: "acme.feed",
          args,
          memory: "none",
          maxItems: 5,
        },
      ];
      const edges: EdgeSpec[] = [
        ["start", "out", "feed"],
        ["feed", "out", "finish"],
      ];
      expect(run(feed({ repo: fixed("a/b") }), edges)).toEqual([]);
      expect(
        run(feed({ repo: fixed("a/b"), since: fixed("x") }), edges).map(
          (issue) => issue.code,
        ),
      ).toEqual(["unknown_field"]);
      expect(
        run(feed({ repo: fixed(1) }), edges).map((issue) => issue.code),
      ).toEqual(["field_type_mismatch"]);
    });

    it("checks an action's arguments", () => {
      const send = (args: Record<string, unknown>): NodeSpec => [
        "send",
        "action",
        { operation: "acme.write", args },
      ];
      const edges: EdgeSpec[] = [
        ["start", "out", "send"],
        ["send", "out", "finish"],
      ];
      expect(run(send({ repo: fixed("a/b") }), edges)).toEqual([]);
      expect(run(send({}), edges).map((issue) => issue.code)).toEqual([
        "missing_required_field",
      ]);
    });

    it("checks a condition wait's arguments", () => {
      const hold = (args: Record<string, unknown>): NodeSpec => [
        "hold",
        "wait",
        {
          wait: "condition",
          operation: "acme.lookup",
          args,
          rule: rule("item.status", "equals", "resolved"),
        },
      ];
      const edges: EdgeSpec[] = [
        ["start", "out", "hold"],
        ["hold", "met", "finish"],
        ["hold", "timedOut", "finish"],
      ];
      expect(run(hold(title), edges)).toEqual([]);
      expect(run(hold({}), edges).map((issue) => issue.code)).toEqual([
        "missing_required_field",
      ]);
    });

    it("checks an agent node's arguments", () => {
      const hand = (args: Record<string, unknown>): NodeSpec => [
        "hand",
        "agent",
        { agent: "builder", op: "check", args },
      ];
      const edges: EdgeSpec[] = [
        ["start", "out", "hand"],
        ["hand", "out", "finish"],
      ];
      expect(
        run(hand({ projectId: fromPath("settings.builderProjectId") }), edges),
      ).toEqual([]);
      expect(run(hand({}), edges).map((issue) => issue.code)).toEqual([
        "missing_required_field",
      ]);
    });

    it("leaves argument checks to the kind mismatch when the operation cannot run there", () => {
      const result = run(
        [
          "fetch",
          "lookup",
          { operation: "acme.write", args: { nope: fixed(1) } },
        ],
        [
          ["start", "out", "fetch"],
          ["fetch", "out", "finish"],
        ],
      );
      expect(result.map((issue) => issue.code)).toEqual([
        "operation_kind_mismatch",
      ]);
    });
  });

  describe("references", () => {
    const withArgs = (args: Record<string, unknown>) =>
      validate(
        [trigger, lookup("fetch"), post("send", args), finish],
        chain[1],
      );
    const badReferences = (args: Record<string, unknown>) =>
      withArgs(args).issues.filter((issue) => issue.code === "bad_reference");

    it("accepts every root and an indexed path", () => {
      const result = withArgs({
        a: fromPath("item.payload.items[0].name"),
        b: fromPath("nodes.fetch.text"),
        c: fromPath("settings.triageOwnerEmail"),
        d: fromPath("run.windowStart"),
        e: fromPath("loop.iteration"),
        f: fixed("{{ item.title }} / {{ nodes.fetch.text }}"),
      });
      expect(result).toEqual({ ok: true, issues: [] });
    });

    it.each([
      ["a call", fromPath("item.fetch()")],
      ["an unknown root", fromPath("env.SECRET")],
      ["a prototype segment", fromPath("item.__proto__")],
      ["a constructor segment", fromPath("item.constructor")],
      ["a quoted key", fromPath('item["a"]')],
      ["a bare nodes root", fromPath("nodes")],
      ["a malformed hole", fixed("{{ item.title ")],
      ["an empty hole", fixed("{{ }}")],
      ["a hole nested in a fixed object", fixed({ a: ["{{ item.x + 1 }}"] })],
    ])("rejects %s", (_name, binding) => {
      const issues = badReferences({ value: binding });
      expect(issues).toHaveLength(1);
      expect(issues[0].nodeId).toBe("send");
    });

    it("rejects a node name nobody has", () => {
      const [issue] = badReferences({ value: fromPath("nodes.ghost.text") });
      expect(issue.detail).toContain('no node is named "ghost"');
    });

    it("rejects a reference to a node downstream of this one", () => {
      const result = validate(
        [
          trigger,
          lookup("fetch", { value: fromPath("nodes.send.text") }),
          post("send"),
          finish,
        ],
        chain[1],
      );
      expect(result.issues).toEqual([
        {
          code: "bad_reference",
          nodeId: "fetch",
          detail: 'args.value: "send" is not upstream of this node',
        },
      ]);
    });

    it("rejects a reference to a node on another branch", () => {
      const result = validate(
        [
          trigger,
          lookup("left", { value: fromPath("nodes.right.text") }),
          lookup("right"),
          finish,
        ],
        [
          ["start", "out", "left"],
          ["start", "out", "right"],
          ["left", "out", "finish"],
          ["right", "out", "finish"],
        ],
      );
      expect(
        result.issues.map(({ code, nodeId }) => ({ code, nodeId })),
      ).toEqual([{ code: "bad_reference", nodeId: "left" }]);
    });

    it("rejects a node reading its own output", () => {
      const result = validate(
        [
          trigger,
          lookup("fetch", { value: fromPath("nodes.fetch.text") }),
          finish,
        ],
        [
          ["start", "out", "fetch"],
          ["fetch", "out", "finish"],
        ],
      );
      expect(result.issues.map((issue) => issue.code)).toEqual([
        "bad_reference",
      ]);
    });

    it("does not let a loop head read a node later in its own loop", () => {
      const result = validate(
        [
          trigger,
          lookup("fetch", { value: fromPath("nodes.ask.text") }),
          post("ask"),
          waitReply("hold"),
          finish,
        ],
        [
          ["start", "out", "fetch"],
          ["fetch", "out", "ask"],
          ["ask", "out", "hold"],
          ["hold", "replied", "fetch", 2],
          ["hold", "timedOut", "finish"],
          ["hold", "limitReached", "finish"],
        ],
      );
      expect(result.issues.map((issue) => issue.code)).toEqual([
        "bad_reference",
      ]);
    });

    it("reads a lookup under its into name, and no longer under its own", () => {
      const renamed = (reference: string): NodeSpec[] => [
        trigger,
        [
          "fetch",
          "lookup",
          { operation: "slack.readThread", args: {}, into: "thread" },
        ],
        post("send", { value: fromPath(reference) }),
        finish,
      ];
      expect(validate(renamed("nodes.thread.text"), chain[1]).ok).toBe(true);
      expect(
        validate(renamed("nodes.fetch.text"), chain[1]).issues.map(
          (issue) => issue.code,
        ),
      ).toEqual(["bad_reference"]);
    });

    it("checks rule paths and right-hand templates", () => {
      const filter = (left: string, right: unknown): NodeSpec => [
        "check",
        "filter",
        { combinator: "all", rules: [rule(left, "equals", right)] },
      ];
      const edges: EdgeSpec[] = [
        ["start", "out", "check"],
        ["check", "match", "finish"],
        ["check", "otherwise", "finish"],
      ];
      const run = (left: string, right: unknown) =>
        validate([trigger, filter(left, right), finish], edges).issues;
      expect(run("item.status", "{{ settings.extras.limit }}")).toEqual([]);
      expect(run("item.status()", "x")).toHaveLength(1);
      expect(run("item.status", "{{ nodes.ghost.x }}")).toHaveLength(1);
      expect(run("item.status", ["a", "{{ item.__proto__ }}"])).toHaveLength(1);
    });

    it("checks switch routes, combine and split paths, and an end reason", () => {
      const sw: NodeSpec = [
        "route",
        "switch",
        {
          routes: [
            {
              id: "a",
              label: "A",
              combinator: "all",
              rules: [rule("item.bad(", "isTrue")],
            },
          ],
        },
      ];
      const combine: NodeSpec = [
        "group",
        "combine",
        { mode: "groupBy", key: "item.a b" },
      ];
      const split: NodeSpec = ["each", "split", { field: "other.list" }];
      const reasoned: NodeSpec = [
        "no",
        "end",
        { outcome: "dismissed", reason: "{{ nodes.ghost.reason }}" },
      ];
      const result = validate(
        [trigger, sw, combine, split, reasoned, finish],
        [
          ["start", "out", "route"],
          ["route", "route:a", "group"],
          ["route", "otherwise", "each"],
          ["group", "out", "no"],
          ["each", "out", "finish"],
        ],
      );
      expect(
        result.issues.map(({ code, nodeId }) => ({ code, nodeId })),
      ).toEqual([
        { code: "bad_reference", nodeId: "route" },
        { code: "bad_reference", nodeId: "group" },
        { code: "bad_reference", nodeId: "each" },
        { code: "bad_reference", nodeId: "no" },
      ]);
    });

    it("requires a reply wait to watch a node upstream of it", () => {
      const watching = (fromNode: string): NodeSpec => [
        "hold",
        "wait",
        { wait: "reply", watch: { fromNode } },
      ];
      const edges: EdgeSpec[] = [
        ["start", "out", "fetch"],
        ["fetch", "out", "hold"],
        ["hold", "replied", "finish"],
        ["hold", "timedOut", "finish"],
      ];
      const run = (fromNode: string) =>
        validate([trigger, lookup("fetch"), watching(fromNode), finish], edges)
          .issues;
      expect(run("fetch")).toEqual([]);
      expect(run("ghost").map((issue) => issue.code)).toEqual([
        "bad_reference",
      ]);
      expect(run("hold").map((issue) => issue.code)).toEqual(["bad_reference"]);
    });
  });

  it("reports several problems at once so a person can fix them together", () => {
    const result = validate(
      [
        trigger,
        lookup("fetch", { v: fromPath("env.X") }),
        post("orphan"),
        finish,
      ],
      [
        ["start", "out", "fetch"],
        ["orphan", "out", "finish"],
      ],
    );
    const found: WorkflowIssue[] = result.issues;
    expect([...new Set(found.map((issue) => issue.code))].sort()).toEqual([
      "bad_reference",
      "port_leads_nowhere",
      "unreachable_node",
    ]);
    expect(
      found
        .filter((issue) => issue.code === "unreachable_node")
        .map((i) => i.nodeId),
    ).toEqual(["orphan", "finish"]);
    expect(result.ok).toBe(false);
  });

  it("does not need the schema's help to stay total on a hand-built graph", () => {
    const graph = workflowGraphSchema.parse({
      nodes: [],
      edges: [],
      settings: {},
    });
    expect(validateWorkflowGraph(graph, testCatalog).issues).toEqual([
      expect.objectContaining({ code: "trigger_count" }),
    ]);
  });
});
