import { beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteAgentCredentialRejectedError } from "../a2a/remote-agent-auth.js";
import type { ActionRunContext } from "../action.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import type { TrackingEvent } from "../tracking/types.js";

const callAgentMock = vi.hoisted(() => vi.fn());
const managedHandlerMock = vi.hoisted(() => vi.fn());
const invokeActionMock = vi.hoisted(() => vi.fn());
const findAgentMock = vi.hoisted(() =>
  vi.fn(async () => ({
    name: "Slides",
    url: "https://slides.agent-native.test",
  })),
);
const resolveRemoteAgentTokenMock = vi.hoisted(() => vi.fn());
const insertA2AContinuationMock = vi.hoisted(() => vi.fn());
const getA2AContinuationsMock = vi.hoisted(() => vi.fn());
const dispatchA2AContinuationMock = vi.hoisted(() => vi.fn());
const bumpRunProgressMock = vi.hoisted(() => vi.fn(async () => {}));
const integrationRequestContextMock = vi.hoisted(() => vi.fn());

const slackIntegrationContext = {
  taskId: "integration-task-1",
  attempts: 1,
  incoming: {
    platform: "slack",
    externalThreadId: "C123:123.456",
    text: "make a deck",
    sourceUrl: "https://example-workspace.slack.com/archives/C123/p123456",
    platformContext: {},
    timestamp: 123,
  },
  placeholderRef: "placeholder-1",
  progressRef: { kind: "slack-stream", streamTs: "1719000000.000001" },
};

vi.mock("../server/agent-discovery.js", () => ({
  findAgent: findAgentMock,
  discoverAgents: vi.fn(async () => []),
}));

vi.mock("../a2a/remote-agent-auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../a2a/remote-agent-auth.js")>()),
  resolveRemoteAgentToken: resolveRemoteAgentTokenMock,
}));

vi.mock("../a2a/anthropic-managed-agents.js", () => ({
  ANTHROPIC_MANAGED_AGENTS_METADATA_KEY:
    "agent-native/anthropic-managed-agents",
  createAnthropicManagedAgentsHandler: managedHandlerMock,
}));

vi.mock("../a2a/client.js", () => ({
  MAX_A2A_CALLER_RESPONSE_CHARS: 32_768,
  A2ATaskTimeoutError: class A2ATaskTimeoutError extends Error {
    taskId: string;
    constructor(taskId: string) {
      super(`A2A task ${taskId} did not complete within 18000ms`);
      this.name = "A2ATaskTimeoutError";
      this.taskId = taskId;
    }
  },
  callAction: invokeActionMock,
  callAgent: callAgentMock,
  shouldPreferGlobalA2ASecret: (orgSecret?: string) =>
    !!process.env.A2A_SECRET?.trim() || !orgSecret,
  signA2AToken: vi.fn(async () => "signed-token"),
}));

vi.mock("../org/context.js", () => ({
  getOrgDomain: vi.fn(async () => "builder.io"),
  getOrgA2ASecret: vi.fn(async () => "org-secret"),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestUserEmail: () => "alice+qa@agent-native.test",
  getRequestOrgId: () => "org-qa",
  getRequestRunContext: () => ({ model: "claude-opus-4-8" }),
  getRequestContext: () => ({ userEmail: "alice+qa@agent-native.test" }),
  isIntegrationCallerRequest: () => true,
  getIntegrationRequestContext: integrationRequestContextMock,
}));

vi.mock("../integrations/a2a-continuations-store.js", () => ({
  insertA2AContinuation: insertA2AContinuationMock,
  getA2AContinuationsForIntegrationTaskAgent: getA2AContinuationsMock,
}));

vi.mock("../integrations/a2a-continuation-processor.js", () => ({
  dispatchA2AContinuation: dispatchA2AContinuationMock,
}));

vi.mock("../agent/run-store.js", () => ({
  insertRun: vi.fn(() => Promise.resolve()),
  insertRunEvent: vi.fn(() => Promise.resolve()),
  updateRunStatus: vi.fn(() => Promise.resolve()),
  updateRunStatusIfRunning: vi.fn(() => Promise.resolve(true)),
  getRunStatus: vi.fn(() => Promise.resolve("running")),
  tryClaimRunSlot: vi.fn(() =>
    Promise.resolve({ claimed: true, activeRunId: null }),
  ),
  markRunAborted: vi.fn(() => Promise.resolve()),
  isRunAborted: vi.fn(() => Promise.resolve(false)),
  getRunAbortState: vi.fn(() => Promise.resolve({ aborted: false })),
  getRunEventsSince: vi.fn(() => Promise.resolve([])),
  getRunById: vi.fn(() => Promise.resolve(null)),
  getRunByThread: vi.fn(() => Promise.resolve(null)),
  cleanupOldRuns: vi.fn(() => Promise.resolve()),
  updateRunHeartbeat: vi.fn(() => Promise.resolve()),
  bumpRunProgress: bumpRunProgressMock,
  setRunInFlightMarker: vi.fn(() => Promise.resolve()),
  reapIfStale: vi.fn(() => Promise.resolve(null)),
  reapUnclaimedBackgroundRun: vi.fn(() => Promise.resolve(false)),
  UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS: 5 * 60_000,
  shouldRedispatchUnclaimedBackgroundRun: (
    row: { startedAt: number },
    now: number = Date.now(),
  ) => now - row.startedAt < 5 * 60_000,
  reconcileTerminalRunFromEvents: vi.fn(() => Promise.resolve(false)),
  ensureTerminalRunEvent: vi.fn(() => Promise.resolve()),
  getLastTerminalRunEvent: vi.fn(() => Promise.resolve(null)),
  resolveErroredRunTerminalEvent: vi.fn(() => ({
    event: {
      type: "error",
      error: "The agent stopped before it could finish.",
      errorCode: "stale_run",
      recoverable: true,
    },
    shouldPersist: true,
  })),
  setRunError: vi.fn(() => Promise.resolve()),
  setRunTerminalReason: vi.fn(() => Promise.resolve()),
  STALE_RUN_ERROR_EVENT: {
    type: "error",
    error: "The agent stopped before it could finish.",
    errorCode: "stale_run",
    recoverable: true,
  },
}));

describe("call-agent action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findAgentMock.mockResolvedValue({
      name: "Slides",
      url: "https://slides.agent-native.test",
    });
    resolveRemoteAgentTokenMock.mockResolvedValue(undefined);
    managedHandlerMock.mockReset();
    delete process.env.NETLIFY;
    delete process.env.NETLIFY_LOCAL;
    delete process.env.SITE_ID; // guard:allow-env-credential -- tests isolate Netlify's public runtime host marker.
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.VERCEL;
    delete process.env.AGENT_NATIVE_INTEGRATION_A2A_TIMEOUT_MS;
    integrationRequestContextMock.mockReturnValue(slackIntegrationContext);
    insertA2AContinuationMock.mockResolvedValue({ id: "cont-1" });
    getA2AContinuationsMock.mockResolvedValue([]);
    dispatchA2AContinuationMock.mockResolvedValue(undefined);
  });

  it("defaults cross-app work to the receiving specialist agent", async () => {
    const { tool } = await import("./call-agent.js");

    expect(tool.description).toContain("Use message by default");
    expect(tool.description).toContain(
      "The receiver owns provider, schema, query, join, and SQL decisions",
    );
    expect(tool.description).toContain(
      "never expose or call a direct action to work around",
    );
    expect(tool.description).toContain(
      "Never put a create, update, delete, send, save, publish, or any other side effect in action",
    );
  });

  it("routes a managed-agent manifest through its A2A handler adapter", async () => {
    const handler = vi.fn(async () => ({
      message: {
        role: "agent" as const,
        parts: [{ type: "text" as const, text: "managed answer" }],
      },
    }));
    managedHandlerMock.mockReturnValueOnce(handler);
    findAgentMock.mockResolvedValueOnce({
      id: "anthropic-research",
      name: "Anthropic Research",
      url: "https://api.anthropic.com",
      kind: {
        provider: "anthropic-managed-agents",
        agentId: "agt_fixture",
        environmentId: "env_fixture",
        credentialRef: "ANTHROPIC_API_KEY",
      },
    });
    const { run } = await import("./call-agent.js");
    const send = vi.fn();
    const actionContext: ActionRunContext = {
      caller: "tool",
      send,
      threadId: "thread-managed",
      turnId: "turn-managed",
    };

    const result = await run(
      { agent: "anthropic-research", message: "Summarize this repository." },
      actionContext,
      "dispatch",
    );

    expect(result).toBe("managed answer");
    expect(callAgentMock).not.toHaveBeenCalled();
    expect(managedHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agt_fixture",
        environmentId: "env_fixture",
        credentialRef: "ANTHROPIC_API_KEY",
        apiBaseUrl: "https://api.anthropic.com",
      }),
    );
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        parts: [{ type: "text", text: "Summarize this repository." }],
      }),
      expect.objectContaining({
        taskId: "turn-managed",
        contextId: "thread-managed",
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent_call",
        agent: "Anthropic Research",
        status: "done",
      }),
    );
  });

  it("passes a managed continuation token without exposing the session ID", async () => {
    const handler = vi.fn(async () => ({
      message: {
        role: "agent" as const,
        parts: [{ type: "text" as const, text: "Approval required" }],
        metadata: {
          "agent-native/anthropic-managed-agents": {
            continuationToken: "opaque-fixture-token",
            pendingToolUseIds: ["tool_fixture"],
          },
        },
      },
      taskState: "input-required" as const,
    }));
    managedHandlerMock.mockReturnValueOnce(handler);
    findAgentMock.mockResolvedValueOnce({
      id: "anthropic-research",
      name: "Anthropic Research",
      url: "https://api.anthropic.com",
      kind: {
        provider: "anthropic-managed-agents",
        agentId: "agt_fixture",
        environmentId: "env_fixture",
        credentialRef: "ANTHROPIC_API_KEY",
      },
    });

    const { run } = await import("./call-agent.js");
    const result = await run({
      agent: "anthropic-research",
      message: "Inspect the working tree.",
    });

    expect(result).toContain('taskId="opaque-fixture-token"');
    expect(result).not.toContain("ses_fixture");
    expect(result).not.toContain("in session");
  });

  it("forwards the user's exact downstream action authorization", async () => {
    callAgentMock.mockResolvedValueOnce("sent");
    const { run } = await import("./call-agent.js");
    const approvedActions = [
      { tool: "send-email", input: { to: "alice@example.test" } },
    ];

    await run({
      agent: "mail",
      message: "send it",
      approvedActions,
    });

    expect(callAgentMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      expect.stringContaining("send it"),
      expect.objectContaining({ approvedActions }),
    );
    expect(callAgentMock.mock.calls[0]?.[1]).toContain(
      "Return a concise caller-ready synthesis rather than raw tool output or full transcripts",
    );
    expect(callAgentMock.mock.calls[0]?.[1]).toContain("<a2a-caller-hint>");
    expect(callAgentMock.mock.calls[0]?.[1]).toContain("</a2a-caller-hint>");
    expect(callAgentMock.mock.calls[0]?.[2]).not.toHaveProperty("cardUrl");
  });

  it("labels an ordinary peer's rejected A2A credentials clearly", async () => {
    callAgentMock.mockRejectedValueOnce(
      new RemoteAgentCredentialRejectedError({ status: 401 }),
    );
    const { run } = await import("./call-agent.js");

    await expect(
      run({ agent: "slides", message: "make a deck" }),
    ).rejects.toMatchObject({
      errorCode: "a2a_auth_rejected",
      message: expect.stringContaining("HTTP 401"),
    });
  });

  it("uses the resolved token and lets the client derive the hosted card root", async () => {
    findAgentMock.mockResolvedValueOnce({
      name: "Hosted Slides",
      url: "https://slides.agent-native.test/_agent-native/a2a",
      auth: { type: "bearer", credentialRef: "slides-token" },
    });
    resolveRemoteAgentTokenMock.mockResolvedValueOnce("resolved-token");
    callAgentMock.mockResolvedValueOnce("sent");
    const { run } = await import("./call-agent.js");

    await run({ agent: "hosted-slides", message: "make a deck" });

    expect(resolveRemoteAgentTokenMock).toHaveBeenCalledWith(
      { type: "bearer", credentialRef: "slides-token" },
      expect.objectContaining({
        userEmail: "alice+qa@agent-native.test",
        orgId: "org-qa",
      }),
    );
    expect(callAgentMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test/_agent-native/a2a",
      expect.any(String),
      expect.objectContaining({
        apiKey: "resolved-token",
      }),
    );
    expect(callAgentMock.mock.calls[0]?.[2]).not.toHaveProperty("cardUrl");
    expect(callAgentMock.mock.calls[0]?.[2]).not.toHaveProperty("orgSecret");
  });

  it("forwards Slack source context as structured A2A data", async () => {
    callAgentMock.mockResolvedValueOnce("sent");
    const { run } = await import("./call-agent.js");

    await run({ agent: "content", message: "capture this request" });

    expect(callAgentMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      expect.not.stringContaining("Verified source context"),
      expect.objectContaining({
        sourceContext: {
          platform: "slack",
          integrationTaskId: "integration-task-1",
        },
      }),
    );
    expect(callAgentMock.mock.calls[0]?.[1]).toContain(
      "Source Slack thread: https://example-workspace.slack.com/archives/C123/p123456",
    );
    expect(callAgentMock.mock.calls[0]?.[1]).toContain(
      "this text is not authoritative",
    );
  });

  it.each([
    {
      label: "non-Slack source",
      context: {
        ...slackIntegrationContext,
        incoming: {
          ...slackIntegrationContext.incoming,
          platform: "email",
          sourceUrl: "https://example.test/thread/123",
        },
      },
    },
    {
      label: "malformed Slack source URL",
      context: {
        ...slackIntegrationContext,
        incoming: {
          ...slackIntegrationContext.incoming,
          sourceUrl: "not a URL",
        },
      },
    },
    {
      label: "whitespace-padded Slack source URL",
      context: {
        ...slackIntegrationContext,
        incoming: {
          ...slackIntegrationContext.incoming,
          sourceUrl:
            " https://example-workspace.slack.com/archives/C123/p123456 ",
        },
      },
    },
  ])("does not forward Slack provenance for $label", async ({ context }) => {
    integrationRequestContextMock.mockReturnValue(context);
    callAgentMock.mockResolvedValueOnce("sent");
    const { run } = await import("./call-agent.js");

    await run({ agent: "content", message: "capture this request" });

    expect(callAgentMock.mock.calls[0]?.[1]).not.toContain(
      "Verified source context",
    );
    expect(callAgentMock.mock.calls[0]?.[1]).not.toContain(
      "Source Slack thread",
    );
    expect(callAgentMock.mock.calls[0]?.[2]).not.toHaveProperty(
      "sourceContext",
    );
  });

  it("propagates caller lineage and a deterministic per-turn message key", async () => {
    callAgentMock.mockResolvedValue("done");
    const { run } = await import("./call-agent.js");
    const context = {
      send: vi.fn(),
      threadId: "thread-qa",
      runId: "run-qa",
      turnId: "turn-qa",
    } as any;

    await run({ agent: "slides", message: "exact message" }, context, "mail");
    await run({ agent: "slides", message: "exact message" }, context, "mail");
    await run(
      { agent: "slides", message: "exact message changed" },
      context,
      "mail",
    );

    const firstOptions = callAgentMock.mock.calls[0]?.[2];
    const duplicateOptions = callAgentMock.mock.calls[1]?.[2];
    const changedOptions = callAgentMock.mock.calls[2]?.[2];
    expect(firstOptions).toMatchObject({
      contextId: "thread-qa",
      correlation: {
        callerApp: "mail",
        selectedReceiverApp: "slides",
        callerThreadId: "thread-qa",
        parentRunId: "run-qa",
        parentTurnId: "turn-qa",
        delegationDepth: 1,
        visitedApps: ["mail"],
        callerModel: "claude-opus-4-8",
      },
      idempotencyKey: expect.stringMatching(/^v1:[a-f0-9]{64}$/),
    });
    expect(duplicateOptions.idempotencyKey).toBe(firstOptions.idempotencyKey);
    expect(changedOptions.idempotencyKey).not.toBe(firstOptions.idempotencyKey);
  });

  it("preserves and increments nested delegation lineage", async () => {
    callAgentMock.mockResolvedValueOnce("done");
    const { run } = await import("./call-agent.js");

    await run(
      { agent: "slides", message: "make a deck" },
      {
        threadId: "thread-qa",
        runId: "run-qa",
        turnId: "turn-qa",
        delegationDepth: 1,
        visitedApps: ["dispatch"],
      } as any,
      "mail",
    );

    expect(callAgentMock.mock.calls[0]?.[2]?.correlation).toMatchObject({
      callerApp: "mail",
      selectedReceiverApp: "slides",
      delegationDepth: 2,
      visitedApps: ["dispatch", "mail"],
    });
  });

  it("blocks repeated apps and excessive delegation depth before dispatch", async () => {
    const { run } = await import("./call-agent.js");

    await expect(
      run(
        { agent: "slides", message: "loop" },
        { delegationDepth: 1, visitedApps: ["slides"] } as any,
        "mail",
      ),
    ).resolves.toContain("delegation cycle blocked");
    await expect(
      run(
        { agent: "slides", message: "too deep" },
        { delegationDepth: 3, visitedApps: ["dispatch", "mail"] } as any,
        "analytics",
      ),
    ).resolves.toContain("3-hop limit");
    expect(callAgentMock).not.toHaveBeenCalled();
  });

  it("polls a returned task id without sending another downstream message", async () => {
    callAgentMock.mockResolvedValueOnce("finished once");
    const { run, tool } = await import("./call-agent.js");

    const result = await run({
      agent: "analytics",
      taskId: "remote-task-1",
    });

    expect(result).toBe("finished once");
    expect(tool.parameters.required).toEqual(["agent"]);
    expect(callAgentMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      "",
      expect.objectContaining({
        taskId: "remote-task-1",
        returnRecoverableArtifactsOnTimeout: false,
      }),
    );
  });

  it("directly invokes an exposed read-only action without calling the remote agent", async () => {
    invokeActionMock.mockResolvedValueOnce({
      action: "gong-calls",
      status: "completed",
      output: '{"total":13}',
    });
    const { run } = await import("./call-agent.js");
    const send = vi.fn();

    const result = await run(
      {
        agent: "analytics",
        action: "gong-calls",
        input: { company: "Edmunds", days: 90 },
      },
      {
        send,
        threadId: "thread-qa",
        runId: "run-qa",
        turnId: "turn-qa",
      } as any,
      "mail",
    );

    expect(result).toBe('{"total":13}');
    expect(invokeActionMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      "gong-calls",
      { company: "Edmunds", days: 90 },
      expect.objectContaining({
        userEmail: "alice+qa@agent-native.test",
        orgDomain: "builder.io",
        orgSecret: "org-secret",
        correlation: {
          callerApp: "mail",
          callerThreadId: "thread-qa",
          parentRunId: "run-qa",
          parentTurnId: "turn-qa",
          invocationId: expect.any(String),
          delegationDepth: 1,
          visitedApps: ["mail"],
          callerModel: "claude-opus-4-8",
        },
      }),
    );
    expect(callAgentMock).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent_call_text",
        agent: "Slides",
        text: '{"total":13}',
        agentCallId: expect.any(String),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent_call",
        agent: "Slides",
        status: "start",
        agentCallId: expect.any(String),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent_call",
        agent: "Slides",
        status: "done",
        agentCallId: expect.any(String),
        durationMs: expect.any(Number),
      }),
    );
  });

  it("tells the model to keep polling the same task after a bounded wait", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    insertA2AContinuationMock.mockRejectedValueOnce(
      new Error("continuations unavailable"),
    );
    const timeout = Object.assign(
      new Error(
        "A2A task remote-task-keep did not complete within 300000ms (last state: working)",
      ),
      {
        name: "A2ATaskTimeoutError",
        taskId: "remote-task-keep",
      },
    );
    callAgentMock.mockRejectedValueOnce(timeout);
    const { run } = await import("./call-agent.js");

    const result = await run(
      { agent: "analytics", message: "review all calls" },
      { send: vi.fn() } as any,
    );

    expect(result).toContain('taskId "remote-task-keep"');
    expect(result).toContain(
      'taskId="remote-task-keep" (omit message) to continue waiting',
    );
    expect(result).toContain("Do not send Slides a new check-in");
    expect((result.match(/remote-task-keep/g) ?? []).length).toBeGreaterThan(0);
    consoleError.mockRestore();
  });

  it.each([
    {
      state: "failed",
      expectedStatus: "error",
      responseText: "provider retries exhausted",
    },
    {
      state: "input-required",
      expectedStatus: "pending",
      responseText: "Open https://analytics.agent-native.test/approve/1",
    },
  ])(
    "emits $expectedStatus when the remote task ends $state",
    async ({ state, expectedStatus, responseText }) => {
      callAgentMock.mockRejectedValueOnce(
        Object.assign(new Error(`remote ${state}`), {
          name: "A2ATaskTerminalError",
          taskId: `task-${state}`,
          state,
          responseText,
          errorCode: `a2a_task_${state.replace(/-/g, "_")}`,
        }),
      );
      const { run } = await import("./call-agent.js");
      const send = vi.fn();

      const result = run({ agent: "analytics", message: "analyze customers" }, {
        send,
      } as any);

      if (state === "failed") {
        await expect(result).rejects.toThrow(responseText);
      } else {
        const resolved = await result;
        expect(resolved).toContain(responseText);
        if (state === "input-required") {
          expect(resolved).toContain(`taskId "task-${state}"`);
          expect(resolved).toContain(`taskId="task-${state}" (omit message)`);
        }
      }
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent_call",
          status: expectedStatus,
        }),
      );
      expect(send).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent_call", status: "done" }),
      );
      if (state === "input-required") {
        expect(send).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "agent_call",
            status: "pending",
            taskId: `task-${state}`,
          }),
        );
      }
    },
  );

  it("emits error when a direct semantic read returns a failed status", async () => {
    invokeActionMock.mockResolvedValueOnce({
      action: "gong-calls",
      status: "failed",
      output: "Gong unavailable",
    });
    const { run } = await import("./call-agent.js");
    const send = vi.fn();

    const result = await run(
      {
        agent: "analytics",
        action: "gong-calls",
        input: { company: "Edmunds" },
      },
      { send } as any,
      "mail",
    );

    expect(result).toMatch(/^Error calling Slides action gong-calls:/);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_call", status: "error" }),
    );
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_call", status: "done" }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent_call",
        status: "error",
        terminalCode: "direct_action_failed",
      }),
    );
  });

  it("tracks a content-free sender outcome for failed delegated tasks", async () => {
    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-a2a-invocation",
      track(event) {
        tracked.push(event);
      },
    });
    try {
      callAgentMock.mockRejectedValueOnce(
        Object.assign(new Error("remote failed"), {
          name: "A2ATaskTerminalError",
          taskId: "task-failed-telemetry",
          state: "failed",
          responseText: "provider retries exhausted",
          errorCode: "provider_network_error",
        }),
      );
      const { run } = await import("./call-agent.js");

      await expect(
        run(
          { agent: "analytics", message: "private customer request" },
          {
            send: vi.fn(),
            threadId: "thread-qa",
            runId: "run-qa",
            turnId: "turn-qa",
          } as any,
          "mail",
        ),
      ).rejects.toThrow("provider retries exhausted");

      const event = tracked.find(
        (candidate) => candidate.name === "$a2a_invocation",
      );
      expect(event?.properties).toMatchObject({
        source: "a2a_delegation",
        caller_app: "mail",
        target_app: "slides",
        mode: "message",
        status: "error",
        task_id: "task-failed-telemetry",
        terminal_code: "provider_network_error",
        delegation_depth: 1,
        parent_run_id: "run-qa",
        parent_turn_id: "turn-qa",
      });
      expect(JSON.stringify(event)).not.toContain("private customer request");
      expect(JSON.stringify(event)).not.toContain("provider retries exhausted");
    } finally {
      unregisterTrackingProvider("qa-a2a-invocation");
    }
  });

  it("fails loudly when the delegation target cannot be resolved", async () => {
    const discovery = await import("../server/agent-discovery.js");
    vi.mocked(discovery.findAgent).mockResolvedValueOnce(undefined);
    vi.mocked(discovery.discoverAgents).mockResolvedValueOnce([
      { id: "plan", name: "Plan", description: "", url: "", color: "" },
    ]);
    const logged: string[] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.join(" "));
      });
    const tracked: TrackingEvent[] = [];
    registerTrackingProvider({
      name: "qa-a2a-not-found",
      track(event) {
        tracked.push(event);
      },
    });

    try {
      const { run } = await import("./call-agent.js");
      const outcome = await run(
        { agent: "nosuchapp", message: "Create the rollout plan" },
        { send: vi.fn(), threadId: "t", runId: "r", turnId: "u" } as any,
        "brain",
      ).then(
        (resolved) => ({ resolved }) as const,
        (error) => ({ error }) as const,
      );

      expect("error" in outcome).toBe(true);
      const error = (outcome as { error: any }).error;
      expect(error.name).toBe("A2AInvocationError");
      expect(error.errorCode).toBe("agent_not_found");
      expect(error.message).toContain("nosuchapp");
      expect(error.message).toContain("plan");
      expect(error.message).toMatch(/not an outage/i);

      expect(
        logged.some((line) => line.includes("Unresolvable delegation target")),
      ).toBe(true);
      expect(
        tracked.find((event) => event.name === "$a2a_invocation")?.properties,
      ).toMatchObject({
        caller_app: "brain",
        target_app: "nosuchapp",
        status: "error",
        terminal_code: "agent_not_found",
        mode: "message",
      });
    } finally {
      unregisterTrackingProvider("qa-a2a-not-found");
      consoleError.mockRestore();
    }
  });

  it.each([
    {
      label: "direct action",
      args: { action: "gong-calls" },
      mode: "direct_action",
    },
    { label: "task poll", args: { taskId: "task-1" }, mode: "task_poll" },
  ])(
    "reports the caller's own mode when a $label target cannot be resolved",
    async ({ args, mode }) => {
      const discovery = await import("../server/agent-discovery.js");
      vi.mocked(discovery.findAgent).mockResolvedValueOnce(undefined);
      vi.mocked(discovery.discoverAgents).mockResolvedValueOnce([]);
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const tracked: TrackingEvent[] = [];
      registerTrackingProvider({
        name: "qa-a2a-not-found-mode",
        track(event) {
          tracked.push(event);
        },
      });

      try {
        const { run } = await import("./call-agent.js");
        await expect(
          run(
            { agent: "nosuchapp", ...args },
            { send: vi.fn() } as any,
            "brain",
          ),
        ).rejects.toMatchObject({ errorCode: "agent_not_found" });

        expect(
          tracked.find((event) => event.name === "$a2a_invocation")?.properties,
        ).toMatchObject({ mode, terminal_code: "agent_not_found" });
      } finally {
        unregisterTrackingProvider("qa-a2a-not-found-mode");
        consoleError.mockRestore();
      }
    },
  );

  it("does not report an empty delegated response as success", async () => {
    callAgentMock.mockResolvedValueOnce("");
    const { run } = await import("./call-agent.js");
    const send = vi.fn();

    await expect(
      run({ agent: "analytics", message: "analyze customers" }, {
        send,
      } as any),
    ).rejects.toThrow("The Slides agent returned no result.");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_call", status: "error" }),
    );
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent_call", status: "done" }),
    );
  });

  it("queues an integration continuation for structurally equivalent timeout errors", async () => {
    process.env.NETLIFY = "true";
    const timeout = Object.assign(
      new Error(
        "A2A task remote-task-1 did not complete within 18000ms (last state: processing)",
      ),
      {
        name: "A2ATaskTimeoutError",
        taskId: "remote-task-1",
      },
    );
    callAgentMock.mockRejectedValueOnce(timeout);
    const { run } = await import("./call-agent.js");

    const result = await run(
      { agent: "slides", message: "create the QA deck" },
      { send: vi.fn() } as any,
    );

    expect(result).toContain("[agent-native:a2a-continuation-queued]");
    expect(insertA2AContinuationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationTaskId: "integration-task-1",
        agentName: "Slides",
        agentUrl: "https://slides.agent-native.test",
        a2aTaskId: "remote-task-1",
        dedupeKey: expect.any(String),
        progressRef: {
          kind: "slack-stream",
          streamTs: "1719000000.000001",
        },
      }),
    );
    expect(dispatchA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(callAgentMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      expect.stringContaining(
        "Source Slack thread: https://example-workspace.slack.com/archives/C123/p123456",
      ),
      expect.any(Object),
    );
  });

  it("uses the bounded Netlify handoff when SITE_ID is the only runtime marker", async () => {
    process.env.SITE_ID = "00000000-0000-0000-0000-000000000000"; // guard:allow-env-credential -- fake value exercises Netlify's public runtime host marker.
    const timeout = Object.assign(
      new Error(
        "A2A task remote-task-site-id did not complete within 2000ms (last state: processing)",
      ),
      {
        name: "A2ATaskTimeoutError",
        taskId: "remote-task-site-id",
      },
    );
    callAgentMock.mockRejectedValueOnce(timeout);
    const { run } = await import("./call-agent.js");

    const result = await run(
      { agent: "content", message: "create the QA design ask" },
      { send: vi.fn() } as any,
    );

    expect(callAgentMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      expect.any(String),
      expect.objectContaining({
        timeoutMs: 2_000,
        submissionTimeoutMs: 15_000,
      }),
    );
    expect(insertA2AContinuationMock).toHaveBeenCalledTimes(1);
    expect(insertA2AContinuationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationTaskId: "integration-task-1",
        externalThreadId: "C123:123.456",
        a2aTaskId: "remote-task-site-id",
        dedupeKey: expect.any(String),
        progressRef: {
          kind: "slack-stream",
          streamTs: "1719000000.000001",
        },
      }),
    );
    expect(dispatchA2AContinuationMock).toHaveBeenCalledTimes(1);
    expect(dispatchA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(result).toContain("[agent-native:a2a-continuation-queued]");
  });

  it("reuses an existing SITE_ID continuation without calling the downstream agent again", async () => {
    process.env.SITE_ID = "00000000-0000-0000-0000-000000000000"; // guard:allow-env-credential -- fake value exercises Netlify's public runtime host marker.
    integrationRequestContextMock.mockReturnValue({
      ...slackIntegrationContext,
      attempts: 2,
    });
    getA2AContinuationsMock.mockResolvedValueOnce([
      { id: "cont-existing", status: "pending" },
    ]);
    const { run } = await import("./call-agent.js");

    const result = await run(
      { agent: "content", message: "create the QA design ask" },
      { send: vi.fn() } as any,
    );

    expect(getA2AContinuationsMock).toHaveBeenCalledWith(
      "integration-task-1",
      "https://slides.agent-native.test",
      expect.any(String),
    );
    expect(result).toContain("[agent-native:a2a-continuation-queued]");
    expect(result).toContain("already accepted this delegated subtask");
    expect(callAgentMock).not.toHaveBeenCalled();
    expect(insertA2AContinuationMock).not.toHaveBeenCalled();
    expect(dispatchA2AContinuationMock).not.toHaveBeenCalled();
  });

  it.each([
    ["explicit NETLIFY=false with SITE_ID", "NETLIFY", "false", true],
    ["NETLIFY_LOCAL=true with SITE_ID", "NETLIFY_LOCAL", "true", true],
    ["explicit NETLIFY=false without SITE_ID", "NETLIFY", "false", false],
    ["NETLIFY_LOCAL=true without SITE_ID", "NETLIFY_LOCAL", "true", false],
  ])(
    "lets %s suppress Netlify and compatibility-host timeouts",
    async (_label, key, value, withSiteId) => {
      if (withSiteId) {
        process.env.SITE_ID = "00000000-0000-0000-0000-000000000000"; // guard:allow-env-credential -- fake value exercises Netlify's public runtime host marker.
      }
      process.env.AWS_LAMBDA_FUNCTION_NAME = "server";
      process.env[key] = value;
      callAgentMock.mockResolvedValueOnce("Handled");
      const { run } = await import("./call-agent.js");

      await run({ agent: "content", message: "create the QA design ask" }, {
        send: vi.fn(),
      } as any);

      expect(callAgentMock).toHaveBeenCalledWith(
        "https://slides.agent-native.test",
        expect.any(String),
        expect.not.objectContaining({
          timeoutMs: expect.any(Number),
          submissionTimeoutMs: expect.any(Number),
        }),
      );
    },
  );

  it.each([
    ["AWS Lambda", "AWS_LAMBDA_FUNCTION_NAME", "server"],
    ["Vercel", "VERCEL", "1"],
  ])(
    "keeps the existing non-Netlify timeout on %s",
    async (_label, key, value) => {
      process.env[key] = value;
      callAgentMock.mockResolvedValueOnce("Handled");
      const { run } = await import("./call-agent.js");

      await run({ agent: "content", message: "create the QA design ask" }, {
        send: vi.fn(),
      } as any);

      expect(callAgentMock).toHaveBeenCalledWith(
        "https://slides.agent-native.test",
        expect.any(String),
        expect.objectContaining({ timeoutMs: 18_000 }),
      );
      expect(callAgentMock.mock.calls[0]?.[2]).not.toHaveProperty(
        "submissionTimeoutMs",
      );
    },
  );

  it("returns receiver-verified artifacts when continuation enqueue fails", async () => {
    process.env.NETLIFY = "true";
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    insertA2AContinuationMock.mockRejectedValueOnce(
      new Error("database temporarily unavailable"),
    );
    const timeout = Object.assign(
      new Error("A2A task remote-task-artifact did not complete within 2000ms"),
      {
        name: "A2ATaskTimeoutError",
        taskId: "remote-task-artifact",
        lastTask: {
          id: "remote-task-artifact",
          status: {
            state: "working",
            timestamp: "",
            message: {
              role: "agent",
              metadata: { agentNativeRecoverableArtifacts: true },
              parts: [
                {
                  type: "text",
                  text: "Artifacts:\n- Deck: /deck/deck-real (ID: deck-real)",
                },
              ],
            },
          },
        },
      },
    );
    callAgentMock.mockRejectedValueOnce(timeout);
    const { run } = await import("./call-agent.js");

    const result = await run(
      { agent: "slides", message: "create the QA deck" },
      { send: vi.fn() } as any,
    );

    expect(result).toContain("https://slides.agent-native.test/deck/deck-real");
    expect(result).not.toContain("[agent-native:a2a-continuation-queued]");
    expect(dispatchA2AContinuationMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  describe("poll-driven progress", () => {
    const makeTask = (
      state: string,
      detailText?: string,
      parts: unknown[] = [],
    ): any => ({
      id: "task-1",
      status: {
        state,
        timestamp: "",
        ...(detailText || parts.length
          ? {
              message: {
                role: "agent",
                parts: [
                  ...parts,
                  ...(detailText ? [{ type: "text", text: detailText }] : []),
                ],
              },
            }
          : {}),
      },
    });

    it("emits no progress events when the call resolves immediately (onUpdate never fires)", async () => {
      callAgentMock.mockResolvedValueOnce("All done");
      const { run } = await import("./call-agent.js");
      const send = vi.fn();

      const result = await run({ agent: "slides", message: "quick question" }, {
        send,
      } as any);

      expect(result).toBe("All done");
      const events = send.mock.calls.map(([event]) => event);
      expect(
        events.filter((e: any) => e.type === "agent_call_progress"),
      ).toHaveLength(0);
      expect(events).toContainEqual(
        expect.objectContaining({ type: "agent_call", status: "start" }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({ type: "agent_call", status: "done" }),
      );
    });

    it("throttles progress to ~one per 30s over a long poll that round-trips every 2s", async () => {
      vi.useFakeTimers();
      try {
        let onUpdate: ((task: any) => void) | undefined;
        let resolveCall: ((value: string) => void) | undefined;
        callAgentMock.mockImplementation((_url, _msg, opts) => {
          onUpdate = opts.onUpdate;
          return new Promise<string>((res) => {
            resolveCall = res;
          });
        });

        const { run } = await import("./call-agent.js");
        const send = vi.fn();
        const p = run({ agent: "slides", message: "long task" }, {
          send,
        } as any);

        while (!onUpdate) await vi.advanceTimersByTimeAsync(1);

        for (let i = 0; i < 40; i++) {
          await vi.advanceTimersByTimeAsync(2_000);
          onUpdate!(makeTask("working", "Generating slides…"));
        }
        resolveCall!("final answer");
        await p;

        const progress = send.mock.calls
          .map(([e]) => e)
          .filter((e: any) => e.type === "agent_call_progress");
        expect(progress.length).toBeGreaterThanOrEqual(2);
        expect(progress.length).toBeLessThanOrEqual(3);
        expect(progress.length).toBeLessThan(10);
        expect(progress[0]).toMatchObject({
          type: "agent_call_progress",
          agent: "Slides",
          state: "working",
          detail: "Generating slides…",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("treats a claimed processing task as active remote progress", async () => {
      vi.useFakeTimers();
      try {
        let onUpdate: ((task: any) => void) | undefined;
        let resolveCall: ((value: string) => void) | undefined;
        callAgentMock.mockImplementation((_url, _msg, opts) => {
          onUpdate = opts.onUpdate;
          return new Promise<string>((resolve) => {
            resolveCall = resolve;
          });
        });

        const { run } = await import("./call-agent.js");
        const send = vi.fn();
        const pending = run({ agent: "slides", message: "long claimed task" }, {
          send,
        } as any);
        while (!onUpdate) await vi.advanceTimersByTimeAsync(1);

        await vi.advanceTimersByTimeAsync(30_000);
        onUpdate!(makeTask("processing", "Rendering the deck…"));
        resolveCall!("final answer");
        await pending;

        expect(send).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "agent_call_progress",
            agent: "Slides",
            state: "processing",
            elapsedSeconds: 30,
            detail: "Rendering the deck…",
            agentCallId: expect.any(String),
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("emits agent_call_progress events the REAL run-manager progress predicate (not a copy) counts as progress", async () => {
      vi.useFakeTimers();
      try {
        let onUpdate: ((task: any) => void) | undefined;
        let resolveCall: ((value: string) => void) | undefined;
        callAgentMock.mockImplementation((_url, _msg, opts) => {
          onUpdate = opts.onUpdate;
          return new Promise<string>((res) => {
            resolveCall = res;
          });
        });

        const { run: callAgentAction } = await import("./call-agent.js");
        const { startRun } = await import("../agent/run-manager.js");

        const managedRun = startRun(
          "run-progress-1",
          "thread-progress-1",
          async (send) => {
            await callAgentAction(
              { agent: "slides", message: "build the deck" },
              { send } as any,
            );
          },
          undefined,
          { softTimeoutMs: 0 },
        );
        managedRun.subscribers.add(() => {});

        while (!onUpdate) await vi.advanceTimersByTimeAsync(1);

        await vi.advanceTimersByTimeAsync(30_000);
        onUpdate!(makeTask("working"));
        await vi.advanceTimersByTimeAsync(30_000);
        onUpdate!(makeTask("working"));
        await vi.advanceTimersByTimeAsync(2_000);
        resolveCall!("final");
        await vi.advanceTimersByTimeAsync(2_000);

        expect(bumpRunProgressMock.mock.calls.length).toBeGreaterThanOrEqual(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it("emits NOTHING when the remote hangs so the stuck-detector can still fire (onUpdate never called)", async () => {
      callAgentMock.mockImplementation(async (_url, _msg, opts) => {
        expect(typeof opts.onUpdate).toBe("function");
        return "The Slides agent is taking longer than expected and didn't reply in time.";
      });
      const { run } = await import("./call-agent.js");
      const send = vi.fn();

      await run({ agent: "slides", message: "x" }, { send } as any);

      const events = send.mock.calls.map(([e]) => e);
      expect(
        events.filter((e: any) => e.type === "agent_call_progress"),
      ).toHaveLength(0);
      expect(events).toContainEqual(
        expect.objectContaining({ type: "agent_call", status: "start" }),
      );
    });

    it("emits each newer remote activity snapshot once", async () => {
      let onUpdate: ((task: any) => void) | undefined;
      let resolveCall: ((value: string) => void) | undefined;
      callAgentMock.mockImplementation((_url, _msg, opts) => {
        onUpdate = opts.onUpdate;
        return new Promise<string>((resolve) => {
          resolveCall = resolve;
        });
      });

      const { run } = await import("./call-agent.js");
      const send = vi.fn();
      const pending = run({ agent: "slides", message: "build the deck" }, {
        send,
      } as any);
      while (!onUpdate) await Promise.resolve();

      const activityPart = (sequence: number) => ({
        type: "data",
        data: {
          kind: "agent-native/agent-activity",
          version: 1,
          sequence,
          startedAt: 1_000,
          updatedAt: 1_000 + sequence,
          durationMs: sequence,
          activePhase: "tool",
          reasoning: [],
          toolCalls: [{ id: "search-1", name: "search", status: "running" }],
        },
      });

      onUpdate!(makeTask("working", undefined, [activityPart(1)]));
      onUpdate!(makeTask("working", undefined, [activityPart(1)]));
      onUpdate!(makeTask("working", undefined, [activityPart(2)]));
      resolveCall!("finished");
      await pending;

      const activityEvents = send.mock.calls
        .map(([event]) => event)
        .filter((event: any) => event.type === "agent_call_activity");
      expect(
        activityEvents.map((event: any) => event.snapshot.sequence),
      ).toEqual([1, 2]);
    });

    it("emits NOTHING when the remote poll throws (getTask rejects)", async () => {
      callAgentMock.mockRejectedValueOnce(new Error("fetch failed"));
      const { run } = await import("./call-agent.js");
      const send = vi.fn();

      await expect(
        run({ agent: "slides", message: "x" }, { send } as any),
      ).rejects.toThrow("fetch failed");

      const events = send.mock.calls.map(([e]) => e);
      expect(
        events.filter((e: any) => e.type === "agent_call_progress"),
      ).toHaveLength(0);
    });

    it("does not emit progress for a terminal-state poll even with the throttle window open", async () => {
      vi.useFakeTimers();
      try {
        let onUpdate: ((task: any) => void) | undefined;
        let resolveCall: ((value: string) => void) | undefined;
        callAgentMock.mockImplementation((_url, _msg, opts) => {
          onUpdate = opts.onUpdate;
          return new Promise<string>((res) => {
            resolveCall = res;
          });
        });

        const { run } = await import("./call-agent.js");
        const send = vi.fn();
        const p = run({ agent: "slides", message: "x" }, { send } as any);
        while (!onUpdate) await vi.advanceTimersByTimeAsync(1);

        await vi.advanceTimersByTimeAsync(40_000);
        onUpdate!(makeTask("completed"));
        resolveCall!("done");
        await p;

        const progress = send.mock.calls
          .map(([e]) => e)
          .filter((e: any) => e.type === "agent_call_progress");
        expect(progress).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("allows a terminal poll update without message parts to complete", async () => {
      callAgentMock.mockImplementation(async (_url, _message, opts) => {
        opts.onUpdate({
          id: "task-1",
          status: {
            state: "completed",
            timestamp: "",
            message: { role: "agent" },
          },
        });
        return "terminal answer";
      });

      const { run } = await import("./call-agent.js");
      const send = vi.fn();

      const result = await run({ agent: "slides", message: "x" }, {
        send,
      } as any);

      expect(result).toBe("terminal answer");
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent_call",
          agent: "Slides",
          status: "done",
        }),
      );
    });

    it("allows a working poll update with non-array message parts", async () => {
      vi.useFakeTimers();
      try {
        let onUpdate: ((task: any) => void) | undefined;
        let resolveCall: ((value: string) => void) | undefined;
        callAgentMock.mockImplementation((_url, _message, opts) => {
          onUpdate = opts.onUpdate;
          return new Promise<string>((resolve) => {
            resolveCall = resolve;
          });
        });

        const { run } = await import("./call-agent.js");
        const send = vi.fn();
        const pending = run({ agent: "slides", message: "x" }, {
          send,
        } as any);
        while (!onUpdate) await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(40_000);

        expect(() =>
          onUpdate!({
            id: "task-1",
            status: {
              state: "working",
              timestamp: "",
              message: { role: "agent", parts: {} },
            },
          }),
        ).not.toThrow();
        resolveCall!("terminal answer");
        await pending;

        expect(
          send.mock.calls
            .map(([event]) => event)
            .find((event: any) => event.type === "agent_call_progress"),
        ).toEqual(
          expect.objectContaining({
            type: "agent_call_progress",
            state: "working",
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("threads onUpdate through and leaves the integration-caller timeout cap unchanged", async () => {
      process.env.NETLIFY = "true";
      callAgentMock.mockResolvedValueOnce("Handled");
      const { run } = await import("./call-agent.js");

      await run({ agent: "slides", message: "quick integration question" }, {
        send: vi.fn(),
      } as any);

      expect(callAgentMock).toHaveBeenCalledWith(
        "https://slides.agent-native.test",
        expect.any(String),
        expect.objectContaining({
          timeoutMs: 2_000,
          onUpdate: expect.any(Function),
          returnRecoverableArtifactsOnTimeout: false,
        }),
      );
    });
  });
});
