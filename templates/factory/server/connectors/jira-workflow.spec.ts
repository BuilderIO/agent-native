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
  auditedIssueKey,
  getJiraIssue,
  jiraTransitionAuditSummary,
  listJiraTransitions,
  transitionJiraIssue,
} from "./jira-workflow.js";

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

function answer(json: unknown, status = 200) {
  return {
    request: { method: "GET", path: "/rest/api/2/issue/PROJ-123" },
    response: {
      status,
      ok: status >= 200 && status < 300,
      truncated: false,
      size: 100,
      json,
    },
  };
}

const done = {
  id: "31",
  name: "Done",
  to: { id: "10002", name: "Done", statusCategory: { key: "done" } },
};
const backToTodo = {
  id: "21",
  name: "Back to To Do",
  to: { id: "1", name: "To Do" },
};

function issue(
  overrides: { fields?: Record<string, unknown>; transitions?: unknown } = {},
) {
  return {
    id: "10001",
    key: "PROJ-123",
    fields: {
      summary: "Checkout fails",
      status: {
        id: "3",
        name: "In Progress",
        statusCategory: { key: "indeterminate", name: "In Progress" },
      },
      assignee: { accountId: "abc123", displayName: "Ada Lovelace" },
      resolution: null,
      labels: ["bug", "p1"],
      ...overrides.fields,
    },
    transitions: overrides.transitions ?? [done, backToTodo],
  };
}

const sent = (index: number) =>
  executeMock.mock.calls[index]?.[0] as Record<string, unknown>;
const methods = () =>
  executeMock.mock.calls.map(([args]) => (args as { method: string }).method);

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockResolvedValue(answer(issue()));
});

describe("jira.getIssue", () => {
  it("reads one issue and returns it flat and bounded, with the transition names", async () => {
    const result = await getJiraIssue(call, { issueKey: "PROJ-123" });

    expect(result).toEqual({
      ok: true,
      issueKey: "PROJ-123",
      summary: "Checkout fails",
      status: "In Progress",
      statusCategory: "indeterminate",
      resolution: null,
      assignee: "Ada Lovelace",
      labels: ["bug", "p1"],
      transitionNames: ["Done", "Back to To Do"],
      truncated: false,
    });
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(sent(0)).toMatchObject({
      provider: "jira",
      method: "GET",
      path: "/rest/api/2/issue/PROJ-123",
      query: {
        fields: "summary,status,assignee,resolution,labels",
        expand: "transitions",
      },
    });
    expect(sent(0)).not.toHaveProperty("body");
  });

  it("says nobody is assigned and what the resolution is, without inventing either", async () => {
    executeMock.mockResolvedValue(
      answer(
        issue({
          fields: { assignee: null, resolution: { id: "1", name: "Fixed" } },
        }),
      ),
    );

    expect(await getJiraIssue(call, { issueKey: "PROJ-123" })).toMatchObject({
      assignee: null,
      resolution: "Fixed",
    });
  });

  it("cuts a long list or text and says it did", async () => {
    executeMock.mockResolvedValue(
      answer(
        issue({
          fields: {
            summary: "s".repeat(900),
            labels: Array.from({ length: 80 }, (_, index) => `label-${index}`),
          },
          transitions: Array.from({ length: 70 }, (_, index) => ({
            id: String(index + 1),
            name: `Move ${index}`,
            to: { id: "9", name: "Elsewhere" },
          })),
        }),
      ),
    );

    const result = await getJiraIssue(call, { issueKey: "PROJ-123" });

    expect(result.truncated).toBe(true);
    expect(result.summary).toHaveLength(300);
    expect(result.labels).toHaveLength(50);
    expect(result.transitionNames).toHaveLength(50);
  });

  it.each([
    "",
    "proj-123",
    "PROJ",
    "PROJ-0",
    "P-1",
    "PROJ-123/../../rest/api/2/myself",
    "PROJ-123?expand=changelog",
    "https://example.atlassian.net/browse/PROJ-123",
    "PROJ-1\n23",
    "PROJ 123",
    "PROJ-12345678901",
  ])("refuses %j before Jira is called", async (issueKey) => {
    const failure = await failureOf(getJiraIssue(call, { issueKey }));

    expect(failure.errorCode).toBe("jira_issue_key_invalid");
    expect(failure.sideEffect).toBe("none");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no status", { fields: { status: null } }],
    ["no summary", { fields: { summary: undefined } }],
    ["no labels list", { fields: { labels: undefined } }],
    ["a label that is not text", { fields: { labels: ["ok", 4] } }],
    ["a resolution with no name", { fields: { resolution: {} } }],
    ["no transitions list", { transitions: "none" }],
    [
      "a transition with no destination",
      { transitions: [{ id: "1", name: "x" }] },
    ],
  ])("fails typed, never as an empty issue, on %s", async (_label, change) => {
    executeMock.mockResolvedValue(answer(issue(change)));
    const { sink, events } = createCapturingTripwireSink();

    const failure = await failureOf(
      withRunObserver(createRunObserver(sink), () =>
        getJiraIssue(call, { issueKey: "PROJ-123" }),
      ),
    );

    expect(failure.errorCode).toBe("unexpected_response");
    expect(failure.sideEffect).toBe("none");
    expect(events.map((event) => event.code)).toContain(
      "provider_shape_unexpected",
    );
  });

  it("says Jira is not connected with the typed credential code", async () => {
    executeMock.mockRejectedValue(
      new Error("jira requires an available workspace connection."),
    );

    const failure = await failureOf(
      getJiraIssue(call, { issueKey: "PROJ-123" }),
    );

    expect(failure.errorCode).toBe("credential_missing");
    expect(failure.message).toContain("Dispatch");
  });

  it("keeps a refused credential apart from a missing issue", async () => {
    executeMock.mockResolvedValue(answer({}, 403));
    expect(
      (await failureOf(getJiraIssue(call, { issueKey: "PROJ-123" }))).errorCode,
    ).toBe("provider_access_denied");

    executeMock.mockResolvedValue(answer({}, 404));
    expect(
      (await failureOf(getJiraIssue(call, { issueKey: "PROJ-123" }))).errorCode,
    ).toBe("provider_not_found");
  });
});

describe("jira.listTransitions", () => {
  it("lists id, name and destination of each transition", async () => {
    executeMock.mockResolvedValue(answer({ transitions: [done, backToTodo] }));

    const result = await listJiraTransitions(call, { issueKey: "PROJ-123" });

    expect(result).toEqual({
      ok: true,
      count: 2,
      transitions: [
        { id: "31", name: "Done", toStatus: "Done" },
        { id: "21", name: "Back to To Do", toStatus: "To Do" },
      ],
      truncated: false,
    });
    expect(sent(0)).toMatchObject({
      method: "GET",
      path: "/rest/api/2/issue/PROJ-123/transitions",
    });
  });

  it("says nothing is available with an empty list, which is not a failure", async () => {
    executeMock.mockResolvedValue(answer({ transitions: [] }));

    expect(
      await listJiraTransitions(call, { issueKey: "PROJ-123" }),
    ).toMatchObject({
      count: 0,
      transitions: [],
      truncated: false,
    });
  });

  it("counts every transition but lists at most 50, and says so", async () => {
    executeMock.mockResolvedValue(
      answer({
        transitions: Array.from({ length: 60 }, (_, index) => ({
          id: String(index + 1),
          name: `Move ${index}`,
          to: { id: "9", name: "Elsewhere" },
        })),
      }),
    );

    const result = await listJiraTransitions(call, { issueKey: "PROJ-123" });

    expect(result.count).toBe(60);
    expect(result.transitions).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it("refuses a bad key without calling Jira, and an answer it cannot read as a failure", async () => {
    expect(
      (await failureOf(listJiraTransitions(call, { issueKey: "nope" })))
        .errorCode,
    ).toBe("jira_issue_key_invalid");
    expect(executeMock).not.toHaveBeenCalled();

    executeMock.mockResolvedValue(answer({ values: [] }));
    expect(
      (await failureOf(listJiraTransitions(call, { issueKey: "PROJ-123" })))
        .errorCode,
    ).toBe("unexpected_response");
  });
});

describe("jira.transitionIssue", () => {
  it("reads the issue, resolves the name to Jira's own id, and sends that id once", async () => {
    executeMock
      .mockResolvedValueOnce(answer(issue()))
      .mockResolvedValueOnce(answer(undefined, 204));

    const result = await transitionJiraIssue(call, {
      issueKey: "PROJ-123",
      transition: "done",
    });

    expect(result).toEqual({
      ok: true,
      issueKey: "PROJ-123",
      fromStatus: "In Progress",
      status: "Done",
      alreadyInState: false,
      transitionName: "Done",
      externalRef: "PROJ-123:Done",
    });
    expect(methods()).toEqual(["GET", "POST"]);
    expect(sent(1)).toMatchObject({
      provider: "jira",
      method: "POST",
      path: "/rest/api/2/issue/PROJ-123/transitions",
      body: { transition: { id: "31" } },
    });
  });

  it("takes an id as well as a name", async () => {
    executeMock
      .mockResolvedValueOnce(answer(issue()))
      .mockResolvedValueOnce(answer(undefined, 204));

    const result = await transitionJiraIssue(call, {
      issueKey: "PROJ-123",
      transition: "21",
    });

    expect(result).toMatchObject({
      status: "To Do",
      transitionName: "Back to To Do",
    });
    expect(sent(1)).toMatchObject({ body: { transition: { id: "21" } } });
  });

  it("sends only the id Jira offered, never the text the graph supplied", async () => {
    executeMock
      .mockResolvedValueOnce(answer(issue()))
      .mockResolvedValueOnce(answer(undefined, 204));

    await transitionJiraIssue(call, {
      issueKey: "PROJ-123",
      transition: "  DONE  ",
    });

    expect(sent(1).body).toEqual({ transition: { id: "31" } });
  });

  it("succeeds without a write when the issue is already in the status named", async () => {
    executeMock.mockResolvedValueOnce(
      answer(
        issue({
          fields: {
            status: {
              id: "10002",
              name: "Done",
              statusCategory: { key: "done" },
            },
          },
          transitions: [backToTodo],
        }),
      ),
    );

    const result = await transitionJiraIssue(call, {
      issueKey: "PROJ-123",
      transition: "Done",
    });

    expect(result).toEqual({
      ok: true,
      issueKey: "PROJ-123",
      fromStatus: "Done",
      status: "Done",
      alreadyInState: true,
      transitionName: null,
      // The same reference a move into Done leaves.
      externalRef: "PROJ-123:Done",
    });
    expect(methods()).toEqual(["GET"]);
  });

  it("sends nothing for a transition that leads back to the status the issue is in", async () => {
    executeMock.mockResolvedValueOnce(
      answer(
        issue({
          fields: { status: { id: "10002", name: "Done" } },
          transitions: [done],
        }),
      ),
    );

    const result = await transitionJiraIssue(call, {
      issueKey: "PROJ-123",
      transition: "31",
    });

    expect(result).toMatchObject({ alreadyInState: true, status: "Done" });
    expect(methods()).toEqual(["GET"]);
  });

  it("refuses a name Jira does not offer, and lists the names it does", async () => {
    const failure = await failureOf(
      transitionJiraIssue(call, {
        issueKey: "PROJ-123",
        transition: "Ship it",
      }),
    );

    expect(failure.errorCode).toBe("jira_transition_not_found");
    expect(failure.sideEffect).toBe("none");
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain("Done");
    expect(failure.message).toContain("Back to To Do");
    expect(methods()).toEqual(["GET"]);
  });

  it("refuses a name that matches two transitions, naming both ids", async () => {
    executeMock.mockResolvedValueOnce(
      answer(
        issue({
          transitions: [
            { id: "31", name: "Close", to: { id: "10002", name: "Done" } },
            { id: "41", name: "close", to: { id: "10003", name: "Won't do" } },
          ],
        }),
      ),
    );

    const failure = await failureOf(
      transitionJiraIssue(call, { issueKey: "PROJ-123", transition: "Close" }),
    );

    expect(failure.errorCode).toBe("jira_transition_ambiguous");
    expect(failure.message).toContain("id 31");
    expect(failure.message).toContain("id 41");
    expect(methods()).toEqual(["GET"]);
  });

  it("lets an id pick between two transitions with the same name", async () => {
    executeMock
      .mockResolvedValueOnce(
        answer(
          issue({
            transitions: [
              { id: "31", name: "Close", to: { id: "10002", name: "Done" } },
              {
                id: "41",
                name: "Close",
                to: { id: "10003", name: "Won't do" },
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(answer(undefined, 204));

    const result = await transitionJiraIssue(call, {
      issueKey: "PROJ-123",
      transition: "41",
    });

    expect(result).toMatchObject({ status: "Won't do" });
    expect(sent(1).body).toEqual({ transition: { id: "41" } });
  });

  it("says plainly when the issue has no transition to offer", async () => {
    executeMock.mockResolvedValueOnce(answer(issue({ transitions: [] })));

    const failure = await failureOf(
      transitionJiraIssue(call, { issueKey: "PROJ-123", transition: "Done" }),
    );

    expect(failure.errorCode).toBe("jira_transition_not_found");
    expect(failure.message).toContain("no transition available");
  });

  it.each([
    [
      "a key that is not one",
      { issueKey: "PROJ-1/x", transition: "Done" },
      "jira_issue_key_invalid",
    ],
    [
      "a full URL as the key",
      { issueKey: "https://x.atlassian.net/browse/PROJ-1", transition: "Done" },
      "jira_issue_key_invalid",
    ],
    [
      "no transition",
      { issueKey: "PROJ-123", transition: "  " },
      "jira_transition_invalid",
    ],
    [
      "a transition with a line break",
      { issueKey: "PROJ-123", transition: "Done\nnow" },
      "jira_transition_invalid",
    ],
    [
      "a transition that is too long",
      { issueKey: "PROJ-123", transition: "x".repeat(121) },
      "jira_transition_invalid",
    ],
  ])("never reaches Jira with %s", async (_label, input, errorCode) => {
    const failure = await failureOf(transitionJiraIssue(call, input));

    expect(failure.errorCode).toBe(errorCode);
    expect(failure.sideEffect).toBe("none");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("sends nothing when Jira is not connected", async () => {
    executeMock.mockRejectedValue(
      new Error("jira requires an available workspace connection."),
    );

    const failure = await failureOf(
      transitionJiraIssue(call, { issueKey: "PROJ-123", transition: "Done" }),
    );

    expect(failure.errorCode).toBe("credential_missing");
    expect(methods()).toEqual(["GET"]);
  });

  it("treats a failed read as safe to retry and sends nothing", async () => {
    executeMock.mockResolvedValueOnce(answer({}, 503));

    const failure = await failureOf(
      transitionJiraIssue(call, { issueKey: "PROJ-123", transition: "Done" }),
    );

    expect(failure).toMatchObject({
      errorCode: "provider_unavailable",
      sideEffect: "none",
      retryable: true,
    });
    expect(methods()).toEqual(["GET"]);
  });

  it("fails typed when the issue cannot be read, instead of guessing a transition", async () => {
    executeMock.mockResolvedValueOnce(answer(issue({ transitions: "none" })));

    const failure = await failureOf(
      transitionJiraIssue(call, { issueKey: "PROJ-123", transition: "Done" }),
    );

    expect(failure.errorCode).toBe("unexpected_response");
    expect(failure.sideEffect).toBe("none");
    expect(methods()).toEqual(["GET"]);
  });

  describe("when the write itself fails", () => {
    const write = () =>
      transitionJiraIssue(call, { issueKey: "PROJ-123", transition: "Done" });

    beforeEach(() => {
      executeMock.mockReset();
      executeMock.mockResolvedValueOnce(answer(issue()));
    });

    it("never repeats a write whose outcome is unknown after a server error", async () => {
      executeMock.mockResolvedValueOnce(answer({}, 502));
      const { sink, events } = createCapturingTripwireSink();

      const failure = await failureOf(
        withRunObserver(createRunObserver(sink), write),
      );

      expect(failure).toMatchObject({
        errorCode: "provider_request_outcome_unknown",
        sideEffect: "maybe",
        retryable: false,
      });
      expect(methods()).toEqual(["GET", "POST"]);
      expect(events.map((event) => event.code)).toContain(
        "provider_write_ambiguous",
      );
    });

    it("never repeats a write whose outcome is unknown after a dropped connection", async () => {
      executeMock.mockRejectedValueOnce(new Error("fetch failed"));

      const failure = await failureOf(write());

      expect(failure).toMatchObject({
        errorCode: "provider_request_outcome_unknown",
        sideEffect: "maybe",
      });
      expect(methods()).toEqual(["GET", "POST"]);
    });

    it("reports a refusal as nothing done", async () => {
      executeMock.mockResolvedValueOnce(
        answer(
          { errorMessages: ["Transition 31 requires a resolution."] },
          400,
        ),
      );

      const failure = await failureOf(write());

      expect(failure).toMatchObject({
        errorCode: "provider_rejected",
        sideEffect: "none",
        retryable: false,
      });
      expect(failure.message).not.toContain("requires a resolution");
      expect(methods()).toEqual(["GET", "POST"]);
    });

    it("reports a refused credential as nothing done", async () => {
      executeMock.mockResolvedValueOnce(answer({}, 403));

      const failure = await failureOf(write());

      expect(failure).toMatchObject({
        errorCode: "provider_access_denied",
        sideEffect: "none",
      });
    });
  });

  it("passes the run's stop signal to Jira", async () => {
    const controller = new AbortController();
    executeMock
      .mockResolvedValueOnce(answer(issue()))
      .mockResolvedValueOnce(answer(undefined, 204));

    await transitionJiraIssue(
      { ...call, signal: controller.signal },
      { issueKey: "PROJ-123", transition: "Done" },
    );

    expect(sent(0).signal).toBe(controller.signal);
    expect(sent(1).signal).toBe(controller.signal);
  });
});

describe("what the audit row says", () => {
  it("is the method and the path, never the transition", () => {
    expect(jiraTransitionAuditSummary("PROJ-123")).toBe(
      "POST jira /rest/api/2/issue/PROJ-123/transitions",
    );
  });

  it("does not echo text that is not a key into the path or the target", () => {
    const hostile = "PROJ-1/../../sk-live-abcdefghijklmnopqrstuvwxyz0123456789";

    expect(jiraTransitionAuditSummary(hostile)).toBe(
      "POST jira /rest/api/2/issue/{issueKey}/transitions",
    );
    expect(auditedIssueKey(hostile)).toBeUndefined();
    expect(auditedIssueKey(" PROJ-123 ")).toBe("PROJ-123");
    expect(auditedIssueKey(42)).toBeUndefined();
  });
});

describe("what each operation declares", () => {
  const declared = (id: string) => {
    const def = OPERATION_CATALOG.get(id);
    if (!def) throw new Error(`${id} is not in the catalog`);
    return (operationOutputs(def) ?? []).map((output) => output.name).sort();
  };
  const keysOf = (result: object) => Object.keys(result).sort();

  it("is exactly what the host returns, so no name is unreadable and none is missing", async () => {
    executeMock.mockResolvedValueOnce(answer(issue()));
    expect(keysOf(await getJiraIssue(call, { issueKey: "PROJ-123" }))).toEqual(
      declared("jira.getIssue"),
    );

    executeMock.mockResolvedValueOnce(answer({ transitions: [done] }));
    expect(
      keysOf(await listJiraTransitions(call, { issueKey: "PROJ-123" })),
    ).toEqual(declared("jira.listTransitions"));

    // A move and a find-it-already-there answer with the same names.
    executeMock
      .mockResolvedValueOnce(answer(issue()))
      .mockResolvedValueOnce(answer(undefined, 204))
      .mockResolvedValueOnce(
        answer(
          issue({
            fields: { status: { id: "10002", name: "Done" } },
            transitions: [],
          }),
        ),
      );
    const moved = await transitionJiraIssue(call, {
      issueKey: "PROJ-123",
      transition: "Done",
    });
    const found = await transitionJiraIssue(call, {
      issueKey: "PROJ-123",
      transition: "Done",
    });
    expect(keysOf(moved)).toEqual(declared("jira.transitionIssue"));
    expect(keysOf(found)).toEqual(declared("jira.transitionIssue"));
  });
});
