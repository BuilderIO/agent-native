import { loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every operation here runs through the engine, the real operation executor,
// core's real guarded tool call, the real host actions, the real GitHub and
// Slack clients and the real Slack write path. Only the audit store, the gate,
// the credential resolver and the network (`fetch`) are replaced, so no request
// leaves the machine and nothing is written to GitHub or Slack.
const auditRows = vi.hoisted(() => [] as Record<string, any>[]);
const fetchMock = vi.hoisted(() => vi.fn());
const secretMock = vi.hoisted(() => vi.fn());
const repositoryMock = vi.hoisted(() => vi.fn());

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
vi.mock("../connectors/credentials.js", () => ({
  resolveConnectorSecret: secretMock,
}));
vi.mock("../db/index.js", () => ({ getDb: () => ({}) }));
vi.mock("../lib/factory-repository-scope.js", () => ({
  resolveFactoryRepository: repositoryMock,
}));
vi.mock("../connectors/slack-workflow.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../connectors/slack-workflow.js")>()),
  resolveFactorySlackWorkspace: async () => "primary",
}));

import * as addGithubLabels from "../../actions/add-github-labels.js";
import * as addSlackReaction from "../../actions/add-slack-reaction.js";
import * as removeGithubLabel from "../../actions/remove-github-label.js";
import type { OperationExecutor } from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import { validateWorkflowGraph } from "../workflow/graph-validation.js";
import {
  isModelToolAllowed,
  isWriteAllowedForNode,
  type OperationCatalog,
} from "../workflow/operations.js";
import {
  aiWritten,
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
  "add-github-labels": addGithubLabels,
  "add-slack-reaction": addSlackReaction,
  "remove-github-label": removeGithubLabel,
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

interface Hit {
  method: string;
  url: string;
  body: Record<string, any> | undefined;
  authorization: string | null;
}
const hits: Hit[] = [];

const answer = (json: unknown, status = 200) =>
  new Response(JSON.stringify(json), { status });

const LABELS = "https://api.github.com/repos/acme/web/issues/12/labels";
const REACT = "https://slack.com/api/reactions.add";
const AUTH_TEST = "https://slack.com/api/auth.test";

const botIdentity = () =>
  answer({
    ok: true,
    user_id: "UBOT",
    user: "agent-native",
    team_id: "T1",
    team: "Builder",
  });

type Route = (hit: Hit) => Response | Promise<Response>;

/** Answers by method and URL. A call nobody planned for is an error, so it shows up as one. */
function web(routes: Record<string, Route>) {
  fetchMock.mockImplementation(
    async (input: unknown, init?: RequestInit): Promise<Response> => {
      const hit: Hit = {
        method: init?.method ?? "GET",
        url: String(input),
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, any>)
            : undefined,
        authorization: new Headers(init?.headers).get("authorization"),
      };
      hits.push(hit);
      const route = routes[`${hit.method} ${hit.url}`];
      if (!route) throw new Error(`unplanned ${hit.method} ${hit.url}`);
      return route(hit);
    },
  );
}

const writes = () =>
  hits.filter((hit) => hit.method !== "GET" && hit.method !== undefined);

const offered = (extras: Record<string, unknown>) =>
  sourceResult([normalizedItem("a", { title: "Checkout fails", extras })]);
const ITEM = { repo: "acme/web", number: 12, emoji: "eyes" };

const action = (id: string, operation: string, args: Record<string, unknown>) =>
  [id, "action", { operation, args }] as NodeSpec;

const addLabels = (extra: Record<string, unknown> = {}) =>
  action("label", "github.addLabels", {
    repo: fromPath("item.extras.repo"),
    number: fromPath("item.extras.number"),
    labels: fixed(["triage", "Bug"]),
    ...extra,
  });
const removeLabel = (extra: Record<string, unknown> = {}) =>
  action("unlabel", "github.removeLabel", {
    repo: fromPath("item.extras.repo"),
    number: fromPath("item.extras.number"),
    label: fixed("needs-triage"),
    ...extra,
  });
const react = (extra: Record<string, unknown> = {}) =>
  action("react", "slack.addReaction", {
    channel: fixed("C0123ABCD"),
    ts: fromPath("item.extras.ts"),
    name: fixed("eyes"),
    ...extra,
  });

beforeEach(() => {
  auditRows.length = 0;
  hits.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  repositoryMock.mockReset().mockResolvedValue("acme/web");
  secretMock.mockReset();
  secretMock.mockImplementation(async (key: string) =>
    key === "GITHUB_TOKEN"
      ? "github-test-token"
      : key === "SLACK_BOT_TOKEN"
        ? "slack-test-token"
        : undefined,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Whatever a step did, it only talked to GitHub's or Slack's own API host,
  // and never with a URL, a query or a path that climbs out of what it asked for.
  for (const hit of hits) {
    expect(hit.url).toMatch(
      /^https:\/\/(api\.github\.com\/repos\/[\w.-]+\/[\w.-]+\/issues\/\d+\/labels(\/[\w.%-]+)?|slack\.com\/api\/(auth\.test|reactions\.add))$/,
    );
  }
});

const effectOf = async (
  test: Awaited<ReturnType<typeof setup>>["test"],
  id: string,
  nodeId: string,
) =>
  (await eventsOf(test, id, "a")).find(
    (event) => event.nodeId === nodeId && event.kind === "effect",
  );

describe("the three writes are steps for Action nodes only", () => {
  it.each(["github.addLabels", "github.removeLabel", "slack.addReaction"])(
    "%s runs on an action node, never as a read, a source or an AI tool",
    (id) => {
      const def = OPERATION_CATALOG.get(id)!;

      expect(def.effect).toBe("write");
      expect(isWriteAllowedForNode(def, "action")).toBe(true);
      for (const kind of ["lookup", "source"] as const) {
        expect(isWriteAllowedForNode(def, kind)).toBe(false);
      }
      expect(isModelToolAllowed(def)).toBe(false);
      expect(def.receipt).toBeDefined();
    },
  );

  it("lets a model write the emoji name, and nothing that decides where a write lands", () => {
    const issues = (op: string, args: Record<string, unknown>) =>
      validateWorkflowGraph(
        buildGraph({
          nodes: [["step", "action", { operation: op, args }]],
          edges: [],
        }),
        OPERATION_CATALOG,
      ).issues.filter((issue) => issue.code === "model_written_target");

    expect(
      issues("slack.addReaction", {
        channel: fixed("C0123ABCD"),
        ts: fixed("1700000000.000100"),
        name: aiWritten("Pick a fitting emoji."),
      }),
    ).toEqual([]);
    for (const [op, args] of [
      ["github.addLabels", { repo: aiWritten("pick") }],
      ["github.addLabels", { number: aiWritten("pick") }],
      ["github.addLabels", { labels: aiWritten("pick") }],
      ["github.removeLabel", { repo: aiWritten("pick") }],
      ["github.removeLabel", { number: aiWritten("pick") }],
      ["github.removeLabel", { label: aiWritten("pick") }],
      ["slack.addReaction", { channel: aiWritten("pick") }],
      ["slack.addReaction", { ts: aiWritten("pick") }],
    ] as const) {
      expect(issues(op, args), `${op} ${Object.keys(args)[0]}`).toHaveLength(1);
    }
  });
});

describe("github.addLabels and github.removeLabel, run through the engine", () => {
  it("adds the labels in a live run: one POST of the list, a receipt derived from where and what, and a path-only audit row", async () => {
    const { test, fake, id } = await setup(chain([addLabels()]));
    fake.script("test.items", offered(ITEM));
    web({
      [`POST ${LABELS}`]: () =>
        answer([{ name: "triage" }, { name: "Bug" }, { name: "p1" }]),
    });

    const result = await ran(test, id);

    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({
      authorization: "Bearer github-test-token",
      body: { labels: ["triage", "Bug"] },
    });
    expect(stepOf(result, "label")).toMatchObject({ status: "succeeded" });
    expect((await effectOf(test, id, "label"))?.summary).toBe(
      "called github.addLabels -> acme/web#12+bug,triage",
    );
    expect(auditRows[0]).toMatchObject({
      action: "add-github-labels",
      summary: "POST github /repos/acme/web/issues/12/labels",
      targetId: "acme/web#12",
      input: null,
    });
    expect(JSON.stringify(auditRows)).not.toContain("triage");
  });

  it("hands the labels the item now has to the next step", async () => {
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
          addLabels(),
          [
            "known",
            "filter",
            {
              combinator: "all",
              rules: [rule("nodes.label.labels", "contains", "p1")],
            },
          ],
          ["done", "end", { outcome: "done" }],
          ["other", "end", { outcome: "dismissed", reason: "no p1" }],
        ],
        edges: [
          ["start", "out", "src"],
          ["src", "out", "label"],
          ["label", "out", "known"],
          ["known", "match", "done"],
          ["known", "otherwise", "other"],
        ],
      }) as never,
    );
    fake.script("test.items", offered(ITEM));
    web({
      [`POST ${LABELS}`]: () =>
        answer([{ name: "triage" }, { name: "Bug" }, { name: "p1" }]),
    });

    const result = await ran(test, id);

    expect(stepOf(result, "known")).toMatchObject({
      ports: { match: { count: 1 } },
    });
  });

  it("never writes labels in a dry run or a test of the step", async () => {
    const dry = await setup(chain([addLabels()]));
    dry.fake.script("test.items", offered(ITEM));
    const dryResult = await ran(dry.test, dry.id, { mode: "dry" });
    const tested = await setup(chain([removeLabel()]));
    const testResult = await ran(tested.test, tested.id, {
      mode: "test",
      testNodeId: "unlabel",
      sampleItems: [{ id: "s1", item: { extras: ITEM }, nodes: {} }],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(auditRows).toEqual([]);
    expect(stepOf(dryResult, "label")).toMatchObject({
      status: "succeeded",
      fields: { wouldCallCount: 1 },
    });
    expect(stepOf(testResult, "unlabel")).toMatchObject({
      status: "succeeded",
      fields: { wouldCallCount: 1 },
    });
  });

  it.each([
    ["no label", { labels: fixed([]) }, ITEM, "github_label_invalid"],
    [
      "a comma in a label",
      { labels: fixed(["a,b"]) },
      ITEM,
      "github_label_invalid",
    ],
    [
      "more labels than a step adds",
      { labels: fixed(["a", "b", "c", "d", "e", "f"]) },
      ITEM,
      "github_label_invalid",
    ],
    [
      "a URL for the repository",
      {},
      { ...ITEM, repo: "https://github.com/acme/web" },
      "github_repository_invalid",
    ],
  ])(
    "fails the item for %s, typed, and never reaches GitHub",
    async (_label, args, extras, code) => {
      const { test, fake, id } = await setup(chain([addLabels(args)]));
      fake.script("test.items", offered(extras));

      const result = await ran(test, id);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(stepOf(result, "label")).toMatchObject({
        status: "failed",
        error: { message: expect.stringContaining(code) },
      });
    },
  );

  it.each([
    ["labels that are not a list", fixed("triage")],
    ["a label that is not text", fixed([1])],
  ])(
    "fails the item for %s on the action's own input check, and never reaches GitHub",
    async (_label, labels) => {
      const { test, fake, id } = await setup(chain([addLabels({ labels })]));
      fake.script("test.items", offered(ITEM));

      const result = await ran(test, id);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(stepOf(result, "label")).toMatchObject({
        status: "failed",
        error: {
          message: expect.stringContaining("Invalid action parameters"),
        },
      });
      expect(result.run.counts.itemFailures).toBe(1);
    },
  );

  it("is github_access_denied for a connection without write access, and the labels are asked for once", async () => {
    const { test, fake, id } = await setup(chain([addLabels()]));
    fake.script("test.items", offered(ITEM));
    web({
      [`POST ${LABELS}`]: () =>
        answer({ message: "Resource not accessible by integration" }, 403),
    });

    const result = await ran(test, id);

    expect(writes()).toHaveLength(1);
    expect(stepOf(result, "label")).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("github_access_denied") },
    });
  });

  it("stops for a person when GitHub's answer does not show a label that was asked for", async () => {
    const { test, fake, id } = await setup(chain([addLabels()]));
    fake.script("test.items", offered(ITEM));
    web({ [`POST ${LABELS}`]: () => answer([{ name: "triage" }]) });

    const result = await ran(test, id);

    expect(stepOf(result, "label").error?.code).toBe("effect_needs_check");
    expect(writes()).toHaveLength(1);
  });

  it("removes a label in a live run, by a path that holds the encoded name", async () => {
    const { test, fake, id } = await setup(
      chain([removeLabel({ label: fixed("area/ui team") })]),
    );
    fake.script("test.items", offered(ITEM));
    web({
      [`DELETE ${LABELS}/area%2Fui%20team`]: () => answer([{ name: "keep" }]),
    });

    const result = await ran(test, id);

    expect(writes()).toHaveLength(1);
    expect(stepOf(result, "unlabel")).toMatchObject({ status: "succeeded" });
    expect((await effectOf(test, id, "unlabel"))?.summary).toBe(
      "called github.removeLabel -> acme/web#12-area/ui team",
    );
    expect(auditRows[0]).toMatchObject({
      action: "remove-github-label",
      summary:
        "DELETE github /repos/acme/web/issues/12/labels/area%2Fui%20team",
      input: null,
    });
  });

  it("succeeds with alreadyAbsent when the item never had the label, and a rule can read it", async () => {
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
          removeLabel(),
          [
            "absent",
            "filter",
            {
              combinator: "all",
              rules: [rule("nodes.unlabel.alreadyAbsent", "isTrue")],
            },
          ],
          ["done", "end", { outcome: "done" }],
          ["removed", "end", { outcome: "dismissed", reason: "it was there" }],
        ],
        edges: [
          ["start", "out", "src"],
          ["src", "out", "unlabel"],
          ["unlabel", "out", "absent"],
          ["absent", "match", "done"],
          ["absent", "otherwise", "removed"],
        ],
      }) as never,
    );
    fake.script("test.items", offered(ITEM));
    web({
      [`DELETE ${LABELS}/needs-triage`]: () =>
        answer({ message: "Label does not exist" }, 404),
    });

    const result = await ran(test, id);

    expect(stepOf(result, "unlabel")).toMatchObject({ status: "succeeded" });
    expect(stepOf(result, "absent")).toMatchObject({
      ports: { match: { count: 1 } },
    });
    expect(result.run.counts.itemFailures).toBe(0);
  });

  it("fails a missing issue as not found, which is not a label the item lacked", async () => {
    const { test, fake, id } = await setup(chain([removeLabel()]));
    fake.script("test.items", offered(ITEM));
    web({
      [`DELETE ${LABELS}/needs-triage`]: () =>
        answer({ message: "Not Found" }, 404),
    });

    const result = await ran(test, id);

    expect(stepOf(result, "unlabel")).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("github_not_found") },
    });
  });
});

describe("the label writes and the factory's repository, through the engine", () => {
  const steps = [
    ["github.addLabels", () => addLabels(), "label"],
    ["github.removeLabel", () => removeLabel(), "unlabel"],
  ] as const;

  it.each(
    steps.flatMap(([operation, step, node]) =>
      (
        [
          ["another repository", "acme/other"],
          ["no repository set", null],
        ] as const
      ).map(
        ([label, configured]) =>
          [operation, step, node, label, configured] as const,
      ),
    ),
  )(
    "%s fails the item when the factory has %s, with repository_not_allowed, and GitHub is never asked",
    async (_operation, step, node, _label, configured) => {
      repositoryMock.mockResolvedValue(configured);
      const { test, fake, id } = await setup(chain([step()]));
      fake.script("test.items", offered(ITEM));

      const result = await ran(test, id);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(secretMock).not.toHaveBeenCalled();
      expect(stepOf(result, node)).toMatchObject({
        status: "failed",
        error: { message: expect.stringContaining("repository_not_allowed") },
      });
      expect(result.run.counts.itemFailures).toBe(1);
    },
  );

  it.each(steps)(
    "%s fails an item that names another repository than the factory's, and GitHub is never asked",
    async (_operation, step, node) => {
      const { test, fake, id } = await setup(chain([step()]));
      fake.script("test.items", offered({ ...ITEM, repo: "acme/other" }));

      const result = await ran(test, id);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(stepOf(result, node)).toMatchObject({
        status: "failed",
        error: { message: expect.stringContaining("repository_not_allowed") },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({ status: "error" });
    },
  );

  it("resolves the setting for the factory the workflow belongs to", async () => {
    const { test, fake, id } = await setup(chain([addLabels()]));
    fake.script("test.items", offered(ITEM));
    web({
      [`POST ${LABELS}`]: () => answer([{ name: "triage" }, { name: "Bug" }]),
    });

    await ran(test, id);

    expect(repositoryMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ caller: "automation" }),
      expect.objectContaining({
        orgId: "org-1",
        factoryId: test.scope.factoryId,
      }),
      test.scope.factoryId,
    );
  });

  it("stops the item, and writes nothing, when the setting cannot be read", async () => {
    repositoryMock.mockRejectedValue(new Error("database unavailable"));
    const { test, fake, id } = await setup(chain([addLabels()]));
    fake.script("test.items", offered(ITEM));

    const result = await ran(test, id);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stepOf(result, "label").status).not.toBe("succeeded");
    expect(result.run.counts.done).toBe(0);
  });
});

describe("slack.addReaction, run through the engine", () => {
  const graph = () => chain([react()]);
  const planned = (extra: Record<string, Route> = {}) =>
    web({
      [`GET ${AUTH_TEST}`]: botIdentity,
      [`POST ${REACT}`]: () => answer({ ok: true }),
      ...extra,
    });
  const MESSAGE = { ts: "1700000000.000100" };

  it("reacts in a live run as the bot: one POST with the resolver's token, a derived receipt and a path-only audit row", async () => {
    const { test, fake, id } = await setup(graph());
    fake.script("test.items", offered(MESSAGE));
    planned();

    const result = await ran(test, id);

    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({
      url: REACT,
      authorization: "Bearer slack-test-token",
      body: {
        channel: "C0123ABCD",
        timestamp: "1700000000.000100",
        name: "eyes",
      },
    });
    expect(secretMock).toHaveBeenCalledWith(
      "SLACK_BOT_TOKEN",
      "owner@example.test",
      {
        orgId: "org-1",
      },
    );
    expect(stepOf(result, "react")).toMatchObject({ status: "succeeded" });
    expect((await effectOf(test, id, "react"))?.summary).toBe(
      "called slack.addReaction -> C0123ABCD:1700000000.000100:eyes",
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "add-slack-reaction",
      targetType: "slack-message",
      targetId: "C0123ABCD:1700000000.000100",
      status: "success",
      summary: "POST slack /reactions.add",
      input: null,
    });
  });

  it("is a success, flagged, when Slack answers 200 already_reacted, and a rule can read the flag", async () => {
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
          react(),
          [
            "again",
            "filter",
            {
              combinator: "all",
              rules: [rule("nodes.react.alreadyReacted", "isTrue")],
            },
          ],
          ["done", "end", { outcome: "done" }],
          ["first", "end", { outcome: "dismissed", reason: "first time" }],
        ],
        edges: [
          ["start", "out", "src"],
          ["src", "out", "react"],
          ["react", "out", "again"],
          ["again", "match", "done"],
          ["again", "otherwise", "first"],
        ],
      }) as never,
    );
    fake.script("test.items", offered(MESSAGE));
    planned({
      [`POST ${REACT}`]: () => answer({ ok: false, error: "already_reacted" }),
    });

    const result = await ran(test, id);

    expect(stepOf(result, "react")).toMatchObject({ status: "succeeded" });
    expect(stepOf(result, "again")).toMatchObject({
      ports: { match: { count: 1 } },
    });
    expect(result.run.counts.itemFailures).toBe(0);
    // A repeat is the end state asked for: it is not asked again.
    expect(writes()).toHaveLength(1);
  });

  it.each([
    ["channel_not_found", "slack_not_found"],
    ["message_not_found", "slack_not_found"],
    ["missing_scope", "slack_access_denied"],
    ["invalid_name", "slack_reaction_rejected"],
    ["thread_locked", "slack_reaction_rejected"],
  ])(
    "fails the item when Slack answers 200 with ok:false and %s, with %s and nothing repeated",
    async (slackCode, code) => {
      const { test, fake, id } = await setup(graph());
      fake.script("test.items", offered(MESSAGE));
      planned({
        [`POST ${REACT}`]: () => answer({ ok: false, error: slackCode }),
      });

      const result = await ran(test, id);

      expect(writes()).toHaveLength(1);
      expect(stepOf(result, "react")).toMatchObject({
        status: "failed",
        error: { message: expect.stringContaining(code) },
      });
      expect(result.run.counts.itemFailures).toBe(1);
      expect(auditRows[0]).toMatchObject({
        summary: "POST slack /reactions.add (failed)",
      });
    },
  );

  it("stops for a person, and never writes again, when the outcome is unknown", async () => {
    const { test, fake, id } = await setup(graph());
    fake.script("test.items", offered(MESSAGE));
    planned({ [`POST ${REACT}`]: () => answer({}, 502) });

    const first = await ran(test, id);
    fake.script("test.items", offered(MESSAGE));
    const second = await ran(test, id);

    expect(stepOf(first, "react")).toMatchObject({
      status: "needs_check",
      error: { code: "effect_needs_check" },
    });
    expect(stepOf(first, "react").error?.message).toContain(
      "slack_reaction_outcome_unknown",
    );
    expect(second.run.counts.done).toBe(0);
    expect(writes()).toHaveLength(1);
  });

  it("never writes in a dry run or a test of the step, and never signs in either", async () => {
    const dry = await setup(graph());
    dry.fake.script("test.items", offered(MESSAGE));
    const dryResult = await ran(dry.test, dry.id, { mode: "dry" });
    const tested = await setup(graph());
    const testResult = await ran(tested.test, tested.id, {
      mode: "test",
      testNodeId: "react",
      sampleItems: [{ id: "s1", item: { extras: MESSAGE }, nodes: {} }],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(secretMock).not.toHaveBeenCalled();
    expect(auditRows).toEqual([]);
    for (const [result, node] of [
      [dryResult, "react"],
      [testResult, "react"],
    ] as const) {
      expect(stepOf(result, node)).toMatchObject({
        status: "succeeded",
        fields: { wouldCallCount: 1 },
      });
    }
  });

  it.each([
    [
      "a channel name",
      { channel: fixed("#support") },
      MESSAGE,
      "slack_channel_invalid",
    ],
    [
      "a Slack URL for the channel",
      { channel: fixed("https://acme.slack.com/archives/C0123ABCD") },
      MESSAGE,
      "slack_channel_invalid",
    ],
    [
      "an emoji name in capitals",
      { name: fixed("Eyes") },
      MESSAGE,
      "slack_reaction_invalid",
    ],
    [
      "an emoji character",
      { name: fixed("👀") },
      MESSAGE,
      "slack_reaction_invalid",
    ],
    [
      "a message time that is not one",
      {},
      { ts: "yesterday" },
      "slack_timestamp_invalid",
    ],
  ])(
    "fails the item for %s, typed, and never reaches Slack",
    async (_label, args, extras, code) => {
      const { test, fake, id } = await setup(chain([react(args)]));
      fake.script("test.items", offered(extras));

      const result = await ran(test, id);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(stepOf(result, "react")).toMatchObject({
        status: "failed",
        error: { message: expect.stringContaining(code) },
      });
    },
  );

  it("says Slack is not connected, and sends nothing, when the resolver has no token", async () => {
    secretMock.mockResolvedValue(undefined);
    const { test, fake, id } = await setup(graph());
    fake.script("test.items", offered(MESSAGE));

    const result = await ran(test, id);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stepOf(result, "react")).toMatchObject({
      status: "failed",
      error: { code: "credential_missing" },
    });
  });

  it("refuses a credential that is not the app's bot, and sends nothing", async () => {
    const { test, fake, id } = await setup(graph());
    fake.script("test.items", offered(MESSAGE));
    web({
      [`GET ${AUTH_TEST}`]: () =>
        answer({
          ok: true,
          user_id: "UOTHER",
          user: "someone-else",
          team_id: "T1",
          team: "Builder",
        }),
    });

    const result = await ran(test, id);

    expect(writes()).toEqual([]);
    expect(stepOf(result, "react")).toMatchObject({ status: "failed" });
    expect(stepOf(result, "react").error?.message).toContain(
      "slack_identity_mismatch",
    );
  });
});
