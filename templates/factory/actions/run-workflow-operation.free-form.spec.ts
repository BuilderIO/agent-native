import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAutomationMock = vi.hoisted(() => vi.fn());
const executeRequestMock = vi.hoisted(() => vi.fn());

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
  readProviderConnections: vi.fn(async () => []),
}));

import { PROVIDER_PAYLOAD_BUDGET_CHARS } from "../server/workflow-host/provider-request.js";
import action from "./run-workflow-operation.js";

const context = {
  caller: "automation" as const,
  userEmail: "owner@example.test",
  actionName: "run-workflow-operation",
  signal: new AbortController().signal,
  automation: { triggerId: "job-1", triggerName: "factories/f1/wf" },
};

type Result = Record<string, any>;

const run = (
  operationId: string,
  fields: Record<string, unknown>,
): Promise<Result> =>
  (
    action as unknown as { run: (i: unknown, c: unknown) => Promise<Result> }
  ).run({ operationId, fields }, context);

interface Failure extends Error {
  errorCode: string;
  statusCode: number;
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

/** What core's runtime returns for an HTTP answer. */
function answer(
  json: unknown,
  extra: {
    status?: number;
    path?: string;
    headers?: Record<string, string>;
  } = {},
) {
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
}

/** What core returns for a paged read. */
const paged = (
  extra: Partial<{
    items: unknown[];
    pagesRead: number;
    truncated: boolean;
    nextCursor: string | null;
  }> = {},
) => ({
  provider: { id: "slack", label: "Slack" },
  pagesRead: extra.pagesRead ?? 2,
  totalItems: (extra.items ?? [{ id: 1 }, { id: 2 }]).length,
  lastStatus: 200,
  truncated: extra.truncated ?? false,
  nextCursor: extra.nextCursor ?? null,
  items: extra.items ?? [{ id: 1 }, { id: 2 }],
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAutomationMock.mockResolvedValue(undefined);
  executeRequestMock.mockResolvedValue(answer({ ok: true }));
});

describe("an API request, sent", () => {
  it("is a GET of the typed path with nothing else on the wire when only the path is given", async () => {
    executeRequestMock.mockResolvedValue(answer([{ number: 1 }]));
    const result = await run("github.apiRequest", {
      path: "repos/acme/web/issues",
    });

    expect(executeRequestMock).toHaveBeenCalledTimes(1);
    const sent = executeRequestMock.mock.calls[0][0];
    expect(sent).toMatchObject({
      provider: "github",
      method: "GET",
      path: "/repos/acme/web/issues",
      timeoutMs: 60_000,
    });
    for (const key of ["body", "headers", "auth", "fetchAllPages", "query"]) {
      expect(sent, key).not.toHaveProperty(key);
    }
    expect(result).toMatchObject({
      ok: true,
      operationId: "github.apiRequest",
      status: 200,
      output: [{ number: 1 }],
      truncated: false,
    });
  });

  it("passes the query, headers, timeout and no-credential switch to core", async () => {
    await run("github.apiRequest", {
      path: "/search/issues",
      query: { q: "repo:acme/web is:open", "labels[]": ["bug", "p1"] },
      headers: { "X-Request-Id": "r1" },
      authentication: "none",
      timeoutSeconds: 7,
    });
    expect(executeRequestMock.mock.calls[0][0]).toMatchObject({
      provider: "github",
      method: "GET",
      path: "/search/issues",
      query: { q: "repo:acme/web is:open", "labels[]": ["bug", "p1"] },
      headers: { "X-Request-Id": "r1" },
      auth: "none",
      timeoutMs: 7_000,
    });
  });

  it("returns the provider's JSON as the output, exactly", async () => {
    const body = { ok: true, channels: [{ id: "C1", name: "general" }] };
    executeRequestMock.mockResolvedValue(answer(body));
    expect(
      (await run("slack.apiRequest", { path: "conversations.list" })).output,
    ).toEqual(body);
  });

  it("cuts a big answer at the existing budget and says so", async () => {
    const items = Array.from({ length: 4_000 }, (_, index) => ({
      id: index,
      title: `A long issue title number ${index} with some words in it`,
    }));
    executeRequestMock.mockResolvedValue(answer({ items }));
    const result = await run("github.apiRequest", { path: "issues" });

    expect(result.truncated).toBe(true);
    expect(result.output.truncated).toBe(true);
    expect(JSON.stringify(result.output).length).toBeLessThanOrEqual(
      PROVIDER_PAYLOAD_BUDGET_CHARS,
    );
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(48_000);
  });

  it("wraps the status and a few headers around the body when asked, and leaves cookies out", async () => {
    executeRequestMock.mockResolvedValue(
      answer([{ id: 1 }], {
        headers: {
          "content-type": "application/json",
          link: '<https://api.example.test/x?page=2>; rel="next"',
          "x-ratelimit-remaining": "4999",
          "retry-after": "3",
          "set-cookie": "session=abc",
          "www-authenticate": "Bearer",
        },
      }),
    );
    const result = await run("github.apiRequest", {
      path: "issues",
      includeStatus: true,
    });
    expect(result.output).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json",
        link: '<https://api.example.test/x?page=2>; rel="next"',
        "x-ratelimit-remaining": "4999",
        "retry-after": "3",
      },
      body: [{ id: 1 }],
    });
  });

  it("follows a cursor through core and answers the pages it read, saying when more were left", async () => {
    executeRequestMock.mockResolvedValue(
      paged({
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
        pagesRead: 3,
        truncated: true,
        nextCursor: "c4",
      }),
    );
    const result = await run("slack.apiRequest", {
      path: "users.list",
      query: { limit: 200 },
      pagination: {
        cursorPath: "response_metadata.next_cursor",
        cursorParam: "cursor",
        itemsPath: "members",
      },
    });

    expect(executeRequestMock.mock.calls[0][0]).toMatchObject({
      path: "/users.list",
      query: { limit: "200" },
      fetchAllPages: {
        cursorPath: "response_metadata.next_cursor",
        cursorParam: "cursor",
        itemsPath: "members",
        maxPages: 3,
      },
    });
    expect(result.output).toEqual({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      pagesRead: 3,
      moreAvailable: true,
      nextCursor: "c4",
    });
  });

  it("says nothing was left when the last page had no next cursor", async () => {
    executeRequestMock.mockResolvedValue(paged());
    const result = await run("slack.apiRequest", {
      path: "users.list",
      pagination: { cursorPath: "next", cursorParam: "cursor" },
    });
    expect(result.output).toMatchObject({
      pagesRead: 2,
      moreAvailable: false,
      nextCursor: null,
    });
  });

  it("cuts a long paged answer at the budget and says so, with the paging facts beside the items", async () => {
    const items = Array.from({ length: 4_000 }, (_, index) => ({
      id: index,
      note: `entry ${index} with enough text to matter`,
    }));
    executeRequestMock.mockResolvedValue(
      paged({ items, pagesRead: 5, truncated: true, nextCursor: "c6" }),
    );
    const result = await run("slack.apiRequest", {
      path: "users.list",
      pagination: { cursorPath: "next", cursorParam: "cursor", maxPages: 5 },
    });
    expect(result.output).toMatchObject({
      truncated: true,
      pagesRead: 5,
      moreAvailable: true,
      nextCursor: "c6",
    });
    expect(result.output.items.length).toBeLessThan(items.length);
  });

  it("refuses a paged answer it cannot read instead of calling it empty", async () => {
    executeRequestMock.mockResolvedValue({ items: "nope" });
    const failure = await failureOf(
      run("slack.apiRequest", {
        path: "users.list",
        pagination: { cursorPath: "next", cursorParam: "cursor" },
      }),
    );
    expect(failure.errorCode).toBe("unexpected_response");
  });
});

describe("an API request, refused before it is sent", () => {
  it.each([
    ["a full URL", { path: "https://evil.test/x" }, "full_url_refused"],
    [
      "a path that climbs out",
      { path: "repos/../../admin" },
      "unsafe_path_value",
    ],
    ["an encoded dot-dot", { path: "%2e%2e/admin" }, "unsafe_path_value"],
    ["a query in the path", { path: "issues?state=open" }, "unsafe_path_value"],
    [
      "a credential header",
      { path: "user", headers: { Authorization: "Bearer x" } },
      "header_denied",
    ],
    ["a bad query", { path: "user", query: { "a b": 1 } }, "invalid_query"],
    [
      "too many pages",
      {
        path: "user",
        pagination: { cursorPath: "n", cursorParam: "c", maxPages: 99 },
      },
      "invalid_pagination",
    ],
    [
      "a long timeout",
      { path: "user", timeoutSeconds: 120 },
      "invalid_timeout",
    ],
  ])(
    "fails %s as %s, with no side effect and no request",
    async (_label, fields, code) => {
      const failure = await failureOf(run("github.apiRequest", fields));
      expect(failure).toMatchObject({
        errorCode: code,
        statusCode: 400,
        sideEffect: "none",
        retryable: false,
      });
      expect(executeRequestMock).not.toHaveBeenCalled();
    },
  );

  it("names the header and keeps its value out of the error", async () => {
    const failure = await failureOf(
      run("github.apiRequest", {
        path: "user",
        headers: { "X-Api-Key": "hunter2-value" },
      }),
    );
    expect(failure.message).toContain("X-Api-Key");
    expect(failure.message).not.toContain("hunter2-value");
  });
});

describe("an API request, failed by the provider", () => {
  it("does not retry a 404, because the path was typed and will not mend", async () => {
    executeRequestMock.mockResolvedValue(
      answer({ message: "Not Found" }, { status: 404 }),
    );
    const failure = await failureOf(run("github.apiRequest", { path: "nope" }));
    expect(failure).toMatchObject({
      errorCode: "provider_not_found",
      sideEffect: "none",
      retryable: false,
    });
  });

  it("still retries a 404 on a curated read that may not exist yet", async () => {
    executeRequestMock.mockResolvedValue(answer({}, { status: 404 }));
    const failure = await failureOf(
      run("pylon.ticketThread", { ticketId: "t1" }),
    );
    expect(failure).toMatchObject({
      errorCode: "provider_not_found",
      retryable: true,
    });
  });

  it("retries a 429 and a 503 and never a refused credential", async () => {
    executeRequestMock.mockResolvedValue(answer({}, { status: 429 }));
    expect(
      await failureOf(run("github.apiRequest", { path: "x" })),
    ).toMatchObject({
      errorCode: "provider_rate_limited",
      retryable: true,
    });
    executeRequestMock.mockResolvedValue(answer({}, { status: 503 }));
    expect(
      await failureOf(run("github.apiRequest", { path: "x" })),
    ).toMatchObject({
      errorCode: "provider_unavailable",
      retryable: true,
    });
    executeRequestMock.mockResolvedValue(answer({}, { status: 403 }));
    expect(
      await failureOf(run("github.apiRequest", { path: "x" })),
    ).toMatchObject({
      errorCode: "provider_access_denied",
      retryable: false,
    });
  });

  it("fails as not connected when core has no credential to send", async () => {
    executeRequestMock.mockRejectedValue(
      new Error("GitHub is not configured."),
    );
    expect(
      await failureOf(run("github.apiRequest", { path: "user" })),
    ).toMatchObject({
      errorCode: "credential_missing",
    });
  });

  it("fails a placeholder core could not fill instead of sending it", async () => {
    executeRequestMock.mockResolvedValue(
      answer({}, { path: "/api/projects/%7BprojectId%7D/query/" }),
    );
    const failure = await failureOf(
      run("posthog.apiRequest", { path: "api/projects/{projectId}/query/" }),
    );
    expect(failure.errorCode).toBe("provider_not_configured");

    executeRequestMock.mockResolvedValue(
      answer({ results: [] }, { path: "/api/projects/123/query/" }),
    );
    expect(
      (
        await run("posthog.apiRequest", {
          path: "api/projects/{projectId}/query/",
        })
      ).output,
    ).toEqual({ results: [] });
  });

  it("reads a failed page of a paged read by its status, never by the body core quotes", async () => {
    const quoted = (status: number) =>
      new Error(
        `fetchAllPages request failed with HTTP ${status}: {"message":"internal-detail-xyz"}`,
      );
    const paging = {
      path: "users.list",
      pagination: { cursorPath: "next", cursorParam: "cursor" },
    };
    const expected: [number, string, boolean][] = [
      [404, "provider_not_found", false],
      [401, "provider_access_denied", false],
      [429, "provider_rate_limited", true],
      [502, "provider_unavailable", true],
      [400, "provider_rejected", false],
    ];
    for (const [status, errorCode, retryable] of expected) {
      executeRequestMock.mockRejectedValue(quoted(status));
      const failure = await failureOf(run("slack.apiRequest", paging));
      expect(failure, String(status)).toMatchObject({ errorCode, retryable });
      expect(failure.message).not.toContain("internal-detail-xyz");
    }
  });

  it("does not take a quoted body for a missing credential", async () => {
    executeRequestMock.mockRejectedValue(
      new Error(
        'fetchAllPages request failed with HTTP 400: {"error":"project not configured"}',
      ),
    );
    const failure = await failureOf(
      run("slack.apiRequest", {
        path: "users.list",
        pagination: { cursorPath: "next", cursorParam: "cursor" },
      }),
    );
    expect(failure.errorCode).toBe("provider_rejected");
  });

  it("reads a page cut at core's size limit as an unreadable answer", async () => {
    executeRequestMock.mockRejectedValue(
      new Error(
        "fetchAllPages page 2 was cut at the response size limit, so its items and next cursor are incomplete.",
      ),
    );
    const failure = await failureOf(
      run("slack.apiRequest", {
        path: "users.list",
        pagination: { cursorPath: "next", cursorParam: "cursor" },
      }),
    );
    expect(failure.errorCode).toBe("unexpected_response");
  });
});

describe("an API request, in the audit log", () => {
  const summary = (
    fields: Record<string, unknown>,
    status = "success",
    operationId = "github.apiRequest",
  ) => action.audit.summary({ operationId, fields }, {}, { status });

  it("records the method, the provider and the path, as chat's provider request does", () => {
    expect(summary({ path: "repos/acme/web/issues" })).toBe(
      "GET github /repos/acme/web/issues",
    );
    expect(summary({ path: "/repos/acme/web/issues" })).toBe(
      "GET github /repos/acme/web/issues",
    );
    expect(summary({ path: "users.list" }, "success", "slack.apiRequest")).toBe(
      "GET slack /users.list",
    );
  });

  it("leaves the query and header values out of the row", () => {
    const text = summary({
      path: "search/issues",
      query: { q: "password-reset hunter2", access_token: "ghp_abcdefghij" },
      headers: { "X-Request-Id": "req-secret-1" },
    });
    expect(text).toBe("GET github /search/issues");
    for (const planted of ["hunter2", "ghp_abcdefghij", "req-secret-1"]) {
      expect(text).not.toContain(planted);
    }
  });

  it("masks a path segment that looks like a credential", () => {
    expect(
      summary({ path: "tokens/abcdefghijklmnopqrstuvwxyz0123456789ABCD" }),
    ).toBe("GET github /tokens/[redacted]");
  });

  it("records an attempt that failed the same way, and a curated call as before", () => {
    expect(summary({ path: "user" }, "error")).toBe("GET github /user");
    expect(
      summary({ email: "a@b.co" }, "success", "slack.findUserByEmail"),
    ).toBe("Ran slack.findUserByEmail");
  });

  it("does not choke on a path that is not text, which the run refuses", () => {
    expect(summary({ path: 7 })).toBe("GET github /");
    expect(summary({})).toBe("GET github /");
  });
});

describe("an API request, as the action declares it", () => {
  it("is a read that is safe to retry", () => {
    expect(action.planMode.effect({ operationId: "github.apiRequest" })).toBe(
      "read",
    );
    expect(action.retrySafe({ operationId: "github.apiRequest" })).toBe(true);
  });
});
