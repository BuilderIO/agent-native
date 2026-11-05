import { describe, expect, it } from "vitest";

import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import {
  validateWorkflowGraph,
  type WorkflowIssue,
} from "../workflow/graph-validation.js";
import {
  aiWritten,
  buildGraph,
  fixed,
  fromPath,
  type EdgeSpec,
  type NodeSpec,
} from "../workflow/story-graphs.fixture.js";
import { actionsNamedByGraph } from "./operation-gate.js";

const trigger: NodeSpec = ["start", "trigger", { schedule: { every: "5m" } }];
const done: NodeSpec = ["done", "end", { outcome: "done" }];
const assess = (tools: string[]): NodeSpec => [
  "assess",
  "ai",
  {
    instruction: "Decide.",
    result: { url: { type: "string" } },
    mode: "perItem",
    tools,
  },
];
const request = (
  args: Record<string, unknown>,
  operation = "github.apiRequest",
): NodeSpec => ["fetch", "lookup", { operation, args }];

function validate(...middle: NodeSpec[]) {
  const names = ["start", ...middle.map(([name]) => name), "done"];
  return validateWorkflowGraph(
    buildGraph({
      nodes: [trigger, ...middle, done],
      edges: names.slice(1).flatMap((to, index): EdgeSpec[] => {
        const from = names[index];
        return from === undefined ? [] : [[from, "out", to]];
      }),
    }),
    OPERATION_CATALOG,
  );
}

const codes = (issues: WorkflowIssue[]) =>
  issues.map((issue) => [issue.code, issue.nodeId] as const);

describe("an API request is never a model's tool", () => {
  it("is refused as an AI step's tool at save, where a curated read is not", () => {
    const refused = validate(assess(["github.apiRequest"]));
    expect(refused.ok).toBe(false);
    expect(refused.issues).toEqual([
      {
        code: "unknown_tool",
        nodeId: "assess",
        detail:
          "github.apiRequest reads a path someone types, and a model may only be given reads whose endpoint is fixed",
      },
    ]);
    expect(validate(assess(["github.readFile"]))).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("is refused for every provider's API request", () => {
    for (const def of OPERATION_CATALOG.list()) {
      if (!def.id.endsWith(".apiRequest")) continue;
      expect(codes(validate(assess([def.id])).issues), def.id).toEqual([
        ["unknown_tool", "assess"],
      ]);
    }
  });

  it("grants an AI step nothing at run time even if one slipped into a saved graph", () => {
    const graph = buildGraph({
      nodes: [trigger, assess(["github.apiRequest", "github.readFile"]), done],
      edges: [["start", "out", "done"]],
    });
    const access = actionsNamedByGraph(graph, OPERATION_CATALOG);
    expect(access.providerOperations).toEqual(new Set(["github.readFile"]));
  });

  it("is allowed as a lookup node, which is a person's choice of path", () => {
    const graph = buildGraph({
      nodes: [trigger, request({ path: fixed("repos/acme/web") }), done],
      edges: [["start", "out", "done"]],
    });
    expect(
      actionsNamedByGraph(graph, OPERATION_CATALOG).providerOperations,
    ).toEqual(new Set(["github.apiRequest"]));
  });
});

describe("a model never writes the path of an API request", () => {
  it("refuses a path the AI writes", () => {
    const result = validate(request({ path: aiWritten("Pick an endpoint.") }));
    expect(result.issues).toEqual([
      {
        code: "model_written_target",
        nodeId: "fetch",
        detail: expect.stringContaining(
          "which endpoint github.apiRequest reads",
        ),
      },
    ]);
  });

  it("refuses a path read from an AI step's answer", () => {
    const result = validate(
      assess([]),
      request({ path: fromPath("nodes.assess.url") }),
    );
    expect(codes(result.issues)).toEqual([["model_written_target", "fetch"]]);
  });

  it("accepts a path typed in, from a setting, from an item field or from an earlier lookup", () => {
    for (const path of [
      fixed("repos/acme/web/issues"),
      fromPath("settings.extras.path"),
      fromPath("item.extras.path"),
      fixed("repos/{{ item.thread.repo }}/issues"),
    ]) {
      expect(validate(request({ path })), JSON.stringify(path)).toEqual({
        ok: true,
        issues: [],
      });
    }
  });
});

describe("what an API request refuses is refused at save too, when the value is typed in", () => {
  const refusedAt = (args: Record<string, unknown>) =>
    validate(request(args)).issues;

  it("needs a path", () => {
    expect(codes(refusedAt({}))).toEqual([["missing_required_field", "fetch"]]);
  });

  it("refuses a path that leaves the provider's API, naming what was wrong", () => {
    for (const path of [
      "https://evil.test/x",
      "../admin",
      "repos/%2e%2e/admin",
      "repos//x",
      "issues?state=open",
      "issues#top",
    ]) {
      const issues = refusedAt({ path: fixed(path) });
      expect(issues, path).toHaveLength(1);
      const [issue] = issues;
      expect(issue, path).toMatchObject({
        code: "field_type_mismatch",
        nodeId: "fetch",
      });
      expect(issue?.detail, path).toContain("args.path:");
      expect(issue?.detail, path).not.toContain("evil.test");
    }
  });

  it("refuses a credential header by name and a bad query, timeout or paging", () => {
    expect(
      refusedAt({
        path: fixed("user"),
        headers: fixed({ Authorization: "Bearer x" }),
      })[0]?.detail,
    ).toContain('"Authorization"');
    expect(
      refusedAt({ path: fixed("user"), query: fixed({ "a b": 1 }) }),
    ).toHaveLength(1);
    expect(
      refusedAt({ path: fixed("user"), timeoutSeconds: fixed(120) }),
    ).toHaveLength(1);
    expect(
      refusedAt({
        path: fixed("user"),
        pagination: fixed({ cursorPath: "next" }),
      }),
    ).toHaveLength(1);
    expect(
      refusedAt({ path: fixed("user"), authentication: fixed("basic") })[0],
    ).toMatchObject({ code: "enum_value_invalid" });
  });

  it("refuses a bad list of paths to keep, naming the path", () => {
    const refusedKeep = (value: unknown) =>
      refusedAt({ path: fixed("user"), fieldsToKeep: fixed(value) });
    for (const [value, words] of [
      [[], "is empty"],
      [["a..b"], 'The path "a..b" has an empty part'],
      [["a.__proto__"], "cannot be kept"],
      [["a.constructor"], "cannot be kept"],
      [["prototype"], "cannot be kept"],
      [["a", "a"], "is listed twice"],
      [["a.b.c.d.e.f.g.h.i"], "more than 8 parts"],
      [["x".repeat(65)], "longer than 64 characters"],
      [["a", 5], "not text"],
      ["number", "must be a list"],
    ] as const) {
      const issues = refusedKeep(value);
      expect(issues, JSON.stringify(value)).toHaveLength(1);
      expect(issues[0], JSON.stringify(value)).toMatchObject({
        code: "field_type_mismatch",
        nodeId: "fetch",
      });
      expect(issues[0]?.detail, JSON.stringify(value)).toContain(
        "args.fieldsToKeep:",
      );
      expect(issues[0]?.detail, JSON.stringify(value)).toContain(words);
    }
    expect(
      refusedKeep(Array.from({ length: 51 }, (_unused, index) => `p${index}`)),
    ).toHaveLength(1);
  });

  it("accepts a good list of paths to keep, and one read from an earlier step", () => {
    expect(
      refusedAt({
        path: fixed("user"),
        fieldsToKeep: fixed(["number", "title", "user.login", "first name"]),
      }),
    ).toEqual([]);
    expect(
      refusedAt({
        path: fixed("user"),
        fieldsToKeep: fromPath("item.extras.keep"),
      }),
    ).toEqual([]);
  });

  it("accepts a well-formed request, and leaves a value with a hole for the run to check", () => {
    expect(
      refusedAt({
        path: fixed("repos/acme/web/issues"),
        query: fixed({ state: "open", per_page: 50, "labels[]": ["bug"] }),
        headers: fixed({ "X-Request-Id": "r1" }),
        authentication: fixed("none"),
        timeoutSeconds: fixed(10),
        pagination: fixed({ cursorPath: "next", cursorParam: "after" }),
      }),
    ).toEqual([]);
    expect(
      refusedAt({ path: fixed("user"), includeStatus: fixed(true) }),
    ).toEqual([]);
    expect(
      refusedAt({
        path: fixed("{{ settings.extras.path }}"),
        headers: fixed({ "X-Trace": "{{ run.id }}" }),
        query: fixed({ q: "{{ item.title }}" }),
      }),
    ).toEqual([]);
  });

  it("accepts the connection placeholder only where the provider has one", () => {
    expect(
      validate(
        request(
          { path: fixed("api/projects/{projectId}/query/") },
          "posthog.apiRequest",
        ),
      ),
    ).toEqual({ ok: true, issues: [] });
    expect(
      refusedAt({ path: fixed("api/projects/{projectId}/query/") }),
    ).toHaveLength(1);
  });
});

describe("every refusal a typed value gets names its code, at save as at run", () => {
  const refusedAt = (args: Record<string, unknown>) =>
    validate(request(args)).issues;

  it.each([
    ["a full URL", { path: fixed("https://evil.test/x") }, "full_url_refused"],
    [
      "a protocol-relative URL",
      { path: fixed("//evil.test/x") },
      "full_url_refused",
    ],
    ["a dot-dot", { path: fixed("a/../b") }, "unsafe_path_value"],
    ["an encoded dot-dot", { path: fixed("%2e%2e/b") }, "unsafe_path_value"],
    ["an empty segment", { path: fixed("a//b") }, "unsafe_path_value"],
    ["a ? in the path", { path: fixed("a?b=1") }, "unsafe_path_value"],
    ["a # in the path", { path: fixed("a#b") }, "unsafe_path_value"],
    [
      "a query that is not an object",
      { path: fixed("a"), query: fixed(["x"]) },
      "invalid_query",
    ],
    [
      "a credential header",
      { path: fixed("a"), headers: fixed({ Authorization: "x" }) },
      "header_denied",
    ],
    [
      "a header that is not text",
      { path: fixed("a"), headers: fixed({ "X-A": 1 }) },
      "invalid_header",
    ],
    [
      "a timeout of zero",
      { path: fixed("a"), timeoutSeconds: fixed(0) },
      "invalid_timeout",
    ],
    [
      "paging with no cursor parameter",
      { path: fixed("a"), pagination: fixed({ cursorPath: "n" }) },
      "invalid_pagination",
    ],
    [
      "an empty list of paths to keep",
      { path: fixed("a"), fieldsToKeep: fixed([]) },
      "invalid_fields_to_keep",
    ],
    [
      "a path to keep that reaches a prototype",
      { path: fixed("a"), fieldsToKeep: fixed(["x.__proto__"]) },
      "invalid_fields_to_keep",
    ],
    [
      "paths to keep that are not a list",
      { path: fixed("a"), fieldsToKeep: fixed("number") },
      "invalid_fields_to_keep",
    ],
    [
      "a status request beside paging",
      {
        path: fixed("a"),
        includeStatus: fixed(true),
        pagination: fixed({ cursorPath: "n", cursorParam: "c" }),
      },
      "incompatible_fields",
    ],
  ])("%s ends its detail with its typed code", (_label, args, code) => {
    const issues = refusedAt(args);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "field_type_mismatch",
      nodeId: "fetch",
      detail: expect.stringMatching(
        new RegExp(`^args\\.\\w+: .+ \\(${code}\\)$`),
      ),
    });
  });

  it("leaves the status beside paging to a run when either one is read from an earlier step", () => {
    expect(
      refusedAt({
        path: fixed("a"),
        includeStatus: fromPath("item.extras.status"),
        pagination: fixed({ cursorPath: "n", cursorParam: "c" }),
      }),
    ).toEqual([]);
    expect(
      refusedAt({
        path: fixed("a"),
        includeStatus: fixed(true),
        pagination: fromPath("item.extras.paging"),
      }),
    ).toEqual([]);
    expect(
      refusedAt({
        path: fixed("a"),
        includeStatus: fixed(false),
        pagination: fixed({ cursorPath: "n", cursorParam: "c" }),
      }),
    ).toEqual([]);
  });
});
