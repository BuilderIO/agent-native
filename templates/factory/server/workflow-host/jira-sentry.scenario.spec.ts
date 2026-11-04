import { loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every operation here runs through the engine, the real operation executor,
// core's real guarded tool call and the real host actions. Only the audit
// store, the gate and the provider's HTTP answer are replaced, so no request
// leaves the machine and nothing is written to Jira or Sentry.
const auditRows = vi.hoisted(() => [] as Record<string, any>[]);
const providerMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../packages/core/dist/audit/store.js", async (original) => ({
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
vi.mock("../lib/factory-workflow-connections.js", () => ({
  readProviderConnections: vi.fn(async () => []),
}));

import * as assignSentryIssue from "../../actions/assign-sentry-issue.js";
import * as getJiraIssue from "../../actions/get-jira-issue.js";
import * as listJiraTransitions from "../../actions/list-jira-transitions.js";
import * as resolveSentryIssue from "../../actions/resolve-sentry-issue.js";
import * as transitionJiraIssue from "../../actions/transition-jira-issue.js";
import type { OperationExecutor } from "../workflow/adapter.js";
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
  "assign-sentry-issue": assignSentryIssue,
  "get-jira-issue": getJiraIssue,
  "list-jira-transitions": listJiraTransitions,
  "resolve-sentry-issue": resolveSentryIssue,
  "transition-jira-issue": transitionJiraIssue,
});

const testCatalog = buildTestCatalog();
const catalog: OperationCatalog = {
  get: (id) => testCatalog.get(id) ?? OPERATION_CATALOG.get(id),
};

/** A host whose source is the test fake and whose other operations run for real. */
async function setup(graph: ReturnType<typeof chain>) {
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
  const workflow = await seedWorkflow(test, graph);
  return { test, fake, id: workflow.id };
}

const response = (json: unknown, status = 200, path = "/") => ({
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

type Route = (args: Record<string, any>) => unknown;

/** Answers by method and path. A call nobody planned for is an error, so it shows up as one. */
function provider(routes: Record<string, Route>) {
  providerMock.mockImplementation(async (args: Record<string, any>) => {
    const route = routes[`${args.method} ${args.path}`];
    if (!route) throw new Error(`unplanned ${args.method} ${args.path}`);
    return route(args);
  });
}

const calls = () =>
  providerMock.mock.calls.map(([args]) => args as Record<string, any>);
const writes = () =>
  calls().filter((args) => args.method !== "GET" && args.method !== undefined);

const done = {
  id: "31",
  name: "Done",
  to: { id: "10002", name: "Done", statusCategory: { key: "done" } },
};
const reopen = { id: "21", name: "Reopen", to: { id: "1", name: "To Do" } };

function jiraIssue(
  status = { id: "3", name: "In Progress" },
  transitions: unknown[] = [done, reopen],
) {
  return {
    id: "10001",
    key: "PROJ-123",
    fields: {
      summary: "Checkout fails",
      status: { ...status, statusCategory: { key: "indeterminate" } },
      assignee: null,
      resolution: null,
      labels: ["bug"],
    },
    transitions,
  };
}

const ISSUE_PATH = "/rest/api/2/issue/PROJ-123";
const jiraRoutes = (extra: Record<string, Route> = {}) => ({
  [`GET ${ISSUE_PATH}`]: () => response(jiraIssue()),
  [`POST ${ISSUE_PATH}/transitions`]: () => response(undefined, 204),
  ...extra,
});

const offered = (extras: Record<string, unknown>) =>
  sourceResult([normalizedItem("a", { extras })]);

const lookup = (id: string, operation: string, args: Record<string, unknown>) =>
  [id, "lookup", { operation, args }] as NodeSpec;
const action = (id: string, operation: string, args: Record<string, unknown>) =>
  [id, "action", { operation, args }] as NodeSpec;

const moveToDone = (key = "item.extras.key") =>
  action("move", "jira.transitionIssue", {
    issueKey: fromPath(key),
    transition: fixed("Done"),
  });

beforeEach(() => {
  auditRows.length = 0;
  providerMock.mockReset();
});

afterEach(() => {
  // Whatever a step did, it only ever talked to its own provider, on a path
  // below the base URL: never a full URL.
  for (const args of calls()) {
    expect(["jira", "sentry"]).toContain(args.provider);
    expect(args.path).toMatch(/^\//);
    expect(args.path).not.toMatch(/https?:|\/\/|\.\./);
  }
});

describe("jira.getIssue and jira.listTransitions, run through the engine", () => {
  it("hands the issue's status and transition names to a rule in the next step, in a dry run", async () => {
    const { test, fake, id } = await setup(
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
          lookup("issue", "jira.getIssue", {
            issueKey: fromPath("item.extras.key"),
          }),
          lookup("moves", "jira.listTransitions", {
            issueKey: fromPath("item.extras.key"),
          }),
          [
            "ready",
            "filter",
            {
              combinator: "all",
              rules: [
                rule("nodes.issue.statusCategory", "equals", "indeterminate"),
                rule("nodes.issue.transitionNames", "contains", "Done"),
                rule("nodes.moves.count", "equals", 2),
              ],
            },
          ],
          ["done", "end", { outcome: "done" }],
          ["waiting", "end", { outcome: "dismissed", reason: "not ready" }],
        ],
        edges: [
          ["start", "out", "src"],
          ["src", "out", "issue"],
          ["issue", "out", "moves"],
          ["moves", "out", "ready"],
          ["ready", "match", "done"],
          ["ready", "otherwise", "waiting"],
        ],
      }) as never,
    );
    fake.script("test.items", offered({ key: "PROJ-123" }));
    provider({
      [`GET ${ISSUE_PATH}`]: () => response(jiraIssue()),
      [`GET ${ISSUE_PATH}/transitions`]: () =>
        response({ transitions: [done, reopen] }),
    });

    const result = await ran(test, id, { mode: "dry" });

    expect(result.run.counts).toMatchObject({ done: 1, itemFailures: 0 });
    expect(stepOf(result, "ready")).toMatchObject({
      ports: { match: { count: 1 } },
    });
    expect(calls().map((args) => `${args.method} ${args.path}`)).toEqual([
      `GET ${ISSUE_PATH}`,
      `GET ${ISSUE_PATH}/transitions`,
    ]);
    expect(writes()).toEqual([]);
  });

  it("fails the item typed when the key is not a key, and never calls Jira", async () => {
    const { test, fake, id } = await setup(
      chain([
        lookup("issue", "jira.getIssue", {
          issueKey: fromPath("item.extras.key"),
        }),
      ]),
    );
    fake.script(
      "test.items",
      offered({ key: "https://example.atlassian.net/browse/PROJ-1" }),
    );

    const result = await ran(test, id, { mode: "dry" });

    expect(providerMock).not.toHaveBeenCalled();
    expect(stepOf(result, "issue")).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("jira_issue_key_invalid") },
    });
    expect(result.run.counts.itemFailures).toBe(1);
  });

  it("says Jira is not connected when core has no credential to send", async () => {
    const { test, fake, id } = await setup(
      chain([
        lookup("issue", "jira.getIssue", {
          issueKey: fromPath("item.extras.key"),
        }),
      ]),
    );
    fake.script("test.items", offered({ key: "PROJ-123" }));
    providerMock.mockRejectedValue(
      new Error("jira requires an available workspace connection."),
    );

    const result = await ran(test, id, { mode: "dry" });

    expect(stepOf(result, "issue")).toMatchObject({
      status: "failed",
      error: { code: "credential_missing" },
    });
  });
});

describe("jira.transitionIssue, run through the engine", () => {
  const graph = () => chain([moveToDone()]);

  it("moves the issue in a live run: one read, one write, a receipt, and an audit row without a body", async () => {
    const { test, fake, id } = await setup(graph());
    fake.script("test.items", offered({ key: "PROJ-123" }));
    provider(jiraRoutes());

    const result = await ran(test, id);

    expect(calls().map((args) => `${args.method} ${args.path}`)).toEqual([
      `GET ${ISSUE_PATH}`,
      `POST ${ISSUE_PATH}/transitions`,
    ]);
    expect(writes()[0]?.body).toEqual({ transition: { id: "31" } });
    expect(stepOf(result, "move")).toMatchObject({ status: "succeeded" });
    expect(result.run.counts).toMatchObject({ done: 1, itemFailures: 0 });
    const effect = (await eventsOf(test, id, "a")).find(
      (event) => event.nodeId === "move" && event.kind === "effect",
    );
    expect(effect?.summary).toContain("called jira.transitionIssue");
    expect(effect?.summary).toContain("PROJ-123:Done");

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "transition-jira-issue",
      caller: "automation",
      targetType: "jira-issue",
      targetId: "PROJ-123",
      status: "success",
      summary: "POST jira /rest/api/2/issue/PROJ-123/transitions",
      input: null,
    });
    expect(JSON.stringify(auditRows[0])).not.toContain('transition":{');
    expect(JSON.stringify(auditRows[0])).not.toContain('"Done"');
  });

  it("succeeds without a write when the issue is already where the transition goes", async () => {
    const { test, fake, id } = await setup(
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
          moveToDone(),
          [
            "settled",
            "filter",
            {
              combinator: "all",
              rules: [rule("nodes.move.alreadyInState", "isTrue")],
            },
          ],
          ["done", "end", { outcome: "done" }],
          ["moved", "end", { outcome: "dismissed", reason: "it moved" }],
        ],
        edges: [
          ["start", "out", "src"],
          ["src", "out", "move"],
          ["move", "out", "settled"],
          ["settled", "match", "done"],
          ["settled", "otherwise", "moved"],
        ],
      }) as never,
    );
    fake.script("test.items", offered({ key: "PROJ-123" }));
    provider(
      jiraRoutes({
        [`GET ${ISSUE_PATH}`]: () =>
          response(jiraIssue({ id: "10002", name: "Done" }, [reopen])),
      }),
    );

    const result = await ran(test, id);

    expect(writes()).toEqual([]);
    expect(stepOf(result, "move")).toMatchObject({ status: "succeeded" });
    expect(stepOf(result, "settled")).toMatchObject({
      ports: { match: { count: 1 } },
    });
    expect(result.run.counts.itemFailures).toBe(0);
  });

  it("does not guess: an unknown name fails the item and sends nothing", async () => {
    const { test, fake, id } = await setup(
      chain([
        action("move", "jira.transitionIssue", {
          issueKey: fromPath("item.extras.key"),
          transition: fixed("Ship it"),
        }),
      ]),
    );
    fake.script("test.items", offered({ key: "PROJ-123" }));
    provider(jiraRoutes());

    const result = await ran(test, id);

    expect(writes()).toEqual([]);
    expect(stepOf(result, "move")).toMatchObject({
      status: "failed",
      error: {
        code: "provider_error",
        message: expect.stringContaining("jira_transition_not_found"),
      },
    });
    // Refusing is not a reason to ask again.
    expect(calls()).toHaveLength(1);
  });

  it("does not guess: an ambiguous name fails the item and sends nothing", async () => {
    const { test, fake, id } = await setup(graph());
    fake.script("test.items", offered({ key: "PROJ-123" }));
    provider(
      jiraRoutes({
        [`GET ${ISSUE_PATH}`]: () =>
          response(
            jiraIssue(undefined, [
              done,
              { id: "41", name: "done", to: { id: "10003", name: "Won't do" } },
            ]),
          ),
      }),
    );

    const result = await ran(test, id);

    expect(writes()).toEqual([]);
    expect(stepOf(result, "move").error?.message).toContain(
      "jira_transition_ambiguous",
    );
  });

  it("never reaches Jira with a key or a URL it should not accept", async () => {
    const { test, fake, id } = await setup(graph());
    fake.script(
      "test.items",
      offered({ key: "PROJ-123/../../../rest/api/2/myself" }),
    );

    const result = await ran(test, id);

    expect(providerMock).not.toHaveBeenCalled();
    expect(stepOf(result, "move")).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("jira_issue_key_invalid") },
    });
  });

  it("stops for a person, and never writes again, when the write's outcome is unknown", async () => {
    const { test, fake, id } = await setup(graph());
    fake.script("test.items", offered({ key: "PROJ-123" }));
    provider(
      jiraRoutes({
        [`POST ${ISSUE_PATH}/transitions`]: () => response({}, 502),
      }),
    );

    const first = await ran(test, id);
    fake.script("test.items", offered({ key: "PROJ-123" }));
    const second = await ran(test, id);

    expect(stepOf(first, "move")).toMatchObject({
      status: "needs_check",
      error: { code: "effect_needs_check" },
    });
    expect(stepOf(first, "move").error?.message).toContain(
      "provider_request_outcome_unknown",
    );
    expect(first.run.counts.done).toBe(0);
    expect(second.run.counts.done).toBe(0);
    expect(writes()).toHaveLength(1);
  });

  it("stops for a person when the connection drops after the request left", async () => {
    const { test, fake, id } = await setup(graph());
    fake.script("test.items", offered({ key: "PROJ-123" }));
    provider(
      jiraRoutes({
        [`POST ${ISSUE_PATH}/transitions`]: () => {
          throw new Error("fetch failed");
        },
      }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "move").error?.code).toBe("effect_needs_check");
    expect(writes()).toHaveLength(1);
  });

  it("sends nothing and says Jira is not connected when there is no credential", async () => {
    const { test, fake, id } = await setup(graph());
    fake.script("test.items", offered({ key: "PROJ-123" }));
    providerMock.mockRejectedValue(
      new Error("jira requires an available workspace connection."),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "move")).toMatchObject({
      status: "failed",
      error: { code: "credential_missing" },
    });
    expect(writes()).toEqual([]);
  });

  it("never writes in a dry run, and says what it would have sent", async () => {
    const { test, fake, id } = await setup(graph());
    fake.script("test.items", offered({ key: "PROJ-123" }));

    const result = await ran(test, id, { mode: "dry" });

    expect(providerMock).not.toHaveBeenCalled();
    expect(auditRows).toEqual([]);
    expect(stepOf(result, "move")).toMatchObject({
      status: "succeeded",
      fields: { wouldCallCount: 1 },
    });
  });

  it("never writes in a test of the step", async () => {
    const { test, id } = await setup(graph());

    const result = await ran(test, id, {
      mode: "test",
      testNodeId: "move",
      sampleItems: [
        { id: "s1", item: { extras: { key: "PROJ-123" } }, nodes: {} },
      ],
    });

    expect(providerMock).not.toHaveBeenCalled();
    expect(auditRows).toEqual([]);
    expect(stepOf(result, "move").fields).toMatchObject({ wouldCallCount: 1 });
  });
});

const SENTRY_ISSUE = "/organizations/acme/issues/4812/";
const sentryIssue = (extra: Record<string, unknown> = {}) => ({
  id: "4812",
  status: "resolved",
  assignedTo: null,
  permalink: "https://sentry.io/organizations/acme/issues/4812/",
  ...extra,
});
const resolveIt = () =>
  action("resolve", "sentry.resolveIssue", {
    issueId: fromPath("item.extras.issue"),
    orgSlug: fixed("acme"),
  });
const assignTeam = () =>
  action("assign", "sentry.assignIssue", {
    issueId: fromPath("item.extras.issue"),
    orgSlug: fixed("acme"),
    assigneeKind: fixed("team"),
    assignee: fixed("backend"),
  });

describe("sentry.resolveIssue, run through the engine", () => {
  it("resolves the issue in a live run with one PUT, a receipt that carries the link, and a path-only audit row", async () => {
    const { test, fake, id } = await setup(chain([resolveIt()]));
    fake.script("test.items", offered({ issue: "4812" }));
    provider({ [`PUT ${SENTRY_ISSUE}`]: () => response(sentryIssue()) });

    const result = await ran(test, id);

    expect(writes()).toHaveLength(1);
    expect(calls()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({
      provider: "sentry",
      method: "PUT",
      path: SENTRY_ISSUE,
      body: { status: "resolved" },
    });
    expect(stepOf(result, "resolve")).toMatchObject({ status: "succeeded" });
    const effect = (await eventsOf(test, id, "a")).find(
      (event) => event.nodeId === "resolve" && event.kind === "effect",
    );
    expect(effect?.summary).toContain("4812:resolved");
    expect(effect?.summary).toContain(
      "https://sentry.io/organizations/acme/issues/4812/",
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "resolve-sentry-issue",
      targetId: "4812",
      status: "success",
      summary: "PUT sentry /organizations/{orgSlug}/issues/4812/",
      input: null,
    });
    expect(JSON.stringify(auditRows[0])).not.toContain("resolvedInNextRelease");
  });

  it("stops for a person when Sentry does not say the issue is resolved", async () => {
    const { test, fake, id } = await setup(chain([resolveIt()]));
    fake.script("test.items", offered({ issue: "4812" }));
    provider({
      [`PUT ${SENTRY_ISSUE}`]: () =>
        response(sentryIssue({ status: "unresolved" })),
    });

    const result = await ran(test, id);

    expect(stepOf(result, "resolve").error?.code).toBe("effect_needs_check");
    expect(writes()).toHaveLength(1);
  });

  it("stops for a person, and never writes again, when the write's outcome is unknown", async () => {
    const { test, fake, id } = await setup(chain([resolveIt()]));
    fake.script("test.items", offered({ issue: "4812" }));
    provider({ [`PUT ${SENTRY_ISSUE}`]: () => response({}, 503) });

    const result = await ran(test, id);

    expect(stepOf(result, "resolve")).toMatchObject({
      status: "needs_check",
      error: { code: "effect_needs_check" },
    });
    expect(writes()).toHaveLength(1);
  });

  it.each([
    ["a path", "4812/events"],
    ["a full URL", "https://sentry.io/api/0/issues/4812/"],
    ["a short id", "WEB-1A"],
  ])("never reaches Sentry with %s as the id", async (_label, issue) => {
    const { test, fake, id } = await setup(chain([resolveIt()]));
    fake.script("test.items", offered({ issue }));

    const result = await ran(test, id);

    expect(providerMock).not.toHaveBeenCalled();
    expect(stepOf(result, "resolve")).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("sentry_input_invalid") },
    });
  });

  it("sends nothing and says Sentry is not connected when there is no credential", async () => {
    const { test, fake, id } = await setup(chain([resolveIt()]));
    fake.script("test.items", offered({ issue: "4812" }));
    providerMock.mockRejectedValue(
      new Error("sentry requires an available workspace connection."),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "resolve").error?.code).toBe("credential_missing");
  });

  it("never writes in a dry run or in a test of the step", async () => {
    const { test, fake, id } = await setup(chain([resolveIt()]));
    fake.script("test.items", offered({ issue: "4812" }));

    await ran(test, id, { mode: "dry" });
    await ran(test, id, {
      mode: "test",
      testNodeId: "resolve",
      sampleItems: [
        { id: "s1", item: { extras: { issue: "4812" } }, nodes: {} },
      ],
    });

    expect(providerMock).not.toHaveBeenCalled();
    expect(auditRows).toEqual([]);
  });
});

describe("sentry.assignIssue, run through the engine", () => {
  it("assigns a team in a live run: a read of the team, then one PUT, and a receipt", async () => {
    const { test, fake, id } = await setup(chain([assignTeam()]));
    fake.script("test.items", offered({ issue: "4812" }));
    provider({
      "GET /teams/acme/backend/": () => response({ id: "55", slug: "backend" }),
      [`PUT ${SENTRY_ISSUE}`]: () =>
        response(
          sentryIssue({
            assignedTo: { type: "team", id: "55", name: "backend" },
          }),
        ),
    });

    const result = await ran(test, id);

    expect(calls().map((args) => `${args.method} ${args.path}`)).toEqual([
      "GET /teams/acme/backend/",
      `PUT ${SENTRY_ISSUE}`,
    ]);
    expect(writes()[0]?.body).toEqual({ assignedTo: "team:55" });
    expect(stepOf(result, "assign")).toMatchObject({ status: "succeeded" });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "assign-sentry-issue",
      summary: "PUT sentry /organizations/{orgSlug}/issues/4812/",
      input: null,
    });
    expect(JSON.stringify(auditRows[0])).not.toContain("backend");
  });

  it("assigns a person by email, and unassigns", async () => {
    const { test, fake, id } = await setup(
      chain([
        action("assign", "sentry.assignIssue", {
          issueId: fromPath("item.extras.issue"),
          orgSlug: fixed("acme"),
          assigneeKind: fixed("user"),
          assignee: fixed("ada@example.test"),
        }),
        action("clear", "sentry.assignIssue", {
          issueId: fromPath("item.extras.issue"),
          orgSlug: fixed("acme"),
          assigneeKind: fixed("nobody"),
        }),
      ]),
    );
    fake.script("test.items", offered({ issue: "4812" }));
    let current: unknown = null;
    provider({
      [`PUT ${SENTRY_ISSUE}`]: (args) => {
        current =
          args.body.assignedTo === ""
            ? null
            : { type: "user", id: "7", name: "Ada Lovelace" };
        return response(sentryIssue({ assignedTo: current }));
      },
    });

    const result = await ran(test, id);

    expect(writes().map((args) => args.body)).toEqual([
      { assignedTo: "ada@example.test" },
      { assignedTo: "" },
    ]);
    expect(result.run.counts).toMatchObject({ done: 1, itemFailures: 0 });
  });

  it("refuses a team Sentry does not know, and sends nothing", async () => {
    const { test, fake, id } = await setup(chain([assignTeam()]));
    fake.script("test.items", offered({ issue: "4812" }));
    provider({
      "GET /teams/acme/backend/": () => response({ detail: "Not found" }, 404),
    });

    const result = await ran(test, id);

    expect(writes()).toEqual([]);
    expect(stepOf(result, "assign")).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("sentry_team_not_found") },
    });
  });

  it("stops for a person, and never writes again, when the write's outcome is unknown", async () => {
    const { test, fake, id } = await setup(chain([assignTeam()]));
    fake.script("test.items", offered({ issue: "4812" }));
    provider({
      "GET /teams/acme/backend/": () => response({ id: "55", slug: "backend" }),
      [`PUT ${SENTRY_ISSUE}`]: () => response({}, 500),
    });

    const result = await ran(test, id);

    expect(stepOf(result, "assign").error?.code).toBe("effect_needs_check");
    expect(writes()).toHaveLength(1);
  });

  it("never writes in a dry run or in a test of the step", async () => {
    const { test, fake, id } = await setup(chain([assignTeam()]));
    fake.script("test.items", offered({ issue: "4812" }));

    await ran(test, id, { mode: "dry" });
    await ran(test, id, {
      mode: "test",
      testNodeId: "assign",
      sampleItems: [
        { id: "s1", item: { extras: { issue: "4812" } }, nodes: {} },
      ],
    });

    expect(providerMock).not.toHaveBeenCalled();
    expect(auditRows).toEqual([]);
  });
});
