import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The action under test is the real `defineAction`, so its audit row, its
// output check and its `uiOnly` rule are the ones that ship. The actions used to
// set a workflow up stay plain objects, as in the other workflow action specs.
// Only the audit store, the provider's HTTP answer and the permission core
// decides are replaced; every other write goes through a spy that fails the test.
const auditRows = vi.hoisted(() => [] as Record<string, any>[]);
const providerMock = vi.hoisted(() => vi.fn());
const authorizeMock = vi.hoisted(() => vi.fn());
const queueMock = vi.hoisted(() => vi.fn());
const storeCalls = vi.hoisted(
  () => [] as { method: string; args: unknown[] }[],
);
const tripwireWrites = vi.hoisted(() => [] as unknown[]);

vi.mock("../../../packages/core/dist/audit/store.js", async (original) => ({
  ...(await original<object>()),
  insertAuditEvent: async (event: Record<string, any>) => {
    auditRows.push(event);
  },
}));
vi.mock("@agent-native/core/action", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/action")>();
  return {
    ...actual,
    defineAction: ((definition: Record<string, unknown>) =>
      definition.uiOnly === true
        ? actual.defineAction(definition as never)
        : definition) as typeof actual.defineAction,
  };
});
vi.mock("@agent-native/core/resources", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.resourcesModule;
});
vi.mock("@agent-native/core/jobs", async (importActual) => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.jobsModule(await importActual<Record<string, unknown>>());
});
vi.mock("@agent-native/core/triggers", () => ({
  authorizeAutomationRunNow: authorizeMock,
  queueAutomationRunNow: queueMock,
  listAutomationRuns: vi.fn(async () => []),
}));
vi.mock("../server/workflow-host/factory-store.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  const spied = (store: object) =>
    new Proxy(store, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          storeCalls.push({ method: String(property), args });
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  return { getWorkflowStore: () => spied(kit.currentStore()) };
});
vi.mock("../server/lib/require-workspace-member.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.memberModule;
});
vi.mock("../server/lib/factory-definitions.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.factoryDefinitionsModule;
});
vi.mock("../server/lib/provider-api.js", () => ({
  FACTORY_APP_ID: "factory",
  executeProviderApiRequest: providerMock,
}));
vi.mock("../server/lib/factory-workflow-connections.js", () => ({
  readProviderConnections: vi.fn(async () => []),
}));
vi.mock("../server/tripwire/index.js", async (importActual) => ({
  ...(await importActual<typeof import("../server/tripwire/index.js")>()),
  recordTripwire: (event: unknown) => void tripwireWrites.push(event),
  createTripwireSink: () => (event: unknown) => void tripwireWrites.push(event),
}));

import { WORKFLOW_JOB_APP_ID } from "../server/lib/factory-workflow-runner.js";
import { PROVIDER_PAYLOAD_BUDGET_CHARS } from "../server/workflow-host/provider-request.js";
import * as kit from "../server/workflow-host/testing/workflow-actions-kit.js";
import {
  buildGraph,
  fixed,
  fromPath,
} from "../server/workflow/story-graphs.fixture.js";
import runWorkflow from "./run-factory-workflow.js";
import save from "./save-factory-workflow.js";
import testStep from "./test-api-request-step.js";

const runSave = kit.runOf(save);
const runRun = kit.runOf(runWorkflow);
const test = kit.runOf(testStep);

const SECRET = "sk_live_FAKE_SECRET_9f8e7d6c5b4a";
const ctx = { ...kit.context, actionName: "test-api-request-step" };

const call = (workflowId: string, nodeId = "fetch", context: unknown = ctx) =>
  test({ factoryId: kit.FACTORY_ID, workflowId, nodeId }, context);

type Args = Record<string, unknown>;

async function createWorkflow(
  fetchArgs: Args,
  options: { settings?: Args; operation?: string } = {},
) {
  const created = await runSave(
    {
      factoryId: kit.FACTORY_ID,
      name: "Reads",
      graph: buildGraph({
        settings: options.settings ?? {},
        nodes: [
          ["start", "trigger", { schedule: { every: "15m" } }],
          [
            "fetch",
            "lookup",
            {
              operation: options.operation ?? "github.apiRequest",
              args: fetchArgs,
            },
          ],
          ["finish", "end", { outcome: "done" }],
        ],
        edges: [
          ["start", "out", "fetch"],
          ["fetch", "out", "finish"],
        ],
      }),
    },
    kit.context,
  );
  return created as { workflowId: string; job: { path: string } };
}

const answer = (
  json: unknown,
  extra: {
    status?: number;
    headers?: Record<string, string>;
    path?: string;
  } = {},
) => {
  const status = extra.status ?? 200;
  return {
    request: { method: "GET", path: extra.path ?? "/ok" },
    response: {
      status,
      ok: status >= 200 && status < 300,
      truncated: false,
      size: 100,
      headers: extra.headers ?? {},
      json,
    },
  };
};

const consoleOutput: string[] = [];

beforeEach(() => {
  kit.reset();
  vi.clearAllMocks();
  auditRows.length = 0;
  storeCalls.length = 0;
  tripwireWrites.length = 0;
  consoleOutput.length = 0;
  authorizeMock.mockResolvedValue({ name: "reads" });
  providerMock.mockResolvedValue(answer({ ok: true }));
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map((arg) => JSON.stringify(arg)).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Forgets the set-up the workflow needed, so what is left is what the call itself did. */
function startWatching() {
  storeCalls.length = 0;
  tripwireWrites.length = 0;
  consoleOutput.length = 0;
  auditRows.length = 0;
}

const issues = { path: fixed("repos/acme/web/issues") };

describe("test-api-request-step: what it declares", () => {
  it("is a read for the signed-in app UI alone: not an agent tool and not an MCP tool", () => {
    const entry = testStep as unknown as Record<string, any>;
    expect(entry.readOnly).toBe(true);
    expect(entry.uiOnly).toBe(true);
    expect(entry.agentTool).toBe(false);
    expect(entry.mcpTool).toBe(false);
    expect(entry.http).toEqual({ method: "POST" });
    expect(entry.outputSchema).toBeDefined();
    expect(entry.audit).toMatchObject({ onRead: true, recordInputs: false });
  });

  it("refuses any caller that is not the app's own UI, before it reads or sends anything", async () => {
    const created = await createWorkflow(issues);
    startWatching();

    for (const caller of ["tool", "mcp", "automation", "a2a"]) {
      const refused = await kit.failureOf(() =>
        call(created.workflowId, "fetch", { ...ctx, caller }),
      );
      expect(refused, caller).toMatchObject({
        errorCode: "ui_only_action",
        statusCode: 403,
      });
    }
    expect(providerMock).not.toHaveBeenCalled();
    expect(authorizeMock).not.toHaveBeenCalled();
    expect(storeCalls).toEqual([]);
  });
});

describe("test-api-request-step: a step that reads only what it is given", () => {
  it("sends the typed request and hands the provider's answer straight back", async () => {
    const created = await createWorkflow({
      ...issues,
      query: fixed({ state: "open", per_page: 3 }),
    });
    providerMock.mockResolvedValue(
      answer([{ number: 1 }, { number: 2 }], {
        path: "/repos/acme/web/issues",
      }),
    );

    const result = await call(created.workflowId);

    expect(result).toEqual({
      ok: true,
      status: 200,
      output: [{ number: 1 }, { number: 2 }],
      truncated: false,
      elapsedMs: expect.any(Number),
      request: {
        provider: "github",
        method: "GET",
        path: "repos/acme/web/issues",
      },
    });
    expect(providerMock).toHaveBeenCalledTimes(1);
    expect(providerMock.mock.calls[0][0]).toMatchObject({
      provider: "github",
      method: "GET",
      path: "/repos/acme/web/issues",
      query: { state: "open", per_page: "3" },
      timeoutMs: 60_000,
    });
    expect(providerMock.mock.calls[0][0]).not.toHaveProperty("body");
  });

  it("resolves the settings and the run the way a run does, with no item", async () => {
    const created = await createWorkflow(
      {
        path: fromPath("settings.extras.endpoint"),
        query: fixed({
          mode: "{{ run.mode }}",
          repo: "{{ settings.extras.repo }}",
        }),
      },
      {
        settings: { extras: { endpoint: "repos/acme/web/pulls", repo: "web" } },
      },
    );

    await call(created.workflowId);

    expect(providerMock.mock.calls[0][0]).toMatchObject({
      path: "/repos/acme/web/pulls",
      query: { mode: "test", repo: "web" },
    });
  });

  it("reads the window as a run does: the Trigger's schedule ending now", async () => {
    const created = await createWorkflow({
      ...issues,
      query: fixed({
        since: "{{ run.windowStart }}",
        until: "{{ run.windowEnd }}",
      }),
    });

    await call(created.workflowId);

    const { query } = providerMock.mock.calls[0][0] as {
      query: { since: string; until: string };
    };
    expect(Date.parse(query.since)).toBeLessThan(Date.parse(query.until));
    expect(Math.abs(Date.parse(query.until) - Date.now())).toBeLessThan(5_000);
  });

  it("answers a path that has no value as a typed failure, sending nothing", async () => {
    const created = await createWorkflow({
      path: fromPath("settings.extras.missing"),
    });

    const result = await call(created.workflowId);

    expect(result).toMatchObject({
      ok: false,
      code: "expression_failed",
      message: expect.stringContaining("settings.extras.missing"),
    });
    expect(providerMock).not.toHaveBeenCalled();
  });

  it("bounds a big answer the way a run does, and says it was cut first", async () => {
    const created = await createWorkflow(issues);
    const pull = (n: number) => ({
      id: n,
      body: `${n}`.repeat(25_000),
      user: { login: "octocat" },
    });
    providerMock.mockResolvedValue(answer([pull(1), pull(2), pull(3)]));

    const result = await call(created.workflowId);

    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result.output).length).toBeLessThanOrEqual(
      PROVIDER_PAYLOAD_BUDGET_CHARS,
    );
    expect(Object.keys(result.output).slice(0, 4)).toEqual([
      "truncated",
      "count",
      "totalAvailable",
      "cuts",
    ]);
    expect(result.output).toMatchObject({ totalAvailable: 3 });
    result.output.value.forEach((kept: unknown, index: number) =>
      expect(kept).toEqual(pull(index + 1)),
    );
  });

  it("keeps only the listed fields, so three big answers fit whole, and names a path that matched nothing", async () => {
    const created = await createWorkflow({
      ...issues,
      fieldsToKeep: fixed(["number", "title", "user.login", "nope"]),
    });
    const pull = (n: number) => ({
      number: n,
      title: `Pull request ${n}`,
      body: `${n}`.repeat(25_000),
      user: { login: "octocat", id: n },
    });
    providerMock.mockResolvedValue(answer([pull(1), pull(2), pull(3)]));

    const result = await call(created.workflowId);

    expect(result).toMatchObject({ ok: true, truncated: false });
    expect(result.output).toEqual({
      fieldsMissing: ["nope"],
      value: [1, 2, 3].map((n) => ({
        number: n,
        title: `Pull request ${n}`,
        user: { login: "octocat" },
      })),
    });
    expect(JSON.stringify(result.output).length).toBeLessThan(1_000);
  });

  it("keeps the provider's refusal in a trimmed answer, so the pane shows why nothing matched", async () => {
    const created = await createWorkflow({
      ...issues,
      fieldsToKeep: fixed(["channels.name"]),
    });
    providerMock.mockResolvedValue(
      answer({ ok: false, error: "missing_scope", channels: [] }),
    );

    const result = await call(created.workflowId);

    expect(result).toMatchObject({ ok: true });
    expect(result.output).toEqual({
      fieldsMissing: ["channels.name"],
      ok: false,
      error: "missing_scope",
    });
  });

  it("trims the answer after it arrives and never sends the paths to the provider", async () => {
    const created = await createWorkflow({
      ...issues,
      fieldsToKeep: fixed(["number", "user.login"]),
    });
    providerMock.mockResolvedValue(
      answer({ number: 7, title: "t", user: { login: "ada", id: 1 } }),
    );

    const result = await call(created.workflowId);

    expect(result.output).toEqual({ number: 7, user: { login: "ada" } });
    expect(providerMock.mock.calls[0][0]).not.toHaveProperty("fieldsToKeep");
  });

  it("wraps the status and a few headers around the body when the step asks", async () => {
    const created = await createWorkflow({
      ...issues,
      includeStatus: fixed(true),
    });
    providerMock.mockResolvedValue(
      answer([{ id: 1 }], {
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining": "4999",
          "set-cookie": "session=abc",
        },
      }),
    );

    const result = await call(created.workflowId);

    expect(result.output).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "4999",
      },
      body: [{ id: 1 }],
    });
  });
});

describe("test-api-request-step: a request that is refused", () => {
  // Each value comes from the workflow's settings, as it would from an earlier
  // step, so the run's own checks refuse it: a typed value is refused at save.
  const refusals: [string, Args, Record<string, unknown>, string][] = [
    [
      "a full URL",
      { path: fromPath("settings.extras.v") },
      { v: "https://evil.test/user" },
      "full_url_refused",
    ],
    [
      "a path that climbs out",
      { path: fromPath("settings.extras.v") },
      { v: "repos/../../admin" },
      "unsafe_path_value",
    ],
    [
      "an encoded dot-dot",
      { path: fromPath("settings.extras.v") },
      { v: "%2e%2e/admin" },
      "unsafe_path_value",
    ],
    [
      "a query in the path",
      { path: fromPath("settings.extras.v") },
      { v: "user?x=1" },
      "unsafe_path_value",
    ],
    [
      "a credential header",
      { ...issues, headers: fromPath("settings.extras.v") },
      { v: { Authorization: "Bearer x" } },
      "header_denied",
    ],
    [
      "an api-key header",
      { ...issues, headers: fromPath("settings.extras.v") },
      { v: { "X-Api-Key": "k" } },
      "header_denied",
    ],
    [
      "a header that is not text",
      { ...issues, headers: fromPath("settings.extras.v") },
      { v: { "X-A": 1 } },
      "invalid_header",
    ],
    [
      "a bad query",
      { ...issues, query: fromPath("settings.extras.v") },
      { v: { "a b": 1 } },
      "invalid_query",
    ],
    [
      "a timeout of zero",
      { ...issues, timeoutSeconds: fromPath("settings.extras.v") },
      { v: 0 },
      "invalid_timeout",
    ],
    [
      "a timeout over a minute",
      { ...issues, timeoutSeconds: fromPath("settings.extras.v") },
      { v: 61 },
      "invalid_timeout",
    ],
    [
      "paging with no cursor parameter",
      { ...issues, pagination: fromPath("settings.extras.v") },
      { v: { cursorPath: "next" } },
      "invalid_pagination",
    ],
    [
      "more pages than the cap",
      { ...issues, pagination: fromPath("settings.extras.v") },
      { v: { cursorPath: "n", cursorParam: "c", maxPages: 50 } },
      "invalid_pagination",
    ],
    [
      "an empty list of paths to keep",
      { ...issues, fieldsToKeep: fromPath("settings.extras.v") },
      { v: [] },
      "invalid_fields_to_keep",
    ],
    [
      "a path to keep that reaches a prototype",
      { ...issues, fieldsToKeep: fromPath("settings.extras.v") },
      { v: ["a.constructor"] },
      "invalid_fields_to_keep",
    ],
    [
      "paths to keep that are one text",
      { ...issues, fieldsToKeep: fromPath("settings.extras.v") },
      { v: "number,title" },
      "invalid_fields_to_keep",
    ],
  ];

  it.each(refusals)(
    "%s comes back as a typed failure and the provider is never called",
    async (_label, args, extras, code) => {
      const created = await createWorkflow(args, {
        settings: { extras },
      });
      startWatching();

      const result = await call(created.workflowId);

      expect(result).toMatchObject({
        ok: false,
        code,
        message: expect.any(String),
        request: { provider: "github", method: "GET" },
      });
      expect(providerMock).not.toHaveBeenCalled();
      // The message names the part that was wrong and never the value.
      expect(result.message).not.toContain("evil.test");
      expect(result.message).not.toContain("Bearer");
      // Audited once, as an attempt that did not go out.
      expect(auditRows).toHaveLength(1);
      expect(String(auditRows[0]?.summary)).toMatch(
        new RegExp(`^GET github /.* \\(${code}\\)$`),
      );
    },
  );

  it("refuses a status request beside paging as incompatible", async () => {
    const created = await createWorkflow(
      {
        ...issues,
        includeStatus: fromPath("settings.extras.status"),
        pagination: fixed({ cursorPath: "n", cursorParam: "c" }),
      },
      { settings: { extras: { status: true } } },
    );

    const result = await call(created.workflowId);

    expect(result).toMatchObject({ ok: false, code: "incompatible_fields" });
    expect(providerMock).not.toHaveBeenCalled();
  });
});

describe("test-api-request-step: a provider that does not answer well", () => {
  it.each([
    [401, "provider_access_denied"],
    [403, "provider_access_denied"],
    [404, "provider_not_found"],
    [422, "provider_rejected"],
    [429, "provider_rate_limited"],
    [503, "provider_unavailable"],
  ])("HTTP %s comes back as %s with its status", async (status, code) => {
    const created = await createWorkflow(issues);
    providerMock.mockResolvedValue(answer({ message: SECRET }, { status }));

    const result = await call(created.workflowId);

    expect(result).toMatchObject({ ok: false, code, status });
    expect(result.message).not.toContain(SECRET);
  });

  it("says the provider is not connected when core has no credential", async () => {
    const created = await createWorkflow(issues);
    providerMock.mockRejectedValue(new Error("GitHub is not configured."));

    expect(await call(created.workflowId)).toMatchObject({
      ok: false,
      code: "credential_missing",
    });
  });

  it("says a network failure was one, and an answer that is not JSON was unreadable", async () => {
    const created = await createWorkflow(issues);
    providerMock.mockRejectedValue(new Error("fetch failed"));
    expect(await call(created.workflowId)).toMatchObject({
      ok: false,
      code: "provider_request_failed",
    });

    providerMock.mockResolvedValue(answer(undefined));
    expect(await call(created.workflowId)).toMatchObject({
      ok: false,
      code: "unexpected_response",
    });
  });

  it("answers a placeholder core could not fill as not configured", async () => {
    const created = await createWorkflow(
      { path: fixed("api/projects/{projectId}/query/") },
      { operation: "posthog.apiRequest" },
    );
    providerMock.mockResolvedValue(
      answer({}, { path: "/api/projects/%7BprojectId%7D/query/" }),
    );

    expect(await call(created.workflowId)).toMatchObject({
      ok: false,
      code: "provider_not_configured",
    });
  });
});

describe("test-api-request-step: a step it will not test", () => {
  it("names a node that is not in the saved workflow, or a workflow that is not there", async () => {
    const created = await createWorkflow(issues);

    expect(
      await kit.failureOf(() => call(created.workflowId, "ghost")),
    ).toMatchObject({ errorCode: "workflow_node_not_found", statusCode: 404 });
    expect(await kit.failureOf(() => call("nope"))).toMatchObject({
      errorCode: "workflow_not_found",
      statusCode: 404,
    });
    expect(providerMock).not.toHaveBeenCalled();
  });

  it("refuses a step that is not an API request: another kind, or a curated lookup", async () => {
    const created = await createWorkflow(
      { email: fixed("pat@example.com") },
      { operation: "slack.findUserByEmail" },
    );

    for (const nodeId of ["finish", "start", "fetch"]) {
      expect(
        await kit.failureOf(() => call(created.workflowId, nodeId)),
        nodeId,
      ).toMatchObject({ errorCode: "not_an_api_request", statusCode: 400 });
    }
    expect(providerMock).not.toHaveBeenCalled();
  });

  it("refuses a step that reads the item or an earlier step, as a test of it in a run does", async () => {
    for (const path of [
      fromPath("item.extras.path"),
      fixed("repos/{{ item.thread.repo }}/issues"),
    ]) {
      kit.reset();
      const created = await createWorkflow({ path });
      const refused = await kit.failureOf(() => call(created.workflowId));
      expect(refused, JSON.stringify(path)).toMatchObject({
        errorCode: "test_needs_items",
        statusCode: 409,
        details: { nodeId: "fetch", nodeKind: "lookup" },
      });
    }
    expect(providerMock).not.toHaveBeenCalled();
  });

  it("refuses a workflow whose job file is gone", async () => {
    const created = await createWorkflow(issues);
    kit.removeJob(created.job.path);

    expect(await kit.failureOf(() => call(created.workflowId))).toMatchObject({
      errorCode: "workflow_job_missing",
      statusCode: 409,
    });
    expect(providerMock).not.toHaveBeenCalled();
  });
});

describe("test-api-request-step: who may test", () => {
  const collaborateRefusal = () =>
    Object.assign(
      new Error("Collaborate access is required to run this automation."),
      { statusCode: 403 },
    );

  it("asks core the question a test run asks, for this workflow's job", async () => {
    const created = await createWorkflow(issues);

    await call(created.workflowId);

    expect(authorizeMock).toHaveBeenCalledTimes(1);
    expect(authorizeMock).toHaveBeenCalledWith({
      userEmail: kit.USER_EMAIL,
      orgId: kit.ORG_ID,
      appId: "factory",
      additionalJobAppIds: [WORKFLOW_JOB_APP_ID],
      scope: "organization",
      path: created.job.path,
    });
  });

  it("refuses a member without collaborate access exactly as testing the step in a run does", async () => {
    const created = await createWorkflow(issues);
    authorizeMock.mockRejectedValue(collaborateRefusal());
    queueMock.mockRejectedValue(collaborateRefusal());
    startWatching();

    const refused = await kit.failureOf(() => call(created.workflowId));
    // What the refused call itself did, before the test run's own request is made.
    const readOnly = storeCalls.every(({ method }) =>
      /^(get|list)/.test(method),
    );
    const audited = [...auditRows];
    const refusedRun = await kit.failureOf(() =>
      runRun(
        {
          factoryId: kit.FACTORY_ID,
          workflowId: created.workflowId,
          mode: "test",
          testNodeId: "fetch",
        },
        kit.context,
      ),
    );

    expect(refused).toMatchObject({
      errorCode: "run_not_queued",
      statusCode: 403,
      message: expect.stringContaining(
        "Collaborate access is required to run this automation.",
      ),
    });
    expect({
      errorCode: refused.errorCode,
      statusCode: refused.statusCode,
    }).toEqual({
      errorCode: refusedRun.errorCode,
      statusCode: refusedRun.statusCode,
    });
    expect(refusedRun.message).toContain(
      "Collaborate access is required to run this automation.",
    );
    // Nothing was sent and nothing but a refused attempt was recorded.
    expect(providerMock).not.toHaveBeenCalled();
    expect(readOnly).toBe(true);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      status: "denied",
      action: "test-api-request-step",
    });
  });

  it("refuses when core does not know the automation, and does not hide a failure of its own", async () => {
    const created = await createWorkflow(issues);

    authorizeMock.mockRejectedValue(
      Object.assign(new Error("Automation not found."), { statusCode: 404 }),
    );
    expect(await kit.failureOf(() => call(created.workflowId))).toMatchObject({
      errorCode: "run_not_queued",
      statusCode: 404,
    });

    authorizeMock.mockRejectedValue(new Error("database is down"));
    await expect(call(created.workflowId)).rejects.toThrow("database is down");
    expect(providerMock).not.toHaveBeenCalled();
  });

  it("checks access before it resolves a field or sends a request", async () => {
    const created = await createWorkflow({
      path: fromPath("settings.extras.missing"),
    });
    authorizeMock.mockRejectedValue(collaborateRefusal());

    expect(await kit.failureOf(() => call(created.workflowId))).toMatchObject({
      errorCode: "run_not_queued",
    });
    expect(providerMock).not.toHaveBeenCalled();
  });
});

describe("test-api-request-step: what it keeps", () => {
  const leaky = {
    token: SECRET,
    data: [{ id: 1, note: `contains ${SECRET}` }],
  };

  /** Everything this call could have written or said, as text, for a secret to hide in. */
  function everythingKept(): string {
    return JSON.stringify({
      auditRows,
      storeCalls,
      tripwireWrites,
      consoleOutput,
      jobs: kit.jobFiles(),
    });
  }

  it("returns a response with a secret in it to the caller and leaves it out of everything kept", async () => {
    const created = await createWorkflow(issues);
    providerMock.mockResolvedValue(answer(leaky));
    startWatching();

    const result = await call(created.workflowId);

    expect(JSON.stringify(result)).toContain(SECRET);
    expect(result.output).toEqual(leaky);
    expect(everythingKept()).not.toContain(SECRET);
  });

  it("leaves a secret out of everything kept when the provider answers with an error", async () => {
    const created = await createWorkflow(issues);
    providerMock.mockResolvedValue(answer(leaky, { status: 500 }));
    startWatching();

    const result = await call(created.workflowId);

    expect(result).toMatchObject({ ok: false, code: "provider_unavailable" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(everythingKept()).not.toContain(SECRET);
  });

  it("leaves a secret out of what is kept when the answer is one a run would report on", async () => {
    const created = await createWorkflow(issues);
    // A 200 whose body says the provider did not do it, and a truncated read.
    providerMock.mockResolvedValue(answer({ ok: false, error: SECRET }));
    startWatching();
    await call(created.workflowId);
    providerMock.mockResolvedValue({
      ...answer(leaky),
      response: { ...answer(leaky).response, truncated: true, size: 9_000_000 },
    });
    await call(created.workflowId);

    // A run records a tripwire for each of these; this test records none.
    expect(tripwireWrites).toEqual([]);
    expect(everythingKept()).not.toContain(SECRET);
  });

  it("writes nothing but one audit row: the workflow store is only read, no tripwire, no job file, no log", async () => {
    const created = await createWorkflow(issues);
    const jobsBefore = JSON.stringify(kit.jobFiles());
    providerMock.mockResolvedValue(answer(leaky));
    startWatching();

    await call(created.workflowId);

    expect(storeCalls.length).toBeGreaterThan(0);
    expect(storeCalls.map(({ method }) => method)).toContain("getWorkflow");
    expect(
      storeCalls.filter(({ method }) => !/^(get|list)/.test(method)),
    ).toEqual([]);
    expect(tripwireWrites).toEqual([]);
    expect(consoleOutput).toEqual([]);
    expect(JSON.stringify(kit.jobFiles())).toBe(jobsBefore);
    expect(auditRows).toHaveLength(1);
  });

  it("records the audit row as chat's provider request does: the method, the provider and the path, no inputs", async () => {
    const created = await createWorkflow({
      path: fixed("repos/acme/web/issues"),
      query: fixed({
        q: "password-reset hunter2",
        access_token: "ghp_abcdefghij",
      }),
      headers: fixed({ "X-Request-Id": "req-secret-1" }),
    });
    startWatching();

    await call(created.workflowId);

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "test-api-request-step",
      caller: "frontend",
      status: "success",
      targetType: "factory-workflow",
      targetId: created.workflowId,
      summary: "GET github /repos/acme/web/issues",
      input: null,
    });
    const text = JSON.stringify(auditRows[0]);
    for (const planted of ["hunter2", "ghp_abcdefghij", "req-secret-1"]) {
      expect(text).not.toContain(planted);
    }
  });

  it("masks a path segment that looks like a credential in the audit row", async () => {
    const created = await createWorkflow({
      path: fixed("tokens/abcdefghijklmnopqrstuvwxyz0123456789ABCD"),
    });
    startWatching();

    await call(created.workflowId);

    expect(auditRows[0]?.summary).toBe("GET github /tokens/[redacted]");
  });
});
