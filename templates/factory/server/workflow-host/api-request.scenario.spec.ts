import { loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Everything here runs through the engine, the real operation executor, core's
// real guarded tool call and the real `run-workflow-operation` action. Only the
// audit store, the gate and the provider's HTTP answer are replaced, so no
// request leaves the machine.
const auditRows = vi.hoisted(() => [] as Record<string, any>[]);
const providerMock = vi.hoisted(() => vi.fn());

vi.mock("@factory-test/audit-store", async (original) => ({
  ...(await original<object>()),
  insertAuditEvent: async (event: Record<string, any>) => {
    auditRows.push(event);
  },
}));
vi.mock("../lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: async () => undefined,
}));
vi.mock("../lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: async () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
    role: "member",
  }),
  workspaceMemberIdentityFromContext: () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
  }),
}));
vi.mock("../lib/factory-automation-resources.js", () => ({
  factoryIdFromAutomationName: (name: string) =>
    name.match(/^factories\/([^/]+)\//)?.[1] ?? null,
}));
vi.mock("../lib/provider-api.js", () => ({
  FACTORY_APP_ID: "factory",
  executeProviderApiRequest: providerMock,
}));

import * as runWorkflowOperation from "../../actions/run-workflow-operation.js";
import type { OperationExecutor } from "../workflow/adapter.js";
import { genericOperations } from "../workflow/catalog/generic.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { OperationCatalog } from "../workflow/operations.js";
import {
  buildGraph,
  fixed,
  fromPath,
  rule,
  type NodeSpec,
} from "../workflow/story-graphs.fixture.js";
import {
  chain,
  eventsOf,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
} from "../workflow/testing/engine-fixtures.js";
import { makeHost, seedWorkflow } from "../workflow/testing/make-host.js";
import { buildTestCatalog } from "../workflow/testing/test-catalog.js";
import { createOperationExecutor } from "./operation-executor.js";

const registry = loadActionsFromStaticRegistry({
  "run-workflow-operation": runWorkflowOperation,
});

const testCatalog = buildTestCatalog();
const catalog: OperationCatalog = {
  get: (id) => testCatalog.get(id) ?? OPERATION_CATALOG.get(id),
};

/** A host whose source is the test fake and whose other operations run for real. */
async function setup(graph: (id: string) => ReturnType<typeof chain>) {
  const test = makeHost({ catalog });
  const fake = test.operations;
  const real = createOperationExecutor({
    owner: "owner@example.test",
    orgId: test.scope.orgId,
    factoryId: test.scope.factoryId,
    automation: {
      triggerId: "job-1",
      triggerName: `factories/${test.scope.factoryId}/flow`,
    },
    runId: "run-1",
    signal: new AbortController().signal,
    deps: { actions: async () => registry },
  });
  const executor: OperationExecutor = {
    execute: (request) =>
      request.operation.provider === "test"
        ? fake.execute(request)
        : real.execute(request),
  };
  Object.assign(test.host, { operations: executor });
  const workflow = await seedWorkflow(test, graph("workflow"));
  return { test, fake, id: workflow.id };
}

const answer = (json: unknown, status = 200, path = "/things/42") => ({
  request: { method: "GET", path },
  response: {
    status,
    ok: status >= 200 && status < 300,
    truncated: false,
    size: 40,
    headers: { "content-type": "application/json" },
    json,
  },
});

const fetchNode = (
  provider: string,
  args: Record<string, unknown>,
): NodeSpec => [
  "fetch",
  "lookup",
  { operation: `${provider}.apiRequest`, args },
];

/** trigger -> source -> API request -> a filter on what the provider answered -> done or dismissed. */
function readThenRoute(provider: string, args: Record<string, unknown>) {
  return buildGraph({
    nodes: [
      ["start", "trigger", { schedule: { every: "5m" } }],
      [
        "src",
        "source",
        {
          source: "provider-query",
          operation: "test.items",
          args: {},
          memory: "inbox",
          maxItems: 50,
        },
      ],
      fetchNode(provider, args),
      [
        "healthy",
        "filter",
        {
          combinator: "all",
          rules: [rule("nodes.fetch.data[0].ready", "isTrue")],
        },
      ],
      ["done", "end", { outcome: "done" }],
      ["unready", "end", { outcome: "dismissed", reason: "not ready" }],
    ],
    edges: [
      ["start", "out", "src"],
      ["src", "out", "fetch"],
      ["fetch", "out", "healthy"],
      ["healthy", "match", "done"],
      ["healthy", "otherwise", "unready"],
    ],
  });
}

const offered = (endpoint: string) =>
  sourceResult([normalizedItem("a", { extras: { endpoint } })]);

/** The arguments the provider call at `index` was made with. */
function sent(index = 0): Record<string, unknown> {
  const call = providerMock.mock.calls[index];
  if (!call) throw new Error(`The provider was not called ${index + 1} times.`);
  return call[0] as Record<string, unknown>;
}

beforeEach(() => {
  auditRows.length = 0;
  providerMock.mockReset();
});

afterEach(() => {
  // Whatever a step did, it only ever read: a GET with no body.
  for (const [sent] of providerMock.mock.calls) {
    expect(sent.method).toBe("GET");
    expect(sent).not.toHaveProperty("body");
  }
});

describe.each(genericOperations.map((def) => def.provider))(
  "a %s API request, run through the engine",
  (provider) => {
    it("reads the typed path from the item, hands the provider's own JSON to the next step, and is audited by its path", async () => {
      const { test, fake, id } = await setup(() =>
        readThenRoute(provider, {
          path: fromPath("item.extras.endpoint"),
          query: fixed({ state: "open", "labels[]": ["a", "b"] }),
        }),
      );
      fake.script("test.items", offered("things/42"));
      providerMock.mockResolvedValue(
        answer({ data: [{ id: 1, ready: true }] }),
      );

      const result = await ran(test, id, { mode: "dry" });

      expect(providerMock).toHaveBeenCalledTimes(1);
      expect(sent()).toMatchObject({
        provider,
        method: "GET",
        path: "/things/42",
        query: { state: "open", "labels[]": ["a", "b"] },
        timeoutMs: 60_000,
      });
      expect(stepOf(result, "fetch")).toMatchObject({
        status: "succeeded",
        ports: { out: { count: 1, itemIds: ["a"] } },
      });
      // The answer is the provider's JSON, so a path into it reaches the next step.
      expect(stepOf(result, "healthy")).toMatchObject({
        ports: { match: { count: 1 } },
      });
      expect(result.run.counts).toMatchObject({ done: 1, itemFailures: 0 });
      expect(
        (await eventsOf(test, id, "a")).find(
          (event) => event.nodeId === "fetch" && event.kind === "output",
        )?.summary,
      ).toBe('fetch: {"data":[{"id":1,"ready":true}]}');

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        action: "run-workflow-operation",
        caller: "automation",
        targetId: `${provider}.apiRequest`,
        status: "success",
        summary: `GET ${provider} /things/42`,
        input: null,
      });
    });

    it("is tested on its own, once, with no run before it and no item", async () => {
      const { test, fake, id } = await setup(() =>
        chain([
          fetchNode(provider, {
            path: fixed("things/42"),
            headers: fixed({ "X-Request-Id": "try-1" }),
            timeoutSeconds: fixed(5),
          }),
        ]),
      );
      providerMock.mockResolvedValue(answer({ data: [] }));

      const result = await ran(test, id, { mode: "test", testNodeId: "fetch" });

      expect(fake.calls).toHaveLength(0);
      expect(providerMock).toHaveBeenCalledTimes(1);
      expect(sent()).toMatchObject({
        provider,
        path: "/things/42",
        headers: { "X-Request-Id": "try-1" },
        timeoutMs: 5_000,
      });
      expect(result.steps.map((step) => step.nodeId)).toEqual(["fetch"]);
      expect(stepOf(result, "fetch")).toMatchObject({
        status: "succeeded",
        fields: { in: 1 },
        ports: { out: { count: 1 } },
      });
      expect(auditRows.map((row) => row.summary)).toEqual([
        `GET ${provider} /things/42`,
      ]);
    });
  },
);

describe("an API request that goes wrong, through the engine", () => {
  const routed = (extra: Record<string, unknown>) =>
    setup(() =>
      readThenRoute("github", {
        path: fromPath("item.extras.endpoint"),
        ...extra,
      }),
    );

  it.each([
    ["a path that climbs out", "repos/../../admin", "unsafe_path_value"],
    ["a full URL", "https://evil.test/user", "full_url_refused"],
    ["a query smuggled into the path", "user?x=1", "unsafe_path_value"],
  ])(
    "fails the item for %s and never reaches the provider",
    async (_label, endpoint, code) => {
      const { test, fake, id } = await routed({});
      fake.script("test.items", offered(endpoint));

      const result = await ran(test, id, { mode: "dry" });

      expect(providerMock).not.toHaveBeenCalled();
      expect(stepOf(result, "fetch")).toMatchObject({
        status: "failed",
        error: {
          code: "lookup_failed",
          message: expect.stringContaining(code),
        },
        ports: { out: { count: 0 } },
      });
      expect(stepOf(result, "fetch").error?.message).not.toContain("evil.test");
      expect(result.run.counts.itemFailures).toBe(1);
      expect(result.clean).toBe(false);
    },
  );

  it("fails the item on a 404 without trying again, because the typed path will not mend", async () => {
    const { test, fake, id } = await routed({});
    fake.script("test.items", offered("no/such/thing"));
    providerMock.mockResolvedValue(answer({ message: "Not Found" }, 404));

    const result = await ran(test, id, { mode: "dry" });

    expect(providerMock).toHaveBeenCalledTimes(1);
    expect(stepOf(result, "fetch")).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("provider_not_found") },
    });
  });

  it("tries a 503 again, since a read may be repeated, and then fails the item", async () => {
    const { test, fake, id } = await routed({});
    fake.script("test.items", offered("things/42"));
    providerMock.mockResolvedValue(answer({}, 503));

    const result = await ran(test, id, { mode: "dry" });

    expect(providerMock.mock.calls.length).toBeGreaterThan(1);
    expect(stepOf(result, "fetch").status).toBe("failed");
    expect(stepOf(result, "fetch").error?.message).toContain(
      "provider_unavailable",
    );
  });

  it("says the provider is not connected when core has no credential to send", async () => {
    const { test, fake, id } = await routed({});
    fake.script("test.items", offered("things/42"));
    providerMock.mockRejectedValue(new Error("GitHub is not configured."));

    const result = await ran(test, id, { mode: "dry" });

    expect(stepOf(result, "fetch")).toMatchObject({
      status: "failed",
      error: { code: "credential_missing" },
    });
  });
});

describe("an API request offered to an AI step", () => {
  it("stops the run before any model is asked and before the provider is called", async () => {
    const graph = buildGraph({
      nodes: [
        ["start", "trigger", { schedule: { every: "5m" } }],
        [
          "assess",
          "ai",
          {
            instruction: "Decide.",
            result: { ok: { type: "boolean" } },
            mode: "perItem",
            tools: ["github.apiRequest"],
          },
        ],
        ["done", "end", { outcome: "done" }],
      ],
      edges: [
        ["start", "out", "assess"],
        ["assess", "out", "done"],
      ],
    });
    const { test, id } = await setup(() => graph as never);

    const result = await ran(test, id, { mode: "dry" });

    expect(result.run.status).toBe("failed");
    expect(result.run.error).toMatchObject({ code: "graph_invalid" });
    expect(result.run.error?.message).toContain("unknown_tool");
    expect(test.ai.requests).toHaveLength(0);
    expect(providerMock).not.toHaveBeenCalled();
  });
});

/** About what GitHub sends for one pull request: tens of kilobytes of nested data. */
const pull = (number: number) => ({
  id: number,
  number,
  title: `Pull request ${number}`,
  body: `${number}`.repeat(25_000),
  user: { login: "octocat" },
});

describe("an API request whose answer is cut, through the engine", () => {
  const cutGraph = (rules: ReturnType<typeof rule>[]) =>
    buildGraph({
      nodes: [
        ["start", "trigger", { schedule: { every: "5m" } }],
        [
          "src",
          "source",
          {
            source: "provider-query",
            operation: "test.items",
            args: {},
            memory: "inbox",
            maxItems: 50,
          },
        ],
        fetchNode("github", { path: fixed("repos/acme/web/pulls") }),
        ["cut", "filter", { combinator: "all", rules }],
        ["done", "end", { outcome: "done" }],
        ["whole", "end", { outcome: "dismissed", reason: "whole" }],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "fetch"],
        ["fetch", "out", "cut"],
        ["cut", "match", "done"],
        ["cut", "otherwise", "whole"],
      ],
    });

  it("is seen on the step, at nodes.<name>, and in the first words of what a person reads", async () => {
    const { test, fake, id } = await setup(
      () =>
        cutGraph([
          rule("nodes.fetch.truncated", "isTrue"),
          rule("nodes.fetch.totalAvailable", "equals", 3),
        ]) as never,
    );
    fake.script("test.items", offered("x"));
    providerMock.mockResolvedValue(answer([pull(1), pull(2), pull(3)]));

    const result = await ran(test, id, { mode: "dry" });

    // A path in a later step reads the flag and the count the provider sent.
    expect(result.run.counts.done).toBe(1);
    expect(stepOf(result, "cut")).toMatchObject({
      ports: { match: { count: 1 } },
    });
    // The step says so without anyone opening the answer.
    expect(stepOf(result, "fetch").fields).toMatchObject({
      outputsTruncated: 1,
    });
    // The summary a person reads is clipped, and the report comes first.
    const summary =
      (await eventsOf(test, id, "a")).find(
        (event) => event.nodeId === "fetch" && event.kind === "output",
      )?.summary ?? "";
    expect(summary.slice(0, 160)).toContain('"truncated":true');
    expect(summary.slice(0, 160)).toContain('"totalAvailable":3');
  });

  it("is seen the same way when the step is tested on its own", async () => {
    const { test, id } = await setup(() =>
      chain([fetchNode("github", { path: fixed("repos/acme/web/pulls") })]),
    );
    providerMock.mockResolvedValue(answer([pull(1), pull(2), pull(3)]));

    const result = await ran(test, id, { mode: "test", testNodeId: "fetch" });

    expect(stepOf(result, "fetch").fields).toMatchObject({
      outputsTruncated: 1,
    });
    const summary =
      (await eventsOf(test, id, "test-no-item")).find(
        (event) => event.nodeId === "fetch" && event.kind === "output",
      )?.summary ?? "";
    expect(summary.slice(0, 160)).toContain('"truncated":true');
  });

  it("says nothing was cut for an answer that fit", async () => {
    const { test, id } = await setup(() =>
      chain([fetchNode("github", { path: fixed("repos/acme/web/labels") })]),
    );
    providerMock.mockResolvedValue(
      answer([
        { id: 1, name: "bug" },
        { id: 2, name: "p1" },
      ]),
    );

    const result = await ran(test, id, { mode: "test", testNodeId: "fetch" });

    expect(stepOf(result, "fetch").fields).not.toHaveProperty(
      "outputsTruncated",
    );
  });
});

/** What a step handed on, read back from the summary a person reads (whole while it is under 1,500 characters). */
async function outputOf(
  test: Awaited<ReturnType<typeof setup>>["test"],
  workflowId: string,
  itemId = "test-no-item",
): Promise<{ text: string; json: any }> {
  const summary =
    (await eventsOf(test, workflowId, itemId)).find(
      (event) => event.nodeId === "fetch" && event.kind === "output",
    )?.summary ?? "";
  const text = summary.slice("fetch: ".length);
  return { text, json: JSON.parse(text) };
}

const KEEP = ["number", "title", "user.login"];
const KEPT = (number: number) => ({
  number,
  title: `Pull request ${number}`,
  user: { login: "octocat" },
});

describe("an API request that keeps only some fields, through the engine", () => {
  const pulls = [pull(1), pull(2), pull(3)];
  const testNode = (args: Record<string, unknown>) =>
    setup(() => chain([fetchNode("github", args)]));

  it("keeps all three of three 25 KB pull requests in under 1 KB, where the same answer is cut without it", async () => {
    const { test, id } = await testNode({
      path: fixed("repos/acme/web/pulls"),
      fieldsToKeep: fixed(KEEP),
    });
    providerMock.mockResolvedValue(answer(pulls));

    const result = await ran(test, id, { mode: "test", testNodeId: "fetch" });

    const { text, json } = await outputOf(test, id);
    expect(json).toEqual([KEPT(1), KEPT(2), KEPT(3)]);
    expect(text.length).toBeLessThan(1_000);
    expect(stepOf(result, "fetch").fields).not.toHaveProperty(
      "outputsTruncated",
    );
    expect(stepOf(result, "fetch").status).toBe("succeeded");

    // The control: the same answer with nothing to keep is cut as it always was.
    providerMock.mockClear();
    const plain = await testNode({ path: fixed("repos/acme/web/pulls") });
    providerMock.mockResolvedValue(answer(pulls));
    const cut = await ran(plain.test, plain.id, {
      mode: "test",
      testNodeId: "fetch",
    });
    expect(stepOf(cut, "fetch").fields).toMatchObject({ outputsTruncated: 1 });
  });

  it("asks the provider for exactly what it asked for before: keeping fields trims after the answer, not the request", async () => {
    const { test, id } = await testNode({
      path: fixed("repos/acme/web/pulls"),
      query: fixed({ state: "open" }),
      fieldsToKeep: fixed(KEEP),
    });
    providerMock.mockResolvedValue(answer(pulls));

    await ran(test, id, { mode: "test", testNodeId: "fetch" });

    expect(sent()).toMatchObject({
      path: "/repos/acme/web/pulls",
      query: { state: "open" },
    });
    expect(sent()).not.toHaveProperty("fieldsToKeep");
  });

  it("names a path that matched nothing, beside the data it kept", async () => {
    const { test, id } = await testNode({
      path: fixed("repos/acme/web/pulls/1"),
      fieldsToKeep: fixed(["number", "tittle", "user.logon"]),
    });
    providerMock.mockResolvedValue(answer(pull(1)));

    const result = await ran(test, id, { mode: "test", testNodeId: "fetch" });

    const { json } = await outputOf(test, id);
    expect(json).toEqual({
      fieldsMissing: ["tittle", "user.logon"],
      number: 1,
    });
    expect(Object.keys(json).slice(0, 2)).toEqual(["fieldsMissing", "number"]);
    expect(stepOf(result, "fetch").status).toBe("succeeded");
  });

  it("wraps a list that has a missing path as value, with the report first", async () => {
    const { test, id } = await testNode({
      path: fixed("repos/acme/web/pulls"),
      fieldsToKeep: fixed(["number", "tittle"]),
    });
    providerMock.mockResolvedValue(answer(pulls));

    await ran(test, id, { mode: "test", testNodeId: "fetch" });

    const { json } = await outputOf(test, id);
    expect(Object.keys(json)).toEqual(["fieldsMissing", "value"]);
    expect(json.fieldsMissing).toEqual(["tittle"]);
    expect(json.value).toEqual([{ number: 1 }, { number: 2 }, { number: 3 }]);
  });

  it("keeps the provider's refusal beside an empty trim, so it never reads as a typo in a path", async () => {
    const { test, id } = await setup(() =>
      chain([
        [
          "fetch",
          "lookup",
          {
            operation: "slack.apiRequest",
            args: {
              path: fixed("conversations.list"),
              fieldsToKeep: fixed(["channels.name"]),
            },
          },
        ],
      ]),
    );
    providerMock.mockResolvedValue(
      answer({ ok: false, error: "missing_scope", channels: [] }),
    );

    const result = await ran(test, id, { mode: "test", testNodeId: "fetch" });

    const { json } = await outputOf(test, id);
    expect(json).toEqual({
      fieldsMissing: ["channels.name"],
      ok: false,
      error: "missing_scope",
    });
    expect(stepOf(result, "fetch").status).toBe("succeeded");
  });

  it("lets the next step read the kept fields at their usual path", async () => {
    const { test, fake, id } = await setup(
      () =>
        buildGraph({
          nodes: [
            ["start", "trigger", { schedule: { every: "5m" } }],
            [
              "src",
              "source",
              {
                source: "provider-query",
                operation: "test.items",
                args: {},
                memory: "inbox",
                maxItems: 50,
              },
            ],
            fetchNode("github", {
              path: fixed("repos/acme/web/pulls"),
              fieldsToKeep: fixed(KEEP),
            }),
            [
              "third",
              "filter",
              {
                combinator: "all",
                rules: [
                  rule("nodes.fetch[2].number", "equals", 3),
                  rule("nodes.fetch[2].user.login", "equals", "octocat"),
                  rule("nodes.fetch[0].title", "equals", "Pull request 1"),
                ],
              },
            ],
            ["done", "end", { outcome: "done" }],
            ["other", "end", { outcome: "dismissed", reason: "no" }],
          ],
          edges: [
            ["start", "out", "src"],
            ["src", "out", "fetch"],
            ["fetch", "out", "third"],
            ["third", "match", "done"],
            ["third", "otherwise", "other"],
          ],
        }) as never,
    );
    fake.script("test.items", offered("x"));
    providerMock.mockResolvedValue(answer(pulls));

    const result = await ran(test, id, { mode: "dry" });

    expect(result.run.counts).toMatchObject({ done: 1, itemFailures: 0 });
  });

  it("lets three big requests in a row pass the step cap, which they fail without it", async () => {
    const big = { id: 1, body: "x".repeat(25_000) };
    const chained = (fieldsToKeep: Record<string, unknown>) =>
      setup(() =>
        chain(
          ["fetch1", "fetch2", "fetch3"].map((name) => [
            name,
            "lookup",
            {
              operation: "github.apiRequest",
              args: { path: fixed("repos/acme/web/pulls"), ...fieldsToKeep },
            },
          ]),
        ),
      );
    const { test, fake, id } = await chained({ fieldsToKeep: fixed(["id"]) });
    fake.script("test.items", offered("x"));
    providerMock.mockResolvedValue(answer(big));

    const result = await ran(test, id, { mode: "dry" });

    expect(stepOf(result, "fetch3").status).toBe("succeeded");
    expect(result.run.counts.itemFailures).toBe(0);
    expect(providerMock).toHaveBeenCalledTimes(3);
  });

  it("trims the entries of a paged read, so two pages of three fit", async () => {
    const six = [1, 2, 3, 4, 5, 6].map(pull);
    const paging = {
      cursorPath: "next",
      cursorParam: "after",
      itemsPath: "data",
    };
    const paged = {
      pagesRead: 2,
      totalItems: 6,
      lastStatus: 200,
      truncated: false,
      nextCursor: null,
      items: six,
    };
    const { test, id } = await testNode({
      path: fixed("repos/acme/web/pulls"),
      pagination: fixed(paging),
      fieldsToKeep: fixed(KEEP),
    });
    providerMock.mockResolvedValue(paged);

    const result = await ran(test, id, { mode: "test", testNodeId: "fetch" });

    expect(sent()).toMatchObject({
      fetchAllPages: { cursorPath: "next", cursorParam: "after" },
    });
    const { json, text } = await outputOf(test, id);
    expect(json).toEqual({
      pagesRead: 2,
      moreAvailable: false,
      nextCursor: null,
      items: [1, 2, 3, 4, 5, 6].map(KEPT),
    });
    expect(text.length).toBeLessThan(1_500);
    expect(stepOf(result, "fetch").fields).not.toHaveProperty(
      "outputsTruncated",
    );

    // The control: the same two pages with nothing to keep lose most of their entries.
    const plain = await testNode({
      path: fixed("repos/acme/web/pulls"),
      pagination: fixed(paging),
    });
    const cut = await ran(plain.test, plain.id, {
      mode: "test",
      testNodeId: "fetch",
    });
    expect(stepOf(cut, "fetch").fields).toMatchObject({ outputsTruncated: 1 });
  });

  it("keeps the status and the headers as they were when only the body is trimmed", async () => {
    const { test, id } = await testNode({
      path: fixed("repos/acme/web/pulls"),
      includeStatus: fixed(true),
      fieldsToKeep: fixed(["number", "user.login", "nope"]),
    });
    providerMock.mockResolvedValue({
      request: { method: "GET", path: "/repos/acme/web/pulls" },
      response: {
        status: 200,
        ok: true,
        truncated: false,
        size: 80_000,
        headers: {
          "content-type": "application/json",
          etag: '"abc"',
          "x-ratelimit-remaining": "58",
          "set-cookie": "session=abc",
        },
        json: pulls,
      },
    });

    await ran(test, id, { mode: "test", testNodeId: "fetch" });

    const { json } = await outputOf(test, id);
    expect(json).toEqual({
      fieldsMissing: ["nope"],
      status: 200,
      headers: {
        "content-type": "application/json",
        etag: '"abc"',
        "x-ratelimit-remaining": "58",
      },
      body: [1, 2, 3].map((number) => ({ number, user: { login: "octocat" } })),
    });
    expect(Object.keys(json)).toEqual([
      "fieldsMissing",
      "status",
      "headers",
      "body",
    ]);
  });
});

describe("a chain of big API requests, through the engine", () => {
  it("fails the step that passes the cap, naming it and the answers it carries", async () => {
    const big = { id: 1, body: "x".repeat(25_000) };
    const { test, fake, id } = await setup(() =>
      chain(
        ["fetch1", "fetch2", "fetch3"].map((name) => [
          name,
          "lookup",
          {
            operation: "github.apiRequest",
            args: { path: fixed("repos/acme/web/pulls") },
          },
        ]),
      ),
    );
    fake.script("test.items", offered("x"));
    providerMock.mockResolvedValue(answer(big));

    const result = await ran(test, id, { mode: "dry" });

    expect(stepOf(result, "fetch2").status).toBe("succeeded");
    const failed = stepOf(result, "fetch3");
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("output_over_cap");
    expect(failed.error?.message).toContain('"fetch3"');
    expect(failed.error?.message).toContain("nodes.fetch1");
    expect(failed.error?.message).toContain("nodes.fetch2");
    expect(failed.error?.message).toMatch(/narrow the request/i);
    expect(result.run.error?.message).toBe(failed.error?.message);
    expect(providerMock).toHaveBeenCalledTimes(3);
  });
});

describe("a refused API request never reaches the provider", () => {
  // Each value arrives from the item, as it would from an earlier step, so the
  // run's own checks are the ones that refuse it.
  const refusals: [
    string,
    Record<string, unknown>,
    Record<string, unknown>,
    string,
  ][] = [
    [
      "a full URL",
      { path: fromPath("item.extras.endpoint") },
      { endpoint: "https://evil.test/user" },
      "full_url_refused",
    ],
    [
      "a path that climbs out",
      { path: fromPath("item.extras.endpoint") },
      { endpoint: "repos/../../admin" },
      "unsafe_path_value",
    ],
    [
      "an encoded dot-dot",
      { path: fromPath("item.extras.endpoint") },
      { endpoint: "%2e%2e/admin" },
      "unsafe_path_value",
    ],
    [
      "a query in the path",
      { path: fromPath("item.extras.endpoint") },
      { endpoint: "user?x=1" },
      "unsafe_path_value",
    ],
    [
      "an empty segment",
      { path: fromPath("item.extras.endpoint") },
      { endpoint: "repos//admin" },
      "unsafe_path_value",
    ],
    [
      "an Authorization header",
      { path: fixed("user"), headers: fromPath("item.extras.headers") },
      { headers: { Authorization: "Bearer x" } },
      "header_denied",
    ],
    [
      "an api-key header",
      { path: fixed("user"), headers: fromPath("item.extras.headers") },
      { headers: { "X-Api-Key": "k" } },
      "header_denied",
    ],
    [
      "a bad query",
      { path: fixed("user"), query: fromPath("item.extras.query") },
      { query: { "a b": 1 } },
      "invalid_query",
    ],
    [
      "a timeout of zero",
      { path: fixed("user"), timeoutSeconds: fromPath("item.extras.seconds") },
      { seconds: 0 },
      "invalid_timeout",
    ],
    [
      "a timeout over a minute",
      { path: fixed("user"), timeoutSeconds: fromPath("item.extras.seconds") },
      { seconds: 61 },
      "invalid_timeout",
    ],
    [
      "paging with no cursor parameter",
      { path: fixed("user"), pagination: fromPath("item.extras.paging") },
      { paging: { cursorPath: "next" } },
      "invalid_pagination",
    ],
    [
      "more pages than the cap",
      { path: fixed("user"), pagination: fromPath("item.extras.paging") },
      { paging: { cursorPath: "n", cursorParam: "c", maxPages: 50 } },
      "invalid_pagination",
    ],
    [
      "an empty list of paths to keep",
      { path: fixed("user"), fieldsToKeep: fromPath("item.extras.keep") },
      { keep: [] },
      "invalid_fields_to_keep",
    ],
    [
      "a path to keep that reaches a prototype",
      { path: fixed("user"), fieldsToKeep: fromPath("item.extras.keep") },
      { keep: ["user.__proto__"] },
      "invalid_fields_to_keep",
    ],
    [
      "a path to keep with an empty part",
      { path: fixed("user"), fieldsToKeep: fromPath("item.extras.keep") },
      { keep: ["a..b"] },
      "invalid_fields_to_keep",
    ],
    [
      "paths to keep that are one text",
      { path: fixed("user"), fieldsToKeep: fromPath("item.extras.keep") },
      { keep: "number,title" },
      "invalid_fields_to_keep",
    ],
  ];

  it.each(refusals)(
    "%s: the provider is never called, and the audit row says what was asked",
    async (_label, args, extras, code) => {
      const { test, fake, id } = await setup(() =>
        chain([fetchNode("github", args)]),
      );
      fake.script(
        "test.items",
        sourceResult([normalizedItem("a", { extras })]),
      );

      const result = await ran(test, id, { mode: "dry" });

      expect(providerMock).not.toHaveBeenCalled();
      expect(stepOf(result, "fetch").error?.message).toContain(`(${code})`);
      expect(stepOf(result, "fetch")).toMatchObject({
        ports: { out: { count: 0 } },
      });
      // Refused once, not retried.
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.status).not.toBe("success");
      expect(String(auditRows[0]?.summary)).toMatch(/^GET github \//);
    },
  );

  it("includes a status request beside paging, which is refused as incompatible", async () => {
    const { test, fake, id } = await setup(() =>
      chain([
        fetchNode("github", {
          path: fixed("user"),
          includeStatus: fromPath("item.extras.status"),
          pagination: fromPath("item.extras.paging"),
        }),
      ]),
    );
    fake.script(
      "test.items",
      sourceResult([
        normalizedItem("a", {
          extras: {
            status: true,
            paging: { cursorPath: "n", cursorParam: "c" },
          },
        }),
      ]),
    );

    const result = await ran(test, id, { mode: "dry" });

    expect(providerMock).not.toHaveBeenCalled();
    expect(stepOf(result, "fetch").error?.message).toContain(
      "(incompatible_fields)",
    );
  });
});
