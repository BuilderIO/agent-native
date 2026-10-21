import type {
  ActionEntry,
  AgentToolCallExecutionResult,
  ExecuteAgentToolCallOptions,
} from "@agent-native/core/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRunObserver,
  type RunObserver,
} from "../lib/workflow-run-observer.js";
import { sanitizeDetails } from "../tripwire/redact.js";
import { createCapturingTripwireSink } from "../tripwire/testing.js";
import type { TripwireInput } from "../tripwire/types.js";
import type { OperationRequest, OperationResult } from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { OperationDefinition } from "../workflow/operations.js";
import type { BuilderOperationDeps } from "./builder-operations.js";
import { createOperationExecutor } from "./operation-executor.js";

const SINCE = "2026-10-17T10:00:00.000Z";
const UNTIL = "2026-10-17T11:00:00.000Z";
const MARKER =
  "\n\n...[truncated — full result was 61,204 chars; only first 50,000 shown]";

function op(id: string): OperationDefinition {
  const def = OPERATION_CATALOG.get(id);
  if (!def) throw new Error(`${id} is not in the catalog`);
  return def;
}

const registry = new Proxy({} as Record<string, ActionEntry>, {
  get: (_target, name) =>
    typeof name === "string" && name !== "missing-action"
      ? ({} as ActionEntry)
      : undefined,
  has: (_target, name) => name !== "missing-action",
});

type Tool = AgentToolCallExecutionResult;
const completed = (value: unknown, extra: Partial<Tool> = {}): Tool =>
  ({
    status: "completed",
    output: typeof value === "string" ? value : JSON.stringify(value),
    ...extra,
  }) as Tool;
const failed = (output: string, completedSideEffect?: boolean): Tool => ({
  status: "failed",
  output,
  ...(completedSideEffect === undefined ? {} : { completedSideEffect }),
});
const thrown = (tool: string, message: string, code?: string) =>
  `Error running ${tool}: ${message}${code ? ` (errorCode: ${code})` : ""}`;

function setup(
  respond: (options: ExecuteAgentToolCallOptions) => Tool | Promise<Tool>,
  executorOptions: {
    builder?: Partial<BuilderOperationDeps>;
    settings?: Parameters<typeof createOperationExecutor>[0]["settings"];
    actions?: () => Promise<Record<string, ActionEntry>>;
    signal?: AbortSignal;
    observer?: RunObserver;
  } = {},
) {
  const callTool = vi.fn(async (options: ExecuteAgentToolCallOptions) =>
    respond(options),
  );
  const executor = createOperationExecutor({
    owner: "owner@example.test",
    orgId: "org-1",
    factoryId: "support-triage",
    automation: {
      triggerId: "job-1",
      triggerName: "factories/support-triage/flow",
      policyId: "policy-1",
    },
    runId: "run-1",
    signal: executorOptions.signal ?? new AbortController().signal,
    ...(executorOptions.settings ? { settings: executorOptions.settings } : {}),
    ...(executorOptions.observer ? { observer: executorOptions.observer } : {}),
    deps: {
      actions: executorOptions.actions ?? (async () => registry),
      callTool: callTool as never,
      builder: executorOptions.builder,
    },
  });
  return { callTool, executor };
}

function request(
  operationId: string,
  fields: Record<string, unknown>,
  extra: Partial<OperationRequest> = {},
): OperationRequest {
  const operation = op(operationId);
  return {
    operation,
    fields,
    credentialSlot: operation.credential.provider,
    mode: "live",
    signal: new AbortController().signal,
    ...(operation.effect === "write" ? { receiptKey: "wf:item:node:1" } : {}),
    ...extra,
  };
}

type Failure = Extract<OperationResult, { ok: false }>;
const asFailure = (result: OperationResult): Failure => {
  expect(result.ok).toBe(false);
  return result as Failure;
};

const post = {
  to: "C0123ABCD",
  text: "Hello",
};
const posted = {
  ok: true,
  channel: "C0123ABCD",
  ts: "1700000000.000200",
  permalink: "https://example.slack.com/archives/C0123ABCD/p1",
};

describe("an action operation", () => {
  it("calls the named action through the guarded path with the run's lineage", async () => {
    const { callTool, executor } = setup(() => completed(posted));
    const signal = new AbortController().signal;
    await executor.execute(
      request("slack.postMessage", post, {
        signal,
        receiptKey: "wf:i1:post:1",
      }),
    );

    expect(callTool).toHaveBeenCalledTimes(1);
    const options = callTool.mock.calls[0][0];
    expect(options).toMatchObject({
      name: "post-slack-message",
      input: { factoryId: "support-triage", to: "C0123ABCD", text: "Hello" },
      caller: "automation",
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      appId: "factory",
      automation: {
        triggerId: "job-1",
        triggerName: "factories/support-triage/flow",
        policyId: "policy-1",
      },
      runId: "run-1",
      // The audit row of a write is found again by its receipt key.
      turnId: "wf:i1:post:1",
      callId: "wf:i1:post:1",
    });
    expect(options.actions).toBe(registry);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("renames fields through argMap and passes the rest by their own names", async () => {
    const { callTool, executor } = setup(() => completed(posted));
    await executor.execute(
      request("slack.replyInThread", {
        channel: "C0123ABCD",
        threadTs: "1700000000.000100",
        text: "On it",
      }),
    );
    expect(callTool.mock.calls[0][0].input).toEqual({
      factoryId: "support-triage",
      to: "C0123ABCD",
      threadTs: "1700000000.000100",
      text: "On it",
    });

    const read = setup(() => completed({ ok: true, messages: [] }));
    await read.executor.execute(
      request("slack.readThread", { channel: "C1", threadTs: "1.1" }),
    );
    expect(read.callTool.mock.calls[0][0].input).toEqual({
      factoryId: "support-triage",
      channel: "C1",
      threadTs: "1.1",
    });
  });

  it("leaves unset fields out of the action's input", async () => {
    const { callTool, executor } = setup(() =>
      completed({ ok: true, id: "t1" }),
    );
    await executor.execute(
      request("hubspot.createTask", {
        title: "Call back",
        ownerId: undefined,
        contactId: null,
        due: "today",
      }),
    );
    expect(callTool.mock.calls[0][0].input).toEqual({
      factoryId: "support-triage",
      title: "Call back",
      due: "today",
    });
  });

  it("returns the output and the receipt's reference and link", async () => {
    const { executor } = setup(() => completed(posted));
    expect(await executor.execute(request("slack.postMessage", post))).toEqual({
      ok: true,
      output: posted,
      externalRef: "1700000000.000200",
      url: "https://example.slack.com/archives/C0123ABCD/p1",
    });
  });

  it("gives a read no receipt and no turn id", async () => {
    const { callTool, executor } = setup(() =>
      completed({ ok: true, items: [] }),
    );
    const result = await executor.execute(
      request("factory.listItems", { status: "received", limit: 50 }),
    );
    expect(result).toEqual({ ok: true, output: { ok: true, items: [] } });
    expect(callTool.mock.calls[0][0].turnId).toBeUndefined();
    expect(callTool.mock.calls[0][0].callId).toMatch(/^factory\.listItems:/);
  });

  describe("an output it cannot trust", () => {
    it("treats a write whose output was cut as possibly done", async () => {
      const { executor } = setup(() =>
        completed(`{"ok":true,"ts":"1."${MARKER}`),
      );
      const result = asFailure(
        await executor.execute(request("slack.postMessage", post)),
      );
      expect(result).toMatchObject({
        code: "effect_needs_check",
        sideEffect: "maybe",
        retryable: false,
      });
      expect(result.message).toContain("output_truncated");
    });

    it("fails a read whose output was cut, as over the cap", async () => {
      const { executor } = setup(() =>
        completed(`{"ok":true,"items":[1,2${MARKER}`),
      );
      const result = asFailure(
        await executor.execute(
          request("factory.listItems", { status: "received" }),
        ),
      );
      expect(result).toMatchObject({
        code: "output_over_cap",
        sideEffect: "none",
        retryable: false,
      });
      expect(result.message).toContain("output_truncated");
    });

    it("treats a write whose output is not JSON as possibly done", async () => {
      const { executor } = setup(() => completed("Done! Posted it."));
      const result = asFailure(
        await executor.execute(request("slack.postMessage", post)),
      );
      expect(result).toMatchObject({
        code: "effect_needs_check",
        sideEffect: "maybe",
      });
      expect(result.message).toContain("invalid_output");
    });

    it("fails a read whose output is not JSON", async () => {
      const { executor } = setup(() => completed("<html>oops</html>"));
      const result = asFailure(
        await executor.execute(
          request("factory.listItems", { status: "received" }),
        ),
      );
      expect(result).toMatchObject({
        code: "lookup_failed",
        sideEffect: "none",
      });
      expect(result.message).toContain("invalid_output");
    });

    it("marks a write that ran but shows no receipt as done, to be checked", async () => {
      const { executor } = setup(() => completed({ ok: true, channel: "C1" }));
      const result = asFailure(
        await executor.execute(request("slack.postMessage", post)),
      );
      expect(result).toMatchObject({
        code: "effect_needs_check",
        sideEffect: "done",
        retryable: false,
      });
      expect(result.message).toContain("unexpected_response");
    });
  });

  describe("a failed call", () => {
    const write = (tool: Tool) =>
      setup(() => tool).executor.execute(request("slack.postMessage", post));
    const read = (tool: Tool) =>
      setup(() => tool).executor.execute(
        request("factory.listItems", { status: "received" }),
      );

    it("is no side effect, and retryable, when the action says it was rate limited", async () => {
      const result = asFailure(
        await write(
          failed(
            thrown(
              "post-slack-message",
              "Slack is rate limiting.",
              "slack_rate_limited",
            ),
            false,
          ),
        ),
      );
      expect(result).toMatchObject({
        code: "provider_error",
        sideEffect: "none",
        retryable: true,
      });
      expect(result.message).toContain("Slack is rate limiting.");
      expect(result.message).not.toContain("Error running");
    });

    it.each(["hubspot_request_failed"])("retries %s", async (code) => {
      const result = asFailure(
        await write(failed(thrown("x", "down", code), false)),
      );
      expect(result).toMatchObject({ sideEffect: "none", retryable: true });
    });

    it("does not retry a refusal", async () => {
      const result = asFailure(
        await write(failed(thrown("x", "No.", "merge_gate_ineligible"), false)),
      );
      expect(result).toMatchObject({
        code: "provider_error",
        sideEffect: "none",
        retryable: false,
      });
    });

    it("reads a missing connection as credential_missing", async () => {
      for (const code of [
        "slack_not_connected",
        "slack_access_denied",
        "email_not_configured",
        "slack_identity_mismatch",
      ]) {
        const result = asFailure(
          await write(failed(thrown("x", "Connect it.", code), false)),
        );
        expect(result.code, code).toBe("credential_missing");
        expect(result.retryable, code).toBe(false);
        // The step's message is all an agent reading the run sees.
        expect(result.message, code).toContain(
          'call request-workflow-connection with provider "slack"',
        );
      }
    });

    it("is possibly done for any code ending _outcome_unknown, whatever else core says", async () => {
      for (const completedSideEffect of [false, undefined]) {
        const result = asFailure(
          await write(
            failed(
              thrown("x", "May have posted.", "slack_post_outcome_unknown"),
              completedSideEffect,
            ),
          ),
        );
        expect(result).toMatchObject({
          sideEffect: "maybe",
          retryable: false,
        });
      }
    });

    it("is done when core says the effect completed before it failed", async () => {
      const result = asFailure(
        await write(
          failed(thrown("x", "Late error.", "slack_post_rejected"), true),
        ),
      );
      expect(result).toMatchObject({ sideEffect: "done", retryable: false });
    });

    it("is possibly done for an untyped write failure, and none for a typed one", async () => {
      expect(
        asFailure(await write(failed("The x tool did not return a result."))),
      ).toMatchObject({ sideEffect: "maybe", retryable: false });
      expect(
        asFailure(
          await write(failed(thrown("x", "No.", "slack_post_rejected"))),
        ),
      ).toMatchObject({ sideEffect: "none" });
    });

    it("is never a side effect for a read", async () => {
      expect(
        asFailure(await read(failed("The x tool did not return a result."))),
      ).toMatchObject({
        code: "lookup_failed",
        sideEffect: "none",
        retryable: false,
      });
    });

    it("keeps an engine error code the action already used", async () => {
      const result = asFailure(
        await read(failed(thrown("x", "Too big.", "output_over_cap"), false)),
      );
      expect(result.code).toBe("output_over_cap");
    });

    it("cuts a long message", async () => {
      const result = asFailure(
        await write(
          failed(thrown("x", "m".repeat(5000), "slack_post_rejected"), false),
        ),
      );
      expect(result.message.length).toBeLessThan(600);
    });
  });

  it("fails, never retries, when the call needs a person's approval", async () => {
    const { executor } = setup(() => ({
      status: "approval_required",
      output: "Awaiting human approval to run post-slack-message.",
      approvalKey: "k1",
    }));
    const result = asFailure(
      await executor.execute(request("slack.postMessage", post)),
    );
    expect(result).toMatchObject({
      code: "operation_not_allowed",
      sideEffect: "none",
      retryable: false,
    });
    expect(result.message).toContain("approval_required");
  });

  it("fails as unavailable when the action is not in the registry", async () => {
    const { callTool, executor } = setup(() => completed({}), {
      actions: async () => ({}),
    });
    const result = asFailure(
      await executor.execute(request("slack.postMessage", post)),
    );
    expect(result).toMatchObject({
      code: "operation_not_allowed",
      sideEffect: "none",
      retryable: false,
    });
    expect(result.message).toContain("operation_unavailable");
    expect(result.message).toContain("post-slack-message");
    expect(callTool).not.toHaveBeenCalled();
  });

  it("fails as unavailable when core hides the action", async () => {
    const { executor } = setup(() =>
      failed("Unknown or unavailable tool: post-slack-message"),
    );
    const result = asFailure(
      await executor.execute(request("slack.postMessage", post)),
    );
    expect(result).toMatchObject({
      code: "operation_not_allowed",
      sideEffect: "none",
      retryable: false,
    });
    expect(result.message).toContain("operation_unavailable");
  });

  it("does not hide a dead registry behind a typed failure", async () => {
    const { executor } = setup(() => completed({}), {
      actions: async () => {
        throw new Error("registry missing");
      },
    });
    await expect(
      executor.execute(request("slack.postMessage", post)),
    ).rejects.toThrow("registry missing");
  });
});

describe("a provider-request operation", () => {
  const envelope = (extra: Record<string, unknown> = {}) => ({
    ok: true,
    operationId: "x",
    status: 200,
    output: { found: true },
    truncated: false,
    ...extra,
  });

  it("calls the wrapper action through the same guarded path", async () => {
    const { callTool, executor } = setup(() => completed(envelope()));
    await executor.execute(
      request("slack.findUserByEmail", { email: "pat@example.com" }),
    );
    expect(callTool.mock.calls[0][0]).toMatchObject({
      name: "run-workflow-operation",
      input: {
        factoryId: "support-triage",
        operationId: "slack.findUserByEmail",
        fields: { email: "pat@example.com" },
      },
      caller: "automation",
      runId: "run-1",
      automation: { triggerId: "job-1" },
    });
  });

  it("returns a lookup's output", async () => {
    const { executor } = setup(() =>
      completed(envelope({ output: { id: "U1" } })),
    );
    expect(
      await executor.execute(
        request("slack.findUserByEmail", { email: "pat@example.com" }),
      ),
    ).toEqual({ ok: true, output: { id: "U1" } });
  });

  it("returns a write's receipt", async () => {
    const { executor } = setup(() =>
      completed(
        envelope({
          output: { id: "page-1" },
          externalRef: "page-1",
          url: "https://www.notion.so/page-1",
        }),
      ),
    );
    expect(
      await executor.execute(
        request("notion.createPage", { parentPageId: "p", title: "T" }),
      ),
    ).toEqual({
      ok: true,
      output: { id: "page-1" },
      externalRef: "page-1",
      url: "https://www.notion.so/page-1",
    });
  });

  it("marks a write whose result carries no reference as done, to be checked", async () => {
    const { executor } = setup(() => completed(envelope({ output: {} })));
    const result = asFailure(
      await executor.execute(
        request("notion.createPage", { parentPageId: "p", title: "T" }),
      ),
    );
    expect(result).toMatchObject({
      code: "effect_needs_check",
      sideEffect: "done",
    });
  });

  describe("a source", () => {
    const items = [
      {
        id: "hubspot.newLeads:9",
        externalId: "9",
        kind: "lead",
        provider: "hubspot",
        title: "a@b.co",
        occurredAt: "2026-10-17T10:00:00Z",
        extras: {},
      },
    ];

    it("returns the items, the total and the cursor", async () => {
      const { executor } = setup(() =>
        completed(
          envelope({
            output: { itemCount: 1 },
            items,
            totalAvailable: 5,
            cursor: "9",
          }),
        ),
      );
      expect(
        await executor.execute(
          request("hubspot.newLeads", {}, { limit: 50, mode: "dry" }),
        ),
      ).toEqual({
        ok: true,
        output: { itemCount: 1 },
        items,
        totalAvailable: 5,
        cursor: "9",
      });
    });

    it("hands the cursor and window to the action as their own inputs", async () => {
      const { callTool, executor } = setup(() =>
        completed(envelope({ items: [] })),
      );
      await executor.execute(
        request("hubspot.newLeads", { since: "777" }, { limit: 25 }),
      );
      expect(callTool.mock.calls[0][0].input).toEqual({
        factoryId: "support-triage",
        operationId: "hubspot.newLeads",
        fields: {},
        cursor: "777",
        limit: 25,
      });

      await executor.execute(
        request("gong.newCalls", { since: SINCE, until: UNTIL }),
      );
      expect(callTool.mock.calls[1][0].input).toMatchObject({
        operationId: "gong.newCalls",
        fields: {},
        window: { from: SINCE, to: UNTIL },
      });
    });

    it("primes a cursor source's first live run, and only that one", async () => {
      const { callTool, executor } = setup(() =>
        completed(envelope({ items: [] })),
      );
      await executor.execute(request("hubspot.newLeads", {}, { mode: "live" }));
      expect(callTool.mock.calls[0][0].input).toMatchObject({ prime: true });

      await executor.execute(request("hubspot.newLeads", {}, { mode: "dry" }));
      await executor.execute(request("hubspot.newLeads", {}, { mode: "test" }));
      await executor.execute(
        request("hubspot.newLeads", { since: "5" }, { mode: "live" }),
      );
      await executor.execute(
        request(
          "gong.newCalls",
          { since: SINCE, until: UNTIL },
          { mode: "live" },
        ),
      );
      for (const call of callTool.mock.calls.slice(1)) {
        expect(call[0].input).not.toHaveProperty("prime");
      }
    });

    it("fails a source that returned no list of items", async () => {
      const { executor } = setup(() => completed(envelope({ output: {} })));
      const result = asFailure(
        await executor.execute(request("hubspot.newLeads", {})),
      );
      expect(result).toMatchObject({
        code: "lookup_failed",
        sideEffect: "none",
      });
      expect(result.message).toContain("invalid_output");
    });
  });

  it("fails a result that is not the action's envelope", async () => {
    const { executor } = setup(() => completed({ something: "else" }));
    const result = asFailure(
      await executor.execute(
        request("slack.findUserByEmail", { email: "pat@example.com" }),
      ),
    );
    expect(result).toMatchObject({ code: "lookup_failed", sideEffect: "none" });
  });

  describe("a failure keeps what the catalog says about reading and writing", () => {
    const readCall = (tool: Tool) =>
      setup(() => tool).executor.execute(
        request("slack.findUserByEmail", { email: "pat@example.com" }),
      );
    const writeCall = (tool: Tool) =>
      setup(() => tool).executor.execute(
        request("pylon.addNote", { ticketId: "t1", bodyHtml: "<p>x</p>" }),
      );

    it("retries a read, even a POST one, when the provider was unavailable", async () => {
      for (const [id, fields] of [
        ["slack.findUserByEmail", { email: "a@b.co" }],
        ["hubspot.newLeads", {}],
        ["gong.transcript", { callId: "c1" }],
      ] as const) {
        const { executor } = setup(() =>
          failed(
            thrown("run-workflow-operation", "down.", "provider_unavailable"),
            false,
          ),
        );
        const result = asFailure(await executor.execute(request(id, fields)));
        expect(result, id).toMatchObject({
          sideEffect: "none",
          retryable: true,
          code: "lookup_failed",
        });
      }
    });

    it("retries a read that timed out and one that was rate limited", async () => {
      for (const code of ["provider_request_failed", "provider_rate_limited"]) {
        const result = asFailure(
          await readCall(
            failed(thrown("run-workflow-operation", "x", code), false),
          ),
        );
        expect(result, code).toMatchObject({
          sideEffect: "none",
          retryable: true,
        });
      }
    });

    it("never retries a write that may have gone through", async () => {
      const result = asFailure(
        await writeCall(
          failed(
            thrown(
              "run-workflow-operation",
              "did not complete.",
              "provider_request_outcome_unknown",
            ),
            undefined,
          ),
        ),
      );
      expect(result).toMatchObject({
        code: "provider_error",
        sideEffect: "maybe",
        retryable: false,
      });
    });

    it("never retries a write that ran but could not be read back", async () => {
      const result = asFailure(
        await writeCall(
          failed(
            thrown(
              "run-workflow-operation",
              "no receipt.",
              "unexpected_response_outcome_unknown",
            ),
            undefined,
          ),
        ),
      );
      expect(result).toMatchObject({ sideEffect: "maybe", retryable: false });
    });

    it("reads a missing connection as credential_missing", async () => {
      const result = asFailure(
        await readCall(
          failed(
            thrown(
              "run-workflow-operation",
              "Connect slack.",
              "credential_missing",
            ),
            false,
          ),
        ),
      );
      expect(result).toMatchObject({
        code: "credential_missing",
        sideEffect: "none",
        retryable: false,
      });
      expect(result.message).toContain("Connect slack.");
    });

    it("names an unexpected response and keeps it a failure", async () => {
      const result = asFailure(
        await readCall(
          failed(
            thrown(
              "run-workflow-operation",
              "slack.findUserByEmail: returned a response that has no list.",
              "unexpected_response",
            ),
            false,
          ),
        ),
      );
      expect(result.code).toBe("lookup_failed");
      expect(result.message).toContain("unexpected_response");
      expect(result.sideEffect).toBe("none");
    });

    it("reads a gate refusal as a refusal, not a retry", async () => {
      const result = asFailure(
        await readCall(
          failed(
            thrown(
              "run-workflow-operation",
              "its saved graph does not name it.",
              "workflow_action_not_allowed",
            ),
            false,
          ),
        ),
      );
      expect(result).toMatchObject({
        code: "operation_not_allowed",
        sideEffect: "none",
        retryable: false,
      });
    });

    it("reads an unreadable saved graph as an engine fault, not a refusal", async () => {
      const result = asFailure(
        await readCall(
          failed(
            thrown(
              "run-workflow-operation",
              "the saved graph cannot be read.",
              "workflow_graph_unreadable",
            ),
            false,
          ),
        ),
      );
      expect(result).toMatchObject({
        code: "engine_error",
        sideEffect: "none",
      });
    });
  });
});

/** Passes the Builder dispatch gate: a clear, low-risk, high-confidence bug nobody claimed. */
const startFields = {
  projectId: "proj-1",
  branchName: "factory-g1",
  prompt: "Fix it",
  clearBug: true,
  productUxImplications: false,
  risk: "low",
  confidence: "high",
  alreadyClaimed: false,
  categories: [],
};

describe("a builder operation", () => {
  it("does not use the tool path, and reports Builder's state", async () => {
    const getStatus = vi.fn(async () => ({
      agentState: "running",
      lastActivityAt: null,
      state: "active",
      archived: false,
      prStatus: null,
      prUrl: null,
    }));
    const { callTool, executor } = setup(() => completed({}), {
      builder: { getStatus: getStatus as never },
    });
    const result = await executor.execute(
      request("builder.check", {
        projectId: "proj-1",
        branchName: "factory-g1",
      }),
    );
    expect(result).toMatchObject({ ok: true, output: { state: "working" } });
    expect(callTool).not.toHaveBeenCalled();
    expect(getStatus).toHaveBeenCalledWith({
      projectId: "proj-1",
      branchName: "factory-g1",
    });
  });

  it("starts the task as the job's owner", async () => {
    const startAgent = vi.fn(async (args: { branchName?: string }) => ({
      branchName: args.branchName ?? "",
      projectId: "proj-1",
      url: "https://builder.io/app/x",
      status: "processing",
    }));
    const getStatus = vi.fn(async () => {
      const { BuilderBranchError } = await import("@agent-native/core/server");
      throw new BuilderBranchError("branch_not_found", "status", "none");
    });
    const { executor } = setup(() => completed({}), {
      builder: {
        startAgent: startAgent as never,
        getStatus: getStatus as never,
      },
    });
    const result = await executor.execute(
      request("builder.start", { ...startFields, projectId: "proj-1" }),
    );
    expect(result).toMatchObject({ ok: true, externalRef: "factory-g1" });
    expect(startAgent).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: "owner@example.test" }),
    );
  });

  it("refuses a start the dispatch gate refuses, before Builder is asked anything", async () => {
    const startAgent = vi.fn();
    const getStatus = vi.fn();
    const { executor } = setup(() => completed({}), {
      builder: {
        startAgent: startAgent as never,
        getStatus: getStatus as never,
      },
    });

    const result = asFailure(
      await executor.execute(
        request("builder.start", { ...startFields, risk: "high" }),
      ),
    );

    expect(result).toMatchObject({
      code: "operation_not_allowed",
      sideEffect: "none",
      retryable: false,
    });
    expect(result.message).toContain("risk_not_low");
    expect(startAgent).not.toHaveBeenCalled();
    expect(getStatus).not.toHaveBeenCalled();
  });

  describe("with the workflow's settings", () => {
    const missingBranch = async () => {
      const { BuilderBranchError } = await import("@agent-native/core/server");
      throw new BuilderBranchError("branch_not_found", "status", "none");
    };
    const started = (args: { branchName?: string; projectId?: string }) => ({
      branchName: args.branchName ?? "",
      projectId: args.projectId ?? "",
      url: "https://builder.io/app/x",
      status: "processing",
    });

    it("starts a task whose project is left blank in the project the workflow names", async () => {
      const startAgent = vi.fn(async (args: object) => started(args));
      const { executor } = setup(() => completed({}), {
        settings: { builderProjectId: "settings-project" },
        builder: {
          startAgent: startAgent as never,
          getStatus: missingBranch as never,
        },
      });

      await executor.execute(
        request("builder.start", { ...startFields, projectId: "" }),
      );

      expect(startAgent).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "settings-project" }),
      );
    });

    it("keeps a project the graph names over the setting", async () => {
      const startAgent = vi.fn(async (args: object) => started(args));
      const { executor } = setup(() => completed({}), {
        settings: { builderProjectId: "settings-project" },
        builder: {
          startAgent: startAgent as never,
          getStatus: missingBranch as never,
        },
      });

      await executor.execute(request("builder.start", startFields));

      expect(startAgent).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "proj-1" }),
      );
    });

    it("reads a task as stuck after the minutes the workflow sets, and after 30 when it sets none", async () => {
      const idleSince = (minutes: number) => ({
        agentState: "idle",
        lastActivityAt: Date.now() - minutes * 60_000,
        state: "active",
        archived: false,
        prStatus: null,
        prUrl: null,
      });
      const check = async (
        settings: { builderStuckAfterMinutes?: number } | undefined,
        idleMinutes: number,
      ) => {
        const { executor } = setup(() => completed({}), {
          ...(settings ? { settings } : {}),
          builder: {
            getStatus: (async () => idleSince(idleMinutes)) as never,
          },
        });
        const result = await executor.execute(
          request("builder.check", {
            projectId: "proj-1",
            branchName: "factory-g1",
          }),
        );
        return (result as { output: { state: string } }).output.state;
      };

      expect(await check({ builderStuckAfterMinutes: 10 }, 12)).toBe("stuck");
      expect(await check({ builderStuckAfterMinutes: 60 }, 40)).toBe("working");
      expect(await check(undefined, 40)).toBe("stuck");
      expect(await check(undefined, 20)).toBe("working");
    });

    it("fails a check whose pull request is not in the repository the workflow names, and passes one that is", async () => {
      const openedIn = (path: string) =>
        (async () => ({
          agentState: "idle",
          lastActivityAt: Date.now() - 5 * 60_000,
          state: "active",
          archived: false,
          prStatus: "open",
          prUrl: `https://github.com/${path}/pull/7`,
        })) as never;
      const check = async (pullRequestIn: string) => {
        const { executor } = setup(() => completed({}), {
          settings: { extras: { repository: "Acme/App" } },
          builder: { getStatus: openedIn(pullRequestIn) },
        });
        return executor.execute(
          request("builder.check", {
            projectId: "proj-1",
            branchName: "factory-g1",
          }),
        );
      };

      const other = asFailure(await check("someone-else/app"));
      expect(other.code).toBe("operation_not_allowed");
      expect(other.message).toContain("builder_pr_repository_mismatch");
      expect(await check("acme/app")).toMatchObject({
        ok: true,
        output: { prNumber: 7, prRepository: "acme/app" },
      });
    });

    it("lets a test's own deps win over the settings", async () => {
      const startAgent = vi.fn(async (args: object) => started(args));
      const { executor } = setup(() => completed({}), {
        settings: { builderProjectId: "settings-project" },
        builder: {
          projectId: "deps-project",
          startAgent: startAgent as never,
          getStatus: missingBranch as never,
        },
      });

      await executor.execute(
        request("builder.start", { ...startFields, projectId: "" }),
      );

      expect(startAgent).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "deps-project" }),
      );
    });
  });
});

describe("every operation", () => {
  it("stops before calling anything once the run's signal has aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { callTool, executor } = setup(() => completed({}), {
      signal: controller.signal,
    });
    const result = asFailure(
      await executor.execute(request("slack.postMessage", post)),
    );
    expect(result).toMatchObject({ code: "budget_paused", sideEffect: "none" });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("stops when the request's own signal has aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { callTool, executor } = setup(() => completed({}));
    const result = asFailure(
      await executor.execute(
        request("slack.postMessage", post, { signal: controller.signal }),
      ),
    );
    expect(result.code).toBe("budget_paused");
    expect(callTool).not.toHaveBeenCalled();
  });

  it("refuses a field the operation does not declare", async () => {
    const { callTool, executor } = setup(() => completed({}));
    const result = asFailure(
      await executor.execute(
        request("slack.postMessage", { ...post, channel: "C9" }),
      ),
    );
    expect(result).toMatchObject({ code: "graph_invalid", sideEffect: "none" });
    expect(result.message).toContain("unknown_field");
    expect(callTool).not.toHaveBeenCalled();
  });

  it("calls for each implementation type through the right path", async () => {
    const seen: string[] = [];
    const { executor } = setup(
      (options) => {
        seen.push(options.name);
        return completed(
          options.name === "run-workflow-operation"
            ? { ok: true, output: {}, truncated: false }
            : { ok: true },
        );
      },
      {
        builder: {
          getStatus: (async () => ({
            agentState: "running",
            lastActivityAt: null,
            state: "active",
            archived: false,
            prStatus: null,
            prUrl: null,
          })) as never,
        },
      },
    );
    await executor.execute(
      request("factory.listItems", { status: "received" }),
    );
    await executor.execute(
      request("slack.findUserByEmail", { email: "a@b.co" }),
    );
    await executor.execute(
      request("builder.check", { projectId: "p", branchName: "b" }),
    );
    expect(seen).toEqual(["list-factory-items", "run-workflow-operation"]);
  });
});

describe("operation executor: tripwires", () => {
  const SECRET = "xoxb-FAKE-0000-aaaaaaaaaaaa";
  const pylonFields = { ticketId: "t1", bodyHtml: "<p>hi</p>" };

  afterEach(() => {
    vi.useRealTimers();
  });

  function stored(event: TripwireInput) {
    return { ...event, details: sanitizeDetails(event.details).fields };
  }

  it("records a call that runs past 8 seconds as provider_slow, at info, once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { sink } = createCapturingTripwireSink();
    const { executor } = setup(
      () => {
        vi.setSystemTime(Date.now() + 9_000);
        return completed(posted);
      },
      { observer: createRunObserver(sink) },
    );

    const observed = await executor.execute(request("slack.postMessage", post));
    const { executor: plain } = setup(() => completed(posted));
    const unobserved = await plain.execute(request("slack.postMessage", post));

    expect(unobserved).toEqual(observed);
  });

  it("records a write the action could not vouch for as provider_write_ambiguous, at error", async () => {
    const tool = failed(
      `The post-slack-message tool did not return a result. Token ${SECRET}`,
    );
    const { sink, events } = createCapturingTripwireSink();
    const { executor } = setup(() => tool, {
      observer: createRunObserver(sink),
    });

    const observed = await executor.execute(request("slack.postMessage", post));
    const unobserved = await setup(() => tool).executor.execute(
      request("slack.postMessage", post),
    );

    expect(unobserved).toEqual(observed);
    expect(asFailure(observed)).toMatchObject({ sideEffect: "maybe" });
    expect(JSON.stringify(stored(events[0]))).not.toContain(SECRET);
  });

  it("leaves a provider-request write's ambiguity to the action that ran it", async () => {
    const { sink } = createCapturingTripwireSink();
    const { executor } = setup(
      () => failed("The run-workflow-operation tool did not return a result."),
      { observer: createRunObserver(sink) },
    );

    const result = await executor.execute(
      request("pylon.addNote", pylonFields),
    );

    expect(asFailure(result)).toMatchObject({ sideEffect: "maybe" });
  });

  it("records a credential the action found missing as credential_source_used with source none, once per provider in a run", async () => {
    const tool = failed(
      thrown("post-slack-message", "Connect Slack.", "slack_not_connected"),
      false,
    );
    const { sink } = createCapturingTripwireSink();
    const { executor } = setup(() => tool, {
      observer: createRunObserver(sink),
    });

    const first = await executor.execute(request("slack.postMessage", post));
    const second = await executor.execute(request("slack.postMessage", post));

    expect(asFailure(first).code).toBe("credential_missing");
    expect(asFailure(second).code).toBe("credential_missing");
  });

  it("notes a Builder check with no project as source none, since Builder types that as a missing credential", async () => {
    const { sink } = createCapturingTripwireSink();
    const { executor } = setup(() => completed({}), {
      observer: createRunObserver(sink),
    });

    const result = await executor.execute(
      request("builder.check", { branchName: "factory-g1" }),
    );

    expect(asFailure(result).code).toBe("credential_missing");
  });

  it("records nothing for a call that succeeds in 8 seconds or less", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { sink } = createCapturingTripwireSink();

    for (const elapsedMs of [0, 8_000]) {
      const { executor } = setup(
        () => {
          vi.setSystemTime(Date.now() + elapsedMs);
          return completed(posted);
        },
        { observer: createRunObserver(sink) },
      );
      expect(
        await executor.execute(request("slack.postMessage", post)),
      ).toMatchObject({ ok: true });
    }
  });
});
