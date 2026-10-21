import { defineAction } from "@agent-native/core/action";
import { loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Everything here runs through core's real guarded tool call, so the result
// text, the effect flags and the truncation marker are core's own, not a
// fake's. Only the audit store, the gate and the provider call are replaced.
const auditRows = vi.hoisted(() => [] as Record<string, any>[]);
const gateCalls = vi.hoisted(() => [] as Record<string, any>[]);
const providerMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../packages/core/dist/audit/store.js", async (original) => ({
  ...(await original<object>()),
  insertAuditEvent: async (event: Record<string, any>) => {
    auditRows.push(event);
  },
}));
vi.mock("../lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: async (
    context: Record<string, any>,
    identity: unknown,
    role: unknown,
    factoryId: unknown,
    options: unknown,
  ) => {
    gateCalls.push({ context, identity, role, factoryId, options });
  },
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
import { readWorkflowSlackThread } from "../connectors/slack-workflow.js";
import { fakeGitHub } from "../lib/factory-pull-request.fixture.js";
import {
  failGitHubStep,
  readPullRequestEvidence,
} from "../lib/factory-pull-request.js";
import { failWorkflowAction } from "../lib/workflow-action-errors.js";
import { GitHubRequestError } from "../triage/github-client.js";
import type { OperationRequest } from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import { createOperationExecutor } from "./operation-executor.js";

type Behavior = () => unknown;
const behavior = {
  read: (() => ({ ok: true })) as Behavior,
  write: (() => ({})) as Behavior,
};

// Stand-ins for two host actions, declared the way the real ones are.
const readAction = defineAction({
  description: "A read host action.",
  schema: z.object({}).passthrough(),
  http: false,
  readOnly: true,
  run: async () => behavior.read(),
});
const writeAction = defineAction({
  description: "A write host action.",
  schema: z.object({}).passthrough(),
  http: false,
  run: async () => behavior.write(),
});

const registry = loadActionsFromStaticRegistry({
  "run-workflow-operation": runWorkflowOperation,
  "list-factory-items": { default: readAction },
  "get-factory-merge-gate": { default: readAction },
  "read-slack-thread": { default: readAction },
  "post-slack-message": { default: writeAction },
});

const executor = createOperationExecutor({
  owner: "owner@example.test",
  orgId: "org-1",
  factoryId: "support-triage",
  automation: {
    triggerId: "job-1",
    triggerName: "factories/support-triage/flow",
  },
  runId: "run-1",
  signal: new AbortController().signal,
  deps: { actions: async () => registry },
});

function request(
  operationId: string,
  fields: Record<string, unknown>,
  extra: Partial<OperationRequest> = {},
): OperationRequest {
  const operation = OPERATION_CATALOG.get(operationId)!;
  return {
    operation,
    fields,
    credentialSlot: operation.credential.provider,
    mode: "live",
    signal: new AbortController().signal,
    ...(operation.effect === "write"
      ? { receiptKey: "wf:item-1:node-1:1" }
      : {}),
    ...extra,
  };
}

const answer = (json: unknown, status = 200) => ({
  request: { method: "POST", path: "/x" },
  response: { status, ok: status < 400, truncated: false, size: 10, json },
});

const lookup = () =>
  request("slack.findUserByEmail", { email: "pat@example.com" });
const note = () =>
  request("pylon.addNote", { ticketId: "t1", bodyHtml: "<p>x</p>" });
const slackPost = () =>
  request("slack.postMessage", { to: "C0123ABCD", text: "hello" });
const listItems = () =>
  request("factory.listItems", { status: "received", limit: 5 });

beforeEach(() => {
  auditRows.length = 0;
  gateCalls.length = 0;
  providerMock.mockReset();
  behavior.read = () => ({ ok: true });
  behavior.write = () => ({});
});

describe("the action entry core sees", () => {
  it("classifies a POST read as a read, safe to retry, and a write as neither", () => {
    const entry = registry["run-workflow-operation"] as any;
    expect(entry.planMode.effect({ operationId: "hubspot.newLeads" })).toBe(
      "read",
    );
    expect(entry.planMode.effect({ operationId: "pylon.reply" })).toBe("write");
    expect(entry.retrySafe({ operationId: "hubspot.newLeads" })).toBe(true);
    expect(entry.retrySafe({ operationId: "pylon.reply" })).toBe(false);
    expect(entry.mcpTool).toBe(false);
    expect(entry.http).toBe(false);
  });
});

describe("a provider-request operation through the guarded call", () => {
  it("runs the gate with the run's lineage and the operation id", async () => {
    providerMock.mockResolvedValue(answer({ ok: true, user: { id: "U1" } }));
    const result = await executor.execute(lookup());

    expect(result).toEqual({
      ok: true,
      output: { ok: true, user: { id: "U1" } },
    });
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0]).toMatchObject({
      role: "workflow",
      factoryId: "support-triage",
      options: { operationId: "slack.findUserByEmail" },
      context: {
        caller: "automation",
        actionName: "run-workflow-operation",
        runId: "run-1",
        automation: {
          triggerId: "job-1",
          triggerName: "factories/support-triage/flow",
        },
      },
    });
  });

  it("audits a write under its receipt key, without its inputs", async () => {
    providerMock.mockResolvedValue(answer({ data: { id: "note-1" } }));
    const result = await executor.execute(note());

    expect(result).toMatchObject({ ok: true, externalRef: "note-1" });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "run-workflow-operation",
      caller: "automation",
      turnId: "wf:item-1:node-1:1",
      runId: "run-1",
      targetType: "workflow-operation",
      targetId: "pylon.addNote",
      status: "success",
      input: null,
    });
  });

  it("primes a first live run and returns items on a later one", async () => {
    const page = {
      results: [
        {
          id: "9",
          createdAt: "2026-10-17T10:00:00Z",
          properties: { email: "x@y.co" },
        },
      ],
    };
    providerMock.mockResolvedValue(answer(page));
    const first = await executor.execute(
      request("hubspot.newLeads", {}, { limit: 50 }),
    );
    expect(first).toMatchObject({ ok: true, items: [], cursor: "9" });

    const later = await executor.execute(
      request("hubspot.newLeads", { since: "5" }, { limit: 50 }),
    );
    expect(later).toMatchObject({ ok: true, cursor: "9" });
    expect(later.ok && later.items).toHaveLength(1);
  });

  it("keeps a large nested response inside core's cut, flagged as truncated", async () => {
    const sentences = Array.from({ length: 20_000 }, (_, index) => ({
      text: `sentence ${index} lorem ipsum dolor sit amet`,
    }));
    providerMock.mockResolvedValue(
      answer({ callTranscripts: [{ callId: "c1", transcript: sentences }] }),
    );
    const result = await executor.execute(
      request("gong.transcript", { callId: "c1" }),
    );
    expect(result).toMatchObject({
      ok: true,
      output: { truncated: true, callTranscripts: [{ callId: "c1" }] },
    });
  });

  describe("a failure, as core words it", () => {
    it("retries a read that got a 503, and never a write that did", async () => {
      providerMock.mockResolvedValue(answer({}, 503));
      expect(await executor.execute(lookup())).toMatchObject({
        ok: false,
        code: "lookup_failed",
        sideEffect: "none",
        retryable: true,
      });
      expect(await executor.execute(note())).toMatchObject({
        ok: false,
        sideEffect: "maybe",
        retryable: false,
      });
    });

    it("treats a refused write as no side effect", async () => {
      providerMock.mockResolvedValue(answer({}, 400));
      expect(await executor.execute(note())).toMatchObject({
        ok: false,
        sideEffect: "none",
        retryable: false,
      });
    });

    it("keeps a timeout retryable for a read and possibly done for a write", async () => {
      providerMock.mockRejectedValue(
        new Error("Provider API request timed out after 30000ms: POST h/x"),
      );
      expect(await executor.execute(lookup())).toMatchObject({
        sideEffect: "none",
        retryable: true,
      });
      expect(await executor.execute(note())).toMatchObject({
        sideEffect: "maybe",
        retryable: false,
      });
    });

    it("names a missing connection", async () => {
      providerMock.mockRejectedValue(
        new Error("hubspot requires an available workspace connection."),
      );
      const result = await executor.execute(
        request("hubspot.ownerById", { ownerId: "1" }),
      );
      expect(result).toMatchObject({
        ok: false,
        code: "credential_missing",
        sideEffect: "none",
        retryable: false,
      });
      expect((result as { message: string }).message).toContain("hubspot");
    });

    it("fails a response that does not match the mapping, naming the operation", async () => {
      providerMock.mockResolvedValue(answer({ results: "nope" }));
      const result = await executor.execute(
        request("hubspot.newLeads", {}, { limit: 5 }),
      );
      expect(result).toMatchObject({ ok: false, sideEffect: "none" });
      expect((result as { message: string }).message).toContain(
        "hubspot.newLeads",
      );
    });

    it("refuses an unsafe path before anything is sent", async () => {
      const result = await executor.execute(
        request("github.readFile", { repo: "a/b", path: "../x" }),
      );
      expect(result).toMatchObject({ ok: false, sideEffect: "none" });
      expect(providerMock).not.toHaveBeenCalled();
    });
  });
});

describe("an action operation through the guarded call", () => {
  it("reads core's truncation marker as an over-cap read and a possibly-done write", async () => {
    const huge = {
      ok: true,
      items: Array.from({ length: 6000 }, (_, i) => ({ i })),
    };
    behavior.read = () => huge;
    expect(await executor.execute(listItems())).toMatchObject({
      ok: false,
      code: "output_over_cap",
      sideEffect: "none",
    });

    behavior.write = () => ({ ...huge, ts: "1.1" });
    expect(await executor.execute(slackPost())).toMatchObject({
      ok: false,
      code: "effect_needs_check",
      sideEffect: "maybe",
    });
  });

  it("returns a write's receipt", async () => {
    behavior.write = () => ({
      ok: true,
      channel: "C0123ABCD",
      ts: "1700000000.000200",
      permalink: "https://example.slack.com/archives/C0123ABCD/p1",
    });
    expect(await executor.execute(slackPost())).toEqual({
      ok: true,
      output: {
        ok: true,
        channel: "C0123ABCD",
        ts: "1700000000.000200",
        permalink: "https://example.slack.com/archives/C0123ABCD/p1",
      },
      externalRef: "1700000000.000200",
      url: "https://example.slack.com/archives/C0123ABCD/p1",
    });
  });

  it("maps a typed write failure by its code, not by what core guesses", async () => {
    behavior.write = () =>
      failWorkflowAction({
        message: "Slack is rate limiting this workspace.",
        errorCode: "slack_rate_limited",
        retryable: true,
      });
    expect(await executor.execute(slackPost())).toMatchObject({
      ok: false,
      sideEffect: "none",
      retryable: true,
    });

    behavior.write = () =>
      failWorkflowAction({
        message: "Slack did not confirm the post.",
        errorCode: "slack_post_outcome_unknown",
      });
    expect(await executor.execute(slackPost())).toMatchObject({
      ok: false,
      sideEffect: "maybe",
      retryable: false,
    });

    behavior.write = () =>
      failWorkflowAction({
        message: "The connected Slack credential was refused.",
        errorCode: "slack_access_denied",
      });
    expect(await executor.execute(slackPost())).toMatchObject({
      ok: false,
      code: "credential_missing",
      sideEffect: "none",
    });
  });

  it("treats an untyped write failure as possibly done, and an untyped read failure as none", async () => {
    behavior.write = () => {
      throw new Error("socket hang up");
    };
    expect(await executor.execute(slackPost())).toMatchObject({
      ok: false,
      sideEffect: "maybe",
    });
    behavior.read = () => {
      throw new Error("socket hang up");
    };
    expect(await executor.execute(listItems())).toMatchObject({
      ok: false,
      sideEffect: "none",
    });
  });

  it("fails input the action's own schema rejects, as no side effect, before any provider call", async () => {
    const result = await executor.execute(
      request("hubspot.newLeads", { since: "5" }, { limit: 1000 }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "lookup_failed",
      sideEffect: "none",
      retryable: false,
    });
    expect(providerMock).not.toHaveBeenCalled();
  });
});

describe("a typed failure carries its own retry flag", () => {
  const mergeGate = () =>
    request("factory.mergeGate", { repo: "acme/app", number: 7 });
  const readThread = () =>
    request("slack.readThread", { channel: "C0123ABCD", threadTs: "1.1" });
  const asReader = (getCompleteThread: unknown) =>
    ({ getCompleteThread }) as never;
  const thread = {
    workspace: {} as never,
    channel: "C0123ABCD",
    threadTs: "1.1",
  };

  it("retries the merge gate when GitHub's review threads could not be read", async () => {
    const github = fakeGitHub({
      listPullRequestReviewThreads: vi.fn().mockResolvedValue(null),
    });
    behavior.read = () =>
      readPullRequestEvidence(
        github as never,
        { owner: "acme", repo: "app" },
        7,
      );
    expect(await executor.execute(mergeGate())).toMatchObject({
      ok: false,
      code: "lookup_failed",
      sideEffect: "none",
      retryable: true,
    });
  });

  it("retries a Slack thread read that stopped paging, and not one that is too long", async () => {
    behavior.read = () =>
      readWorkflowSlackThread(
        asReader(
          vi
            .fn()
            .mockRejectedValue(
              new Error(
                "Slack thread pagination is incomplete because the provider omitted its next cursor.",
              ),
            ),
        ),
        thread,
      );
    expect(await executor.execute(readThread())).toMatchObject({
      ok: false,
      sideEffect: "none",
      retryable: true,
    });

    behavior.read = () =>
      readWorkflowSlackThread(
        asReader(vi.fn().mockResolvedValue({ hasMore: true, messages: [] })),
        thread,
      );
    expect(await executor.execute(readThread())).toMatchObject({
      ok: false,
      sideEffect: "none",
      retryable: false,
    });
  });

  it("does not retry a code that ends like a transient one when its action says it is final", async () => {
    behavior.read = () =>
      failGitHubStep(
        new GitHubRequestError("Unprocessable", true, 422),
        "reading the pull request",
      );
    expect(await executor.execute(mergeGate())).toMatchObject({
      ok: false,
      sideEffect: "none",
      retryable: false,
    });

    behavior.read = () =>
      failGitHubStep(
        new GitHubRequestError("Bad gateway", true, 502),
        "reading the pull request",
      );
    expect(await executor.execute(mergeGate())).toMatchObject({
      ok: false,
      retryable: true,
    });
  });

  it("falls back to the code's spelling for a failure that carried no flag", async () => {
    behavior.read = () => {
      throw Object.assign(new Error("Slow."), {
        actionContractError: true,
        errorCode: "provider_timeout",
        statusCode: 424,
      });
    };
    expect(await executor.execute(listItems())).toMatchObject({
      ok: false,
      sideEffect: "none",
      retryable: true,
    });
  });
});

describe("a read that finds nothing yet", () => {
  it("retries a lookup by id that 404s, and never a list or a write that does", async () => {
    providerMock.mockResolvedValue(answer({}, 404));
    expect(
      await executor.execute(request("gong.transcript", { callId: "c1" })),
    ).toMatchObject({
      ok: false,
      code: "lookup_failed",
      sideEffect: "none",
      retryable: true,
    });
    expect(
      await executor.execute(request("gong.newCalls", {}, { limit: 5 })),
    ).toMatchObject({
      ok: false,
      retryable: false,
    });
    expect(await executor.execute(note())).toMatchObject({
      ok: false,
      sideEffect: "none",
      retryable: false,
    });
  });
});

describe("a source that skipped rows", () => {
  it("returns the count in its output, beside the items it kept", async () => {
    providerMock.mockResolvedValue(
      answer({
        results: [
          {
            id: "30",
            createdAt: "2026-10-19T10:00:00.000Z",
            properties: { email: "a@x.test" },
          },
          { id: "20", properties: { email: "b@x.test" } },
        ],
      }),
    );
    const result = await executor.execute(
      request("hubspot.newLeads", { since: "5" }, { limit: 50 }),
    );
    expect(result).toMatchObject({
      ok: true,
      output: { itemCount: 1, skippedRows: 1 },
    });
    expect(result.ok && result.items).toHaveLength(1);
  });
});
