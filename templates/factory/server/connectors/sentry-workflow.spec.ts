import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/provider-api.js", () => ({
  FACTORY_APP_ID: "factory",
  executeProviderApiRequest: executeMock,
}));
vi.mock("../lib/factory-workflow-connections.js", () => ({
  readProviderConnections: vi.fn(async () => []),
}));

import {
  createRunObserver,
  withRunObserver,
} from "../lib/workflow-run-observer.js";
import { createCapturingTripwireSink } from "../tripwire/testing.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import { operationOutputs } from "../workflow/operations.js";
import {
  assignSentryIssue,
  auditedIssueId,
  resolveSentryIssue,
  sentryWriteAuditSummary,
} from "./sentry-workflow.js";

const call = {
  identity: {
    userEmail: "owner@example.test",
    orgId: "org-1",
    factoryId: "f1",
  },
};

interface Failure extends Error {
  errorCode: string;
  sideEffect: "none" | "maybe";
  retryable: boolean;
}

async function failureOf(work: Promise<unknown>): Promise<Failure> {
  try {
    await work;
  } catch (error) {
    return error as Failure;
  }
  throw new Error("Expected the call to fail.");
}

function answer(json: unknown, status = 200, path = "/organizations/acme/x/") {
  return {
    request: { method: "PUT", path },
    response: {
      status,
      ok: status >= 200 && status < 300,
      truncated: false,
      size: 100,
      json,
    },
  };
}

const PERMALINK = "https://sentry.io/organizations/acme/issues/4812/";

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: "4812",
    shortId: "WEB-1A",
    status: "resolved",
    assignedTo: null,
    permalink: PERMALINK,
    ...overrides,
  };
}

const sent = (index: number) =>
  executeMock.mock.calls[index]?.[0] as Record<string, unknown>;
const methods = () =>
  executeMock.mock.calls.map(([args]) => (args as { method: string }).method);

const resolve = (input: Record<string, unknown> = {}) =>
  resolveSentryIssue(call, {
    issueId: "4812",
    orgSlug: "acme",
    resolution: "resolved",
    ...input,
  });
const assign = (input: Record<string, unknown> = {}) =>
  assignSentryIssue(call, {
    issueId: "4812",
    orgSlug: "acme",
    assigneeKind: "user",
    assignee: "ada@example.test",
    ...input,
  });

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockResolvedValue(answer(issue()));
});

describe("sentry.resolveIssue", () => {
  it("sends one PUT that sets the status, and returns what Sentry confirmed", async () => {
    const result = await resolve();

    expect(result).toEqual({
      ok: true,
      issueId: "4812",
      inNextRelease: false,
      url: PERMALINK,
      externalRef: "4812:resolved",
    });
    expect(methods()).toEqual(["PUT"]);
    expect(sent(0)).toMatchObject({
      provider: "sentry",
      method: "PUT",
      path: "/organizations/acme/issues/4812/",
      body: { status: "resolved" },
    });
  });

  it("can resolve in the next release", async () => {
    const result = await resolve({ resolution: "resolvedInNextRelease" });

    expect(result).toMatchObject({ inNextRelease: true });
    expect(sent(0).body).toEqual({ status: "resolvedInNextRelease" });
  });

  it("leaves the organization to the connection when none is named", async () => {
    await resolve({ orgSlug: undefined });

    expect(sent(0).path).toBe("/organizations/{orgSlug}/issues/4812/");
  });

  it("fails when the connection has no organization to fill in", async () => {
    executeMock.mockResolvedValue(
      answer(issue(), 200, "/organizations/{orgSlug}/issues/4812/"),
    );

    const failure = await failureOf(resolve({ orgSlug: undefined }));

    expect(failure.errorCode).toBe("provider_not_configured");
    expect(failure.sideEffect).toBe("none");
  });

  it("does not make up a link Sentry did not send", async () => {
    executeMock.mockResolvedValue(
      answer(issue({ permalink: "javascript:alert(1)" })),
    );

    expect((await resolve()).url).toBeNull();
  });

  it.each([
    ["an id with letters", { issueId: "WEB-1A" }],
    ["an id that is a path", { issueId: "4812/events" }],
    ["an id with a query", { issueId: "4812?x=1" }],
    [
      "a full URL as the id",
      { issueId: "https://sentry.io/api/0/issues/4812/" },
    ],
    ["an empty id", { issueId: "  " }],
    ["an organization that is a path", { orgSlug: "acme/../other" }],
    ["a full URL as the organization", { orgSlug: "https://evil.test" }],
    [
      "a resolution Sentry has but this step does not",
      { resolution: "ignored" },
    ],
  ])("never reaches Sentry with %s", async (_label, input) => {
    const failure = await failureOf(resolve(input));

    expect(failure.errorCode).toBe("sentry_input_invalid");
    expect(failure.sideEffect).toBe("none");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an answer that is not an issue", "ok"],
    ["an issue with another id", issue({ id: "9" })],
    ["an issue that is still unresolved", issue({ status: "unresolved" })],
    ["an issue with no status", issue({ status: undefined })],
  ])(
    "will not call it done on %s, and says the outcome is unknown",
    async (_l, json) => {
      executeMock.mockResolvedValue(answer(json));
      const { sink, events } = createCapturingTripwireSink();

      const failure = await failureOf(
        withRunObserver(createRunObserver(sink), resolve),
      );

      expect(failure).toMatchObject({
        errorCode: "unexpected_response_outcome_unknown",
        sideEffect: "maybe",
      });
      expect(methods()).toEqual(["PUT"]);
      expect(events.map((event) => event.code)).toContain(
        "provider_shape_unexpected",
      );
    },
  );

  it("never repeats a write whose outcome is unknown after a server error", async () => {
    executeMock.mockResolvedValue(answer({}, 503));
    const { sink, events } = createCapturingTripwireSink();

    const failure = await failureOf(
      withRunObserver(createRunObserver(sink), resolve),
    );

    expect(failure).toMatchObject({
      errorCode: "provider_request_outcome_unknown",
      sideEffect: "maybe",
      retryable: false,
    });
    expect(methods()).toEqual(["PUT"]);
    expect(events.map((event) => event.code)).toContain(
      "provider_write_ambiguous",
    );
  });

  it("never repeats a write whose outcome is unknown after a dropped connection", async () => {
    executeMock.mockRejectedValue(new Error("fetch failed"));

    const failure = await failureOf(resolve());

    expect(failure).toMatchObject({
      errorCode: "provider_request_outcome_unknown",
      sideEffect: "maybe",
    });
    expect(methods()).toEqual(["PUT"]);
  });

  it("reports a refusal, a missing issue and a refused credential as nothing done", async () => {
    for (const [status, errorCode] of [
      [400, "provider_rejected"],
      [404, "provider_not_found"],
      [403, "provider_access_denied"],
    ] as const) {
      executeMock.mockResolvedValue(answer({ detail: "No." }, status));
      const failure = await failureOf(resolve());
      expect(failure.errorCode).toBe(errorCode);
      expect(failure.sideEffect).toBe("none");
    }
  });

  it("says Sentry is not connected with the typed credential code", async () => {
    executeMock.mockRejectedValue(
      new Error("sentry requires an available workspace connection."),
    );

    const failure = await failureOf(resolve());

    expect(failure.errorCode).toBe("credential_missing");
    expect(failure.sideEffect).toBe("none");
  });
});

describe("sentry.assignIssue", () => {
  const ada = { type: "user", id: "7", name: "Ada Lovelace" };

  it("assigns a person by email with one PUT, and returns who Sentry says it is", async () => {
    executeMock.mockResolvedValue(answer(issue({ assignedTo: ada })));

    const result = await assign();

    expect(result).toEqual({
      ok: true,
      issueId: "4812",
      assignedType: "user",
      assignedName: "Ada Lovelace",
      url: PERMALINK,
      externalRef: "4812:user:ada@example.test",
    });
    expect(methods()).toEqual(["PUT"]);
    expect(sent(0)).toMatchObject({
      method: "PUT",
      path: "/organizations/acme/issues/4812/",
      body: { assignedTo: "ada@example.test" },
    });
  });

  it("reads a team's slug to its id first and assigns that id", async () => {
    executeMock
      .mockResolvedValueOnce(answer({ id: "55", slug: "backend" }))
      .mockResolvedValueOnce(
        answer(
          issue({ assignedTo: { type: "team", id: "55", name: "backend" } }),
        ),
      );

    const result = await assign({
      assigneeKind: "team",
      assignee: "backend",
    });

    expect(result).toMatchObject({
      assignedType: "team",
      assignedName: "backend",
      externalRef: "4812:team:backend",
    });
    expect(methods()).toEqual(["GET", "PUT"]);
    expect(sent(0)).toMatchObject({ path: "/teams/acme/backend/" });
    expect(sent(1).body).toEqual({ assignedTo: "team:55" });
  });

  it("refuses a team slug Sentry does not know, before anything is sent", async () => {
    executeMock.mockResolvedValueOnce(answer({ detail: "Not found" }, 404));

    const failure = await failureOf(
      assign({ assigneeKind: "team", assignee: "ghosts" }),
    );

    expect(failure).toMatchObject({
      errorCode: "sentry_team_not_found",
      sideEffect: "none",
    });
    expect(methods()).toEqual(["GET"]);
  });

  it("does not assign a team whose id it could not read", async () => {
    executeMock.mockResolvedValueOnce(answer({ id: "x", slug: "backend" }));

    const failure = await failureOf(
      assign({ assigneeKind: "team", assignee: "backend" }),
    );

    expect(failure).toMatchObject({
      errorCode: "unexpected_response",
      sideEffect: "none",
    });
    expect(methods()).toEqual(["GET"]);
  });

  it("treats a failed team read as safe to retry and sends nothing", async () => {
    executeMock.mockResolvedValueOnce(answer({}, 503));

    const failure = await failureOf(
      assign({ assigneeKind: "team", assignee: "backend" }),
    );

    expect(failure).toMatchObject({
      errorCode: "provider_unavailable",
      sideEffect: "none",
      retryable: true,
    });
    expect(methods()).toEqual(["GET"]);
  });

  it("unassigns with an empty assignee and wants Sentry to say nobody", async () => {
    executeMock.mockResolvedValue(answer(issue({ assignedTo: null })));

    const result = await assign({
      assigneeKind: "nobody",
      assignee: undefined,
    });

    expect(result).toMatchObject({
      assignedType: null,
      assignedName: null,
      externalRef: "4812:unassigned",
    });
    expect(sent(0).body).toEqual({ assignedTo: "" });
  });

  it.each([
    [
      "nobody with an assignee given",
      { assigneeKind: "nobody", assignee: "ada@example.test" },
    ],
    ["a person with no email", { assignee: undefined }],
    ["a person named by something that is not an email", { assignee: "ada" }],
    ["a person given as another actor id", { assignee: "team:55" }],
    ["two emails", { assignee: "a@example.test, b@example.test" }],
    [
      "a team slug with capitals",
      { assigneeKind: "team", assignee: "Backend" },
    ],
    [
      "a team slug that is a path",
      { assigneeKind: "team", assignee: "backend/../x" },
    ],
    [
      "a team given as an actor id",
      { assigneeKind: "team", assignee: "team:55" },
    ],
    ["a team with no slug", { assigneeKind: "team", assignee: " " }],
    ["a kind that is not one", { assigneeKind: "everyone", assignee: "x" }],
    ["an issue id that is not digits", { issueId: "4812/x" }],
    ["an organization that is not a slug", { orgSlug: "a b" }],
  ])("never reaches Sentry with %s", async (_label, input) => {
    const failure = await failureOf(assign(input));

    expect(failure.errorCode).toBe("sentry_input_invalid");
    expect(failure.sideEffect).toBe("none");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no assignment in the answer", issue({ assignedTo: undefined })],
    [
      "another kind of assignee",
      issue({ assignedTo: { type: "team", id: "7", name: "x" } }),
    ],
    ["an assignee that is not an object", issue({ assignedTo: "ada" })],
    ["an issue with another id", issue({ id: "9", assignedTo: ada })],
    ["an answer that is not an issue", "ok"],
  ])("will not call it done on %s", async (_label, json) => {
    executeMock.mockResolvedValue(answer(json));

    const failure = await failureOf(assign());

    expect(failure).toMatchObject({
      errorCode: "unexpected_response_outcome_unknown",
      sideEffect: "maybe",
    });
    expect(methods()).toEqual(["PUT"]);
  });

  it("will not call an unassign done while Sentry still names someone", async () => {
    executeMock.mockResolvedValue(answer(issue({ assignedTo: ada })));

    const failure = await failureOf(
      assign({ assigneeKind: "nobody", assignee: undefined }),
    );

    expect(failure.errorCode).toBe("unexpected_response_outcome_unknown");
  });

  it("will not call a team assignment done when Sentry answers with another team", async () => {
    executeMock
      .mockResolvedValueOnce(answer({ id: "55", slug: "backend" }))
      .mockResolvedValueOnce(
        answer(
          issue({ assignedTo: { type: "team", id: "99", name: "other" } }),
        ),
      );

    const failure = await failureOf(
      assign({ assigneeKind: "team", assignee: "backend" }),
    );

    expect(failure.errorCode).toBe("unexpected_response_outcome_unknown");
    expect(methods()).toEqual(["GET", "PUT"]);
  });

  it("never repeats a write whose outcome is unknown", async () => {
    executeMock.mockResolvedValue(answer({}, 500));
    expect((await failureOf(assign())).errorCode).toBe(
      "provider_request_outcome_unknown",
    );
    expect(methods()).toEqual(["PUT"]);

    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error("socket hang up"));
    expect((await failureOf(assign())).sideEffect).toBe("maybe");
    expect(methods()).toEqual(["PUT"]);
  });

  it("says Sentry is not connected with the typed credential code, and sends nothing", async () => {
    executeMock.mockRejectedValue(
      new Error("sentry requires an available workspace connection."),
    );

    const failure = await failureOf(assign());

    expect(failure.errorCode).toBe("credential_missing");
    expect(failure.sideEffect).toBe("none");
  });
});

describe("what the audit row says", () => {
  it("is the method and the path, never the assignee or a body", () => {
    expect(sentryWriteAuditSummary("4812")).toBe(
      "PUT sentry /organizations/{orgSlug}/issues/4812/",
    );
  });

  it("does not echo text that is not an id", () => {
    const hostile = "4812/../../sk-live-abcdefghijklmnopqrstuvwxyz0123456789";

    expect(sentryWriteAuditSummary(hostile)).toBe(
      "PUT sentry /organizations/{orgSlug}/issues/{issueId}/",
    );
    expect(auditedIssueId(hostile)).toBeUndefined();
    expect(auditedIssueId(" 4812 ")).toBe("4812");
  });
});

describe("what each operation declares", () => {
  const declared = (id: string) => {
    const def = OPERATION_CATALOG.get(id);
    if (!def) throw new Error(`${id} is not in the catalog`);
    return (operationOutputs(def) ?? []).map((output) => output.name).sort();
  };

  it("is exactly what the host returns, so no name is unreadable and none is missing", async () => {
    expect(Object.keys(await resolve()).sort()).toEqual(
      declared("sentry.resolveIssue"),
    );

    executeMock.mockResolvedValue(
      answer(issue({ assignedTo: { type: "user", id: "7", name: "Ada" } })),
    );
    expect(Object.keys(await assign()).sort()).toEqual(
      declared("sentry.assignIssue"),
    );
  });
});
