import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAutomationMock = vi.hoisted(() => vi.fn());
const executeRequestMock = vi.hoisted(() => vi.fn());
const readConnectionsMock = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown[]> => []),
);

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  isAgentConnectionRequiredError: (error: unknown) =>
    (error as { name?: string } | null)?.name ===
    "AgentConnectionRequiredError",
}));
vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: requireAutomationMock,
}));
vi.mock("../server/lib/require-workspace-member.js", () => ({
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
vi.mock("../server/lib/factory-automation-resources.js", () => ({
  factoryIdFromAutomationName: (name: string) =>
    name.match(/^factories\/([^/]+)\//)?.[1] ?? null,
}));
vi.mock("../server/lib/provider-api.js", () => ({
  FACTORY_APP_ID: "factory",
  executeProviderApiRequest: executeRequestMock,
}));
vi.mock("../server/lib/factory-workflow-connections.js", () => ({
  readProviderConnections: readConnectionsMock,
}));

import { WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS } from "../server/lib/workflow-action-support.js";
import {
  createRunObserver,
  withRunObserver,
} from "../server/lib/workflow-run-observer.js";
import { sanitizeDetails } from "../server/tripwire/redact.js";
import { createCapturingTripwireSink } from "../server/tripwire/testing.js";
import type { TripwireInput, TripwireSink } from "../server/tripwire/types.js";
import {
  buildProviderRequest,
  PROVIDER_OUTPUT_BUDGET_CHARS,
} from "../server/workflow-host/provider-request.js";
import { OPERATION_CATALOG } from "../server/workflow/catalog/index.js";
import type { OperationDefinition } from "../server/workflow/operations.js";
import action from "./run-workflow-operation.js";

const SINCE = "2026-10-17T10:00:00.000Z";
const UNTIL = "2026-10-17T11:00:00.000Z";

const context = {
  caller: "automation" as const,
  userEmail: "owner@example.test",
  actionName: "run-workflow-operation",
  signal: new AbortController().signal,
  automation: { triggerId: "job-1", triggerName: "factories/f1/wf" },
};

type Result = Record<string, any>;
type Call = {
  operationId: string;
  fields?: Record<string, unknown>;
  cursor?: string;
  window?: { from: string; to: string };
  limit?: number;
  prime?: boolean;
  factoryId?: string;
};

const run = (input: Call, ctx: unknown = context): Promise<Result> =>
  (
    action as unknown as { run: (i: unknown, c: unknown) => Promise<Result> }
  ).run({ fields: {}, ...input }, ctx);

interface Failure extends Error {
  errorCode: string;
  sideEffect: "none" | "maybe";
  retryable: boolean;
}

async function failureOf(call: Promise<unknown>): Promise<Failure> {
  try {
    await call;
  } catch (error) {
    return error as Failure;
  }
  throw new Error("Expected the call to fail.");
}

function op(id: string): OperationDefinition {
  const def = OPERATION_CATALOG.get(id);
  if (!def) throw new Error(`${id} is not in the catalog`);
  return def;
}

/** What core's runtime returns for an HTTP answer. */
function answer(
  json: unknown,
  extra: {
    status?: number;
    ok?: boolean;
    truncated?: boolean;
    size?: number;
    path?: string;
  } = {},
) {
  const status = extra.status ?? 200;
  return {
    request: { method: "GET", path: extra.path ?? "/ok" },
    response: {
      status,
      ok: extra.ok ?? (status >= 200 && status < 300),
      truncated: extra.truncated ?? false,
      size: extra.size ?? 100,
      json,
    },
  };
}

const lead = (id: string) => ({
  id,
  createdAt: "2026-10-17T10:05:00.000Z",
  properties: { email: `${id}@example.com` },
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAutomationMock.mockResolvedValue(undefined);
  executeRequestMock.mockResolvedValue(
    answer({ ok: true, user: { id: "U1" } }),
  );
});

describe("run-workflow-operation: what it declares", () => {
  it("is for a workflow job alone", () => {
    expect(action.http).toBe(false);
    expect(action.mcpTool).toBe(false);
    expect(action.mcpAnnotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
  });

  it("is not declared read-only as a whole: the operation decides", () => {
    expect(action.readOnly).toBeUndefined();
  });

  it("audits a call without recording its inputs", () => {
    expect(action.audit.recordInputs).toBe(false);
    expect(action.audit.target({ operationId: "pylon.reply" })).toEqual({
      type: "workflow-operation",
      id: "pylon.reply",
      visibility: "org",
    });
    expect(
      action.audit.summary(
        { operationId: "pylon.reply" },
        {},
        { status: "success" },
      ),
    ).toBe("Ran pylon.reply");
    expect(
      action.audit.summary(
        { operationId: "pylon.reply" },
        {},
        { status: "error" },
      ),
    ).toBe("Tried to run pylon.reply");
  });

  it("budgets its output like the other workflow actions", () => {
    expect(PROVIDER_OUTPUT_BUDGET_CHARS).toBe(
      WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS,
    );
  });
});

describe("run-workflow-operation: read or write comes from the catalog, not the method", () => {
  const effectOf = (operationId: string) =>
    action.planMode.effect({ operationId });
  const retrySafe = (operationId: string) => action.retrySafe({ operationId });

  it("treats a POST that the catalog calls a read as a read, safe to retry", () => {
    for (const id of [
      "hubspot.newLeads",
      "pylon.newTickets",
      "gong.transcript",
      "posthog.usage",
      "bigquery.billingQuery",
    ]) {
      const implementation = op(id).implementation;
      expect(
        implementation.type === "provider-request" && implementation.method,
        id,
      ).toBe("POST");
      expect(effectOf(id), id).toBe("read");
      expect(retrySafe(id), id).toBe(true);
    }
  });

  it("treats every write as a write that is never retried", () => {
    for (const id of [
      "pylon.reply",
      "pylon.addNote",
      "jira.createIssue",
      "notion.createPage",
      "hubspot.addToList",
    ]) {
      expect(effectOf(id), id).toBe("write");
      expect(retrySafe(id), id).toBe(false);
    }
  });

  it("does not guess for an operation it does not know", () => {
    expect(effectOf("nope.missing")).toBe("unknown");
    expect(retrySafe("nope.missing")).toBe(false);
  });
});

describe("run-workflow-operation: the gate", () => {
  it("asks the gate, with the operation id, before it touches a provider", async () => {
    await run({
      operationId: "slack.findUserByEmail",
      fields: { email: "a@b.co" },
    });

    expect(requireAutomationMock).toHaveBeenCalledTimes(1);
    expect(requireAutomationMock).toHaveBeenCalledWith(
      context,
      { userEmail: "owner@example.test", orgId: "org-1" },
      "workflow",
      "f1",
      { operationId: "slack.findUserByEmail" },
    );
    expect(requireAutomationMock.mock.invocationCallOrder[0]).toBeLessThan(
      executeRequestMock.mock.invocationCallOrder[0],
    );
  });

  it("calls nothing when the gate refuses", async () => {
    requireAutomationMock.mockRejectedValue(
      Object.assign(new Error("not named by the graph"), {
        errorCode: "workflow_action_not_allowed",
      }),
    );
    const failure = await failureOf(
      run({ operationId: "pylon.reply", fields: {} }),
    );
    expect(failure.errorCode).toBe("workflow_action_not_allowed");
    expect(executeRequestMock).not.toHaveBeenCalled();
  });

  it("uses the factory the calling job belongs to, or the one it is given", async () => {
    await run({
      operationId: "slack.findUserByEmail",
      fields: { email: "a@b.co" },
      factoryId: "other",
    });
    expect(requireAutomationMock.mock.calls[0][3]).toBe("other");
  });

  it("needs a factory it can name", async () => {
    const failure = await failureOf(
      run(
        { operationId: "slack.findUserByEmail", fields: { email: "a@b.co" } },
        {
          ...context,
          automation: { triggerId: "j", triggerName: "legacy-job" },
        },
      ),
    );
    expect(failure.errorCode).toBe("factory_id_required");
    expect(requireAutomationMock).not.toHaveBeenCalled();
  });

  it("only runs provider operations from the catalog", async () => {
    for (const operationId of ["nope.missing", "slack.postMessage"]) {
      const failure = await failureOf(run({ operationId }));
      expect(failure.errorCode, operationId).toBe("operation_not_in_catalog");
    }
    expect(executeRequestMock).not.toHaveBeenCalled();
  });
});

describe("run-workflow-operation: the request", () => {
  it("builds the request from the catalog and hands core only that", async () => {
    await run({
      operationId: "github.readFile",
      fields: { repo: "acme/app", path: "docs/a b.md" },
    });
    expect(executeRequestMock).toHaveBeenCalledWith({
      provider: "github",
      method: "GET",
      path: "/repos/acme/app/contents/docs/a%20b.md",
      timeoutMs: 60_000,
      maxBytes: 2 * 1024 * 1024,
      signal: context.signal,
    });
  });

  it("sends a catalog body for a POST read", async () => {
    executeRequestMock.mockResolvedValue(answer({ results: [] }));
    await run({ operationId: "hubspot.newLeads", cursor: "42" });
    const call = executeRequestMock.mock.calls[0][0];
    expect(call).toMatchObject({
      provider: "hubspot",
      method: "POST",
      path: "/crm/v3/objects/contacts/search",
    });
    expect(JSON.stringify(call.body)).toContain('"value":"42"');
  });

  it("refuses a caller who tries to steer the path, method or body", async () => {
    for (const fields of [
      { email: "a@b.co", path: "/chat.postMessage" },
      { email: "a@b.co", method: "POST" },
      { email: "a@b.co", body: { text: "x" } },
    ]) {
      const failure = await failureOf(
        run({ operationId: "slack.findUserByEmail", fields }),
      );
      expect(failure.errorCode).toBe("operation_fields_invalid");
    }
    expect(executeRequestMock).not.toHaveBeenCalled();
  });

  it("names the field that is missing", async () => {
    const failure = await failureOf(
      run({ operationId: "pylon.addNote", fields: { ticketId: "t1" } }),
    );
    expect(failure.errorCode).toBe("operation_fields_invalid");
    expect(failure.message).toContain("bodyHtml");
    expect(failure.sideEffect).toBe("none");
  });

  it("refuses a table name that could carry SQL, and sends nothing", async () => {
    for (const table of [
      "p.d.t`; DROP TABLE users; --",
      "p.d.t') UNION SELECT secret FROM s.x.y WHERE ('1'='1",
      "p.d.t\nWHERE 1=1",
    ]) {
      const failure = await failureOf(
        run({
          operationId: "bigquery.billingQuery",
          fields: { table },
          window: { from: SINCE, to: UNTIL },
        }),
      );
      expect(failure.errorCode).toBe("invalid_table");
      expect(failure.sideEffect).toBe("none");
    }
    expect(executeRequestMock).not.toHaveBeenCalled();
  });

  it("refuses a path that climbs out of its endpoint, and sends nothing", async () => {
    const failure = await failureOf(
      run({
        operationId: "github.readFile",
        fields: { repo: "acme/app", path: "../../orgs/acme/members" },
      }),
    );
    expect(failure.errorCode).toBe("unsafe_path_value");
    expect(executeRequestMock).not.toHaveBeenCalled();
  });

  it("refuses to prime a source that has no cursor, or one that has it", async () => {
    for (const call of [
      { operationId: "gong.newCalls", window: { from: SINCE, to: UNTIL } },
      { operationId: "hubspot.newLeads", cursor: "1" },
    ]) {
      const failure = await failureOf(run({ ...call, prime: true }));
      expect(failure.errorCode).toBe("operation_fields_invalid");
    }
    expect(executeRequestMock).not.toHaveBeenCalled();
  });
});

describe("run-workflow-operation: a good answer", () => {
  it("returns a lookup's JSON as its output", async () => {
    const body = { ok: true, user: { id: "U1", name: "Pat" } };
    executeRequestMock.mockResolvedValue(answer(body));
    const result = await run({
      operationId: "slack.findUserByEmail",
      fields: { email: "pat@example.com" },
    });
    expect(result).toEqual({
      ok: true,
      operationId: "slack.findUserByEmail",
      status: 200,
      output: body,
      truncated: false,
    });
  });

  it("returns a source's items and the next cursor", async () => {
    executeRequestMock.mockResolvedValue(
      answer({ results: [lead("9002"), lead("9003")] }),
    );
    const result = await run({
      operationId: "hubspot.newLeads",
      cursor: "9001",
      limit: 50,
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      externalId: "9002",
      kind: "lead",
      title: "9002@example.com",
    });
    expect(result.cursor).toBe("9003");
    expect(result.truncated).toBe(false);
  });

  it("primes the cursor and returns no items on a first live run", async () => {
    executeRequestMock.mockResolvedValue(
      answer({ results: [lead("9003"), lead("9002")] }),
    );
    const result = await run({ operationId: "hubspot.newLeads", prime: true });
    expect(result).toMatchObject({
      items: [],
      cursor: "9003",
      primed: true,
      output: { primed: true, skipped: 2 },
    });
    const body = executeRequestMock.mock.calls[0][0].body as {
      filterGroups: { filters: unknown[] }[];
    };
    expect(body.filterGroups[0].filters).toHaveLength(1);
  });

  it("returns a write's receipt", async () => {
    executeRequestMock.mockResolvedValue(
      answer({
        id: "page-1",
        url: "https://www.notion.so/page-1",
        object: "page",
      }),
    );
    const result = await run({
      operationId: "notion.createPage",
      fields: { parentPageId: "parent-1", title: "Postmortem" },
    });
    expect(result).toMatchObject({
      ok: true,
      externalRef: "page-1",
      url: "https://www.notion.so/page-1",
    });
  });

  it("keeps the indented form under core's cut, which nested data can double", async () => {
    const nested = Array.from({ length: 3000 }, (_, index) => ({
      a: { b: { c: index } },
    }));
    executeRequestMock.mockResolvedValue(
      answer({ callTranscripts: [{ callId: "c1", transcript: nested }] }),
    );
    const result = await run({
      operationId: "gong.transcript",
      fields: { callId: "c1" },
    });
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(
      WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS,
    );
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(48_000);
  });

  it("trims a big response, flags it, and stays inside the output limit", async () => {
    const sentences = Array.from({ length: 5000 }, (_, index) => ({
      start: index,
      text: `sentence ${index} with some more words in it`,
    }));
    executeRequestMock.mockResolvedValue(
      answer({ callTranscripts: [{ callId: "c1", transcript: sentences }] }),
    );
    const result = await run({
      operationId: "gong.transcript",
      fields: { callId: "c1" },
    });
    expect(result.truncated).toBe(true);
    expect(result.output.truncated).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS,
    );
  });
});

describe("run-workflow-operation: an HTTP failure", () => {
  const fail = (status: number, json: unknown = { error: "nope" }) =>
    executeRequestMock.mockResolvedValue(answer(json, { status }));
  const read = () =>
    run({ operationId: "slack.findUserByEmail", fields: { email: "a@b.co" } });
  const write = () =>
    run({
      operationId: "pylon.addNote",
      fields: { ticketId: "t1", bodyHtml: "<p>hi</p>" },
    });

  it.each([
    [401, "provider_access_denied", false],
    [403, "provider_access_denied", false],
    // A record read by id may not exist yet, so a lookup that 404s is tried again.
    [404, "provider_not_found", true],
    [429, "provider_rate_limited", true],
    [500, "provider_unavailable", true],
    [400, "provider_rejected", false],
  ])(
    "a read that gets %i is %s (retryable %s)",
    async (status, code, retryable) => {
      fail(status);
      const failure = await failureOf(read());
      expect(failure.errorCode).toBe(code);
      expect(failure.sideEffect).toBe("none");
      expect(failure.retryable).toBe(retryable);
    },
  );

  it.each([
    [500, "provider_request_outcome_unknown", "maybe", false],
    [502, "provider_request_outcome_unknown", "maybe", false],
    [408, "provider_request_outcome_unknown", "maybe", false],
    [429, "provider_rate_limited", "none", true],
    [400, "provider_rejected", "none", false],
    [403, "provider_access_denied", "none", false],
    [404, "provider_not_found", "none", false],
  ])(
    "a write that gets %i is %s (side effect %s)",
    async (status, code, sideEffect, retryable) => {
      fail(status);
      const failure = await failureOf(write());
      expect(failure.errorCode).toBe(code);
      expect(failure.sideEffect).toBe(sideEffect);
      expect(failure.retryable).toBe(retryable);
    },
  );

  it("repeats a provider's short error word, never its body", async () => {
    executeRequestMock.mockResolvedValue(
      answer(
        { ok: false, error: "users_not_found", detail: "pat@secret.example" },
        { status: 200, ok: false },
      ),
    );
    const failure = await failureOf(read());
    expect(failure.errorCode).toBe("provider_rejected");
    expect(failure.message).toContain("users_not_found");
    expect(failure.message).not.toContain("secret.example");
  });

  it("does not repeat an error that is prose", async () => {
    fail(400, {
      error: "Bearer abc.def.ghi was rejected for pat@secret.example",
    });
    const failure = await failureOf(read());
    expect(failure.message).not.toContain("abc.def");
    expect(failure.message).not.toContain("secret.example");
  });
});

describe("run-workflow-operation: an answer that does not fit the mapping", () => {
  it("fails a source with no list, naming the operation and never the body", async () => {
    executeRequestMock.mockResolvedValue(
      answer({ message: "token sk-live-leak", errors: [] }),
    );
    const failure = await failureOf(
      run({ operationId: "hubspot.newLeads", cursor: "1" }),
    );
    expect(failure.errorCode).toBe("unexpected_response");
    expect(failure.message).toContain("hubspot.newLeads");
    expect(failure.message).not.toContain("sk-live-leak");
    expect(failure.sideEffect).toBe("none");
  });

  it("fails a read that is not JSON", async () => {
    executeRequestMock.mockResolvedValue(answer(undefined));
    const failure = await failureOf(
      run({
        operationId: "slack.findUserByEmail",
        fields: { email: "a@b.co" },
      }),
    );
    expect(failure.errorCode).toBe("unexpected_response");
  });

  it("fails a read whose response was cut by core's size limit", async () => {
    executeRequestMock.mockResolvedValue(
      answer({ partial: true }, { truncated: true, size: 9_000_000 }),
    );
    const failure = await failureOf(
      run({
        operationId: "slack.findUserByEmail",
        fields: { email: "a@b.co" },
      }),
    );
    expect(failure.errorCode).toBe("unexpected_response");
    expect(failure.message).toContain("9000000");
  });

  it("fails a read when core's answer has no response in it", async () => {
    executeRequestMock.mockResolvedValue({ provider: { id: "slack" } });
    const failure = await failureOf(
      run({
        operationId: "slack.findUserByEmail",
        fields: { email: "a@b.co" },
      }),
    );
    expect(failure.errorCode).toBe("unexpected_response");
  });

  it("marks a write that ran but shows no receipt as possibly done", async () => {
    executeRequestMock.mockResolvedValue(answer({ data: {} }));
    const failure = await failureOf(
      run({
        operationId: "pylon.addNote",
        fields: { ticketId: "t1", bodyHtml: "<p>hi</p>" },
      }),
    );
    expect(failure.errorCode).toBe("unexpected_response_outcome_unknown");
    expect(failure.sideEffect).toBe("maybe");
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain("pylon.addNote");
  });

  it("never turns an unreadable source into an empty list", async () => {
    executeRequestMock.mockResolvedValue(answer("<html>Bad gateway</html>"));
    await expect(
      run({ operationId: "gong.newCalls", window: { from: SINCE, to: UNTIL } }),
    ).rejects.toMatchObject({ errorCode: "unexpected_response" });
  });

  it("fails a source whose item has no date", async () => {
    executeRequestMock.mockResolvedValue(
      answer({ results: [{ id: "1", properties: { email: "a@b.co" } }] }),
    );
    await expect(
      run({ operationId: "hubspot.newLeads", cursor: "1" }),
    ).rejects.toMatchObject({ errorCode: "unexpected_response" });
  });

  it("fails when the provider left a path placeholder unfilled", async () => {
    executeRequestMock.mockResolvedValue(
      answer({}, { path: "/organizations/%7BorgSlug%7D/issues/42/" }),
    );
    const failure = await failureOf(
      run({ operationId: "sentry.issueStatus", fields: { issueId: "42" } }),
    );
    expect(failure.errorCode).toBe("provider_not_configured");
    expect(failure.message).toContain("orgSlug");
  });

  it("does not mistake braces in a query for an unfilled placeholder", async () => {
    executeRequestMock.mockResolvedValue(
      answer(
        { ok: true },
        { path: "/organizations/acme/issues/42/?q=%7BorgSlug%7D" },
      ),
    );
    const result = await run({
      operationId: "sentry.issueStatus",
      fields: { issueId: "42" },
    });
    expect(result.ok).toBe(true);
  });
});

describe("run-workflow-operation: core throws", () => {
  const read = () =>
    run({ operationId: "hubspot.ownerById", fields: { ownerId: "77" } });

  it("names the provider and where to connect it when a connection is missing", async () => {
    executeRequestMock.mockRejectedValue(
      new Error("hubspot requires an available workspace connection."),
    );
    const failure = await failureOf(
      run({ operationId: "hubspot.ownerById", fields: { ownerId: "77" } }),
    );
    expect(failure.errorCode).toBe("credential_missing");
    expect(failure.message).toContain("hubspot");
    expect(failure.message).toContain("Dispatch");
    expect(failure.sideEffect).toBe("none");
    expect(failure.retryable).toBe(false);
  });

  it("points a key-only provider at Keys", async () => {
    executeRequestMock.mockRejectedValue(
      new Error("STRIPE_SECRET_KEY not configured"),
    );
    const failure = await failureOf(
      run({
        operationId: "stripe.customerBilling",
        fields: { email: "a@b.co" },
      }),
    );
    expect(failure.errorCode).toBe("credential_missing");
    expect(failure.message).toContain("stripe");
    expect(failure.message).toContain("Keys");
  });

  it("maps core's connection-required signal the same way", async () => {
    executeRequestMock.mockRejectedValue(
      Object.assign(new Error("Connect hubspot to continue."), {
        name: "AgentConnectionRequiredError",
      }),
    );
    expect((await failureOf(read())).errorCode).toBe("credential_missing");
  });

  it("is retryable and side-effect free for a read that timed out", async () => {
    executeRequestMock.mockRejectedValue(
      new Error(
        "Provider API request timed out after 30000ms: GET api.hubapi.com/x?email=pat@example.com",
      ),
    );
    const failure = await failureOf(read());
    expect(failure.errorCode).toBe("provider_request_failed");
    expect(failure.sideEffect).toBe("none");
    expect(failure.retryable).toBe(true);
    expect(failure.message).not.toContain("pat@example.com");
  });

  it("is possibly done for a write that timed out, and is never retryable", async () => {
    executeRequestMock.mockRejectedValue(
      new Error("Provider API request timed out after 30000ms: POST host/x"),
    );
    const failure = await failureOf(
      run({
        operationId: "pylon.addNote",
        fields: { ticketId: "t1", bodyHtml: "<p>hi</p>" },
      }),
    );
    expect(failure.errorCode).toBe("provider_request_outcome_unknown");
    expect(failure.sideEffect).toBe("maybe");
    expect(failure.retryable).toBe(false);
  });

  it("treats an error it does not recognize as possibly done for a write", async () => {
    executeRequestMock.mockRejectedValue(new Error("something new broke"));
    const failure = await failureOf(
      run({
        operationId: "pylon.addNote",
        fields: { ticketId: "t1", bodyHtml: "<p>hi</p>" },
      }),
    );
    expect(failure.sideEffect).toBe("maybe");
  });

  it("is side-effect free when core refused before sending", async () => {
    executeRequestMock.mockRejectedValue(
      new Error("Blocked private/internal provider URL: http://10.0.0.1/x"),
    );
    const failure = await failureOf(
      run({
        operationId: "pylon.addNote",
        fields: { ticketId: "t1", bodyHtml: "<p>hi</p>" },
      }),
    );
    expect(failure.errorCode).toBe("provider_request_refused");
    expect(failure.sideEffect).toBe("none");
    expect(failure.message).not.toContain("10.0.0.1");
  });
});

describe("run-workflow-operation: every operation in the catalog", () => {
  const requests = OPERATION_CATALOG.list().flatMap((def) =>
    def.implementation.type === "provider-request" ? [def] : [],
  );

  const BRACES = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

  function stringsIn(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(stringsIn);
    if (typeof value === "object" && value !== null) {
      return Object.values(value).flatMap(stringsIn);
    }
    return [];
  }

  function sampleValue(
    def: OperationDefinition,
    field: OperationDefinition["fields"][number],
  ): unknown {
    switch (field.type) {
      case "number":
        return 5;
      case "boolean":
        return true;
      case "enum":
        return field.enum?.[0];
      case "json":
        return {};
      default:
        break;
    }
    if (field.name === "repo") return "acme/app";
    if (field.name === "path") return "docs/readme.md";
    if (field.name === "table") return "proj.billing.export_v1";
    if (field.name === "email") return "pat@example.com";
    return `sample-${field.name}`;
  }

  function leaks(
    def: OperationDefinition,
    built: ReturnType<typeof buildProviderRequest>,
  ) {
    const declared = new Set<string>([
      ...def.fields.map((field) => field.name),
      ...(def.cursor ? [def.cursor.param] : []),
      ...(def.window ? [def.window.fromParam, def.window.toParam] : []),
    ]);
    const found: string[] = [];
    for (const text of [
      built.path,
      ...Object.values(built.query),
      ...stringsIn(built.body),
    ]) {
      for (const match of text.matchAll(BRACES)) {
        if (declared.has(match[1])) found.push(match[1]);
      }
    }
    return found;
  }

  it("covers every provider-request operation", () => {
    expect(requests.length).toBeGreaterThanOrEqual(20);
  });

  it("leaves no declared placeholder in the URL, query or body", () => {
    for (const def of requests) {
      const fields = Object.fromEntries(
        def.fields.map((field) => [field.name, sampleValue(def, field)]),
      );
      const built = buildProviderRequest(def, {
        fields,
        ...(def.cursor ? { cursor: "123" } : {}),
        ...(def.window ? { window: { from: SINCE, to: UNTIL } } : {}),
      });
      expect(leaks(def, built), `${def.id} with every field`).toEqual([]);
      expect(built.openPlaceholders, def.id).toEqual([]);
    }
  });

  it("leaves a hole only where core fills it, when optional fields are left out", () => {
    for (const def of requests) {
      const fields = Object.fromEntries(
        def.fields
          .filter((field) => field.required)
          .map((field) => [field.name, sampleValue(def, field)]),
      );
      const built = buildProviderRequest(def, {
        fields,
        ...(def.window ? { window: { from: SINCE, to: UNTIL } } : {}),
      });
      const open = new Set(built.openPlaceholders);
      const inUrl = [...built.path.matchAll(BRACES)].map((m) => m[1]);
      for (const name of leaks(def, built)) {
        expect(
          open.has(name) && inUrl.includes(name),
          `${def.id} {${name}}`,
        ).toBe(true);
      }
      for (const text of [
        ...Object.values(built.query),
        ...stringsIn(built.body),
      ]) {
        for (const match of text.matchAll(BRACES)) {
          const optionalField = def.fields.some(
            (field) => field.name === match[1] && !field.required,
          );
          expect(
            optionalField,
            `${def.id} {${match[1]}} in a body or query`,
          ).toBe(false);
        }
      }
    }
  });

  it("classifies a write as a write and never as a read", () => {
    for (const def of requests) {
      const effect = action.planMode.effect({ operationId: def.id });
      expect(effect, def.id).toBe(def.effect);
      if (def.effect === "write") {
        expect(effect, def.id).not.toBe("read");
        expect(action.retrySafe({ operationId: def.id }), def.id).toBe(false);
      } else {
        expect(action.retrySafe({ operationId: def.id }), def.id).toBe(true);
      }
    }
  });

  it("sends a write only with a method that writes", () => {
    for (const def of requests) {
      if (def.implementation.type !== "provider-request") continue;
      if (def.effect === "write") {
        expect(def.implementation.method, def.id).not.toBe("GET");
      }
    }
  });
});

describe("run-workflow-operation: tripwires", () => {
  const SECRET = "xoxb-FAKE-0000-aaaaaaaaaaaa";
  const BEARER = "FAKE-bearer-0000aaaa";
  const EMAIL = "pat@secret.example";
  // The same call with a sink that drops every event: the baseline an observed call must match.
  const discard: TripwireSink = () => undefined;

  function runObserved(input: Call, sink: TripwireSink) {
    return withRunObserver(createRunObserver(sink), () => run(input));
  }

  function stored(event: TripwireInput) {
    return { ...event, details: sanitizeDetails(event.details).fields };
  }

  function expectNoPlanted(value: unknown) {
    const text = JSON.stringify(value);
    for (const planted of [SECRET, BEARER, EMAIL]) {
      expect(text).not.toContain(planted);
    }
  }

  function expectSameFailure(observed: Failure, unobserved: Failure) {
    expect({
      errorCode: observed.errorCode,
      message: observed.message,
      sideEffect: observed.sideEffect,
      retryable: observed.retryable,
    }).toEqual({
      errorCode: unobserved.errorCode,
      message: unobserved.message,
      sideEffect: unobserved.sideEffect,
      retryable: unobserved.retryable,
    });
  }

  function answerWithSources(
    json: unknown,
    sources: Record<string, unknown>[],
  ) {
    const base = answer(json);
    return {
      ...base,
      request: { ...base.request, credentialSources: sources },
    };
  }

  const pylonNote = { ticketId: "t1", bodyHtml: "<p>hi</p>" };

  it("records a list that 404s", async () => {
    executeRequestMock.mockResolvedValue(
      answer(
        {
          error: "users_not_found",
          detail: `Bearer ${BEARER} for ${EMAIL}`,
          token: SECRET,
        },
        { status: 404 },
      ),
    );
    const input = { operationId: "hubspot.newLeads", cursor: "1" };
    const { sink, events } = createCapturingTripwireSink();

    const observed = await failureOf(runObserved(input, sink));
    const unobserved = await failureOf(runObserved(input, discard));

    expectSameFailure(observed, unobserved);
    expect(observed.errorCode).toBe("provider_not_found");
    // A list that 404s is a wrong path, not a record that is not there yet.
    expect(observed.retryable).toBe(false);
    expectNoPlanted(stored(events[0]));
  });

  it("records another unexpected status, such as a 400", async () => {
    executeRequestMock.mockResolvedValue(
      answer(
        { ok: false, error: "invalid_arguments", detail: EMAIL },
        { status: 400 },
      ),
    );
    const { sink, events } = createCapturingTripwireSink();

    const failure = await failureOf(
      runObserved(
        { operationId: "slack.findUserByEmail", fields: { email: "a@b.co" } },
        sink,
      ),
    );

    expect(failure.errorCode).toBe("provider_rejected");
    expectNoPlanted(stored(events[0]));
  });

  it.each([
    "sk_live_fake0000aaaaaaaaaaaa",
    "ghp_fake0000aaaaaaaaaaaaaaaaaaaaaaaa",
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    "Xoxb-FAKE-0000-aaaaaaaaaaaa",
    "invalid_auth with Bearer FAKE-bearer-0000aaaa",
  ])(
    "never echoes a token-shaped error word (%s) into the failure or the event",
    async (planted) => {
      executeRequestMock.mockResolvedValue(
        answer({ ok: false, error: planted }, { status: 400 }),
      );
      const { sink, events } = createCapturingTripwireSink();

      const failure = await failureOf(
        runObserved(
          { operationId: "slack.findUserByEmail", fields: { email: "a@b.co" } },
          sink,
        ),
      );

      expect(failure.errorCode).toBe("provider_rejected");
      expect(failure.message).toContain("(provider_error)");
      expect(failure.message).not.toContain(planted);
      // The raw event carries the body, which storage reduces to its shape.
      expect(JSON.stringify(stored(events[0]))).not.toContain(planted);
    },
  );

  it("records a write whose transport failed", async () => {
    executeRequestMock.mockRejectedValue(
      new Error(`socket hang up with Bearer ${BEARER}`),
    );
    const input = { operationId: "pylon.addNote", fields: pylonNote };
    const { sink, events } = createCapturingTripwireSink();

    const observed = await failureOf(runObserved(input, sink));
    const unobserved = await failureOf(runObserved(input, discard));

    expectSameFailure(observed, unobserved);
    expect(observed.errorCode).toBe("provider_request_outcome_unknown");
    expect(stored(events[0])).toMatchObject({
      details: {
        errorMessage: "socket hang up with [redacted]",
      },
    });
    expectNoPlanted(stored(events[0]));
  });

  it("records a write the provider answered with a 503", async () => {
    executeRequestMock.mockResolvedValue(
      answer({ error: "internal", detail: SECRET }, { status: 503 }),
    );
    const input = { operationId: "pylon.addNote", fields: pylonNote };
    const { sink, events } = createCapturingTripwireSink();

    const observed = await failureOf(runObserved(input, sink));
    const unobserved = await failureOf(runObserved(input, discard));

    expectSameFailure(observed, unobserved);
    expect(observed.errorCode).toBe("provider_request_outcome_unknown");
    expectNoPlanted(stored(events[0]));
  });

  it("records an answer the action cannot read", async () => {
    executeRequestMock.mockResolvedValue({
      provider: { id: "slack", note: SECRET },
    });
    const { sink, events } = createCapturingTripwireSink();

    const failure = await failureOf(
      runObserved(
        { operationId: "slack.findUserByEmail", fields: { email: "a@b.co" } },
        sink,
      ),
    );

    expect(failure.errorCode).toBe("unexpected_response");
    expectNoPlanted(stored(events[0]));
  });

  it("records a response cut by core's size limit", async () => {
    executeRequestMock.mockResolvedValue(
      answer(
        { partial: true, note: SECRET },
        { truncated: true, size: 9_000_000 },
      ),
    );
    const { sink, events } = createCapturingTripwireSink();

    const failure = await failureOf(
      runObserved(
        { operationId: "slack.findUserByEmail", fields: { email: "a@b.co" } },
        sink,
      ),
    );

    expect(failure.errorCode).toBe("unexpected_response");
    expectNoPlanted(stored(events[0]));
  });

  it.each([
    [
      "says ok: false with an error word",
      { ok: false, error: "users_not_found", detail: EMAIL },
    ],
    [
      "carries an errors list",
      { ok: true, errors: [{ message: EMAIL }, { message: SECRET }] },
    ],
    ["says the job is not complete", { jobComplete: false, note: SECRET }],
  ])(
    "records a 200 whose body %s and answers the same with or without it",
    async (_label, body) => {
      executeRequestMock.mockResolvedValue(answer(body));
      const input = {
        operationId: "slack.findUserByEmail",
        fields: { email: "a@b.co" },
      };
      const { sink, events } = createCapturingTripwireSink();

      const observed = await runObserved(input, sink);
      const unobserved = await runObserved(input, discard);

      expect(unobserved).toEqual(observed);
      expectNoPlanted(stored(events[0]));
    },
  );

  it("notes a provider's credential source", async () => {
    executeRequestMock.mockResolvedValue(
      answerWithSources({ ok: true }, [
        {
          key: "SLACK_BOT_TOKEN",
          source: "workspace_connection",
          provider: "slack",
          scope: "org",
          accountLabel: EMAIL,
        },
      ]),
    );
    const { sink, events } = createCapturingTripwireSink();

    await withRunObserver(createRunObserver(sink), async () => {
      await run({
        operationId: "slack.findUserByEmail",
        fields: { email: "a@b.co" },
      });
      await run({
        operationId: "slack.findUserByEmail",
        fields: { email: "c@d.co" },
      });
    });

    expectNoPlanted(stored(events[0]));
  });

  it("records a missing connection when the status check says it is connected", async () => {
    executeRequestMock.mockRejectedValue(
      new Error(
        `hubspot requires an available workspace connection. Bearer ${BEARER}`,
      ),
    );
    const connected = [
      {
        provider: "hubspot",
        status: "connected",
        connectWith: "workspace-connection",
        detail: SECRET,
      },
    ];
    const input = {
      operationId: "hubspot.ownerById",
      fields: { ownerId: "77" },
    };
    const { sink, events } = createCapturingTripwireSink();

    readConnectionsMock.mockResolvedValueOnce(connected);
    const observed = await failureOf(runObserved(input, sink));
    readConnectionsMock.mockResolvedValueOnce(connected);
    const unobserved = await failureOf(runObserved(input, discard));

    expectSameFailure(observed, unobserved);
    expect(observed.errorCode).toBe("credential_missing");
    expect(observed.message).not.toContain(BEARER);
    expectNoPlanted(stored(events[0]));
  });

  it("when the status check agrees the provider is not connected", async () => {
    executeRequestMock.mockRejectedValue(
      new Error("hubspot requires an available workspace connection."),
    );
    readConnectionsMock.mockResolvedValueOnce([
      {
        provider: "hubspot",
        status: "not connected",
        connectWith: "workspace-connection",
        detail: "Connect it in Dispatch or add its key to the vault.",
      },
    ]);
    const { sink } = createCapturingTripwireSink();

    const failure = await failureOf(
      runObserved(
        { operationId: "hubspot.ownerById", fields: { ownerId: "77" } },
        sink,
      ),
    );

    expect(failure.errorCode).toBe("credential_missing");
  });

  it("an answer that matches the catalog", async () => {
    const input = {
      operationId: "slack.findUserByEmail",
      fields: { email: "a@b.co" },
    };
    const { sink } = createCapturingTripwireSink();

    const observed = await runObserved(input, sink);
    const unobserved = await runObserved(input, discard);

    expect(unobserved).toEqual(observed);
  });
});
