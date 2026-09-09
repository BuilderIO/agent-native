import type {
  AgentApprovalResponse,
  AgentEvent,
  AgentMessage,
} from "@agent-native/agentkit-protocol";
import { describe, expect, it, vi } from "vitest";

import { createAgentKitProtocolAdapter } from "./agentkit-protocol.js";
import type { AgentChatRuntime, AgentChatRuntimeEvent } from "./runtime.js";

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

function userMessage(text: string): AgentMessage {
  return {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function approvalResponse(
  decision: "approve" | "deny",
  input?: Record<string, unknown>,
): AgentApprovalResponse {
  return {
    decision,
    ...(input ? { input } : {}),
  };
}

const trustedMetadata = {
  actor: { id: "host-actor" },
  workspace: { id: "host-workspace" },
  organization: { id: "host-organization" },
  access: [{ id: "host-access" }],
  audit: { id: "host-audit" },
  trace: { traceId: "host-trace" },
  custom: "host-default",
  "x-agent-native": {
    identity: {
      actor: { id: "host-native-actor" },
      workspace: { id: "host-native-workspace" },
      organization: { id: "host-native-organization" },
    },
    access: { scope: "host" },
    audit: { id: "host-native-audit" },
    trace: { traceId: "host-native-trace" },
    context: { route: "host-default" },
  },
};

const callerMetadata = {
  actor: { id: "caller-actor" },
  workspace: { id: "caller-workspace" },
  organization: { id: "caller-organization" },
  access: [{ id: "caller-access" }],
  audit: { id: "caller-audit" },
  trace: { traceId: "caller-trace" },
  custom: "caller-value",
  "x-agent-native": {
    identity: {
      actor: { id: "caller-native-actor" },
      workspace: { id: "caller-native-workspace" },
      organization: { id: "caller-native-organization" },
    },
    access: { scope: "caller" },
    audit: { id: "caller-native-audit" },
    trace: { traceId: "caller-native-trace" },
    context: { route: "caller-route" },
  },
};

function expectTrustedMetadata(metadata: unknown): void {
  expect(metadata).toMatchObject({
    actor: trustedMetadata.actor,
    workspace: trustedMetadata.workspace,
    organization: trustedMetadata.organization,
    access: trustedMetadata.access,
    audit: trustedMetadata.audit,
    trace: trustedMetadata.trace,
    custom: "caller-value",
    "x-agent-native": {
      identity: trustedMetadata["x-agent-native"].identity,
      access: trustedMetadata["x-agent-native"].access,
      audit: trustedMetadata["x-agent-native"].audit,
      trace: trustedMetadata["x-agent-native"].trace,
      context: { route: "caller-route" },
    },
  });
}

function createRuntime(
  events: () => AsyncIterable<AgentChatRuntimeEvent>,
  overrides: Partial<AgentChatRuntime> = {},
): AgentChatRuntime {
  return {
    id: "runtime-test",
    kind: "external-agent",
    label: "Test runtime",
    capabilities: {
      messages: { streaming: true, history: true, attachments: true },
      ...overrides.capabilities,
    },
    async createSession() {
      return {
        id: "thread-1",
        runtimeId: "runtime-test",
        startTurn: async () => ({
          id: "turn-1",
          runId: "core-run-1",
          sessionId: "thread-1",
          events: events(),
        }),
      };
    },
    ...overrides,
  };
}

describe("createAgentKitProtocolAdapter", () => {
  it("pauses for a typed connection request and resumes the same run", async () => {
    async function* connectionEvents(): AsyncIterable<AgentChatRuntimeEvent> {
      yield {
        type: "connection-request",
        requestId: "connection-1",
        provider: "slack",
        reason: "connect",
        appId: "dispatch",
        detail: "Connect Slack to verify the workflow.",
      };
      // A paused HTTP stream may remain open until the host sends the
      // continuation. The adapter must release its reader at the request
      // boundary instead of deadlocking the response behind stream closure.
      await new Promise<void>(() => {});
    }
    const continueTurn = vi.fn(async () => ({
      id: "turn-2",
      sessionId: "thread-1",
      events: (async function* (): AsyncIterable<AgentChatRuntimeEvent> {
        yield { type: "done", reason: "complete" };
      })(),
    }));
    const runtime = createRuntime(connectionEvents, {
      capabilities: {
        messages: { streaming: true },
        rich: { connectionRequests: true },
      },
    });
    runtime.createSession = async () => ({
      id: "thread-1",
      runtimeId: runtime.id,
      startTurn: async () => ({
        id: "turn-1",
        sessionId: "thread-1",
        events: connectionEvents(),
      }),
      continueTurn,
    });
    const transport = createAgentKitProtocolAdapter(runtime);
    const discovery = await transport.discoverCapabilities?.({
      protocol: { protocol: "agentkit", versions: [1] },
    });
    expect(discovery?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "connectionRequests",
          state: "available",
        }),
      ]),
    );
    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Verify Slack")],
    });
    const iterator = transport
      .subscribeToRun({ threadId: "thread-1", runId })
      [Symbol.asyncIterator]();
    const observed: AgentEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      observed.push(next.value);
      if (next.value.type === "connection.requested") break;
    }
    expect(observed.at(-1)).toMatchObject({
      type: "connection.requested",
      request: {
        provider: "slack",
        reason: "connect",
        status: "requested",
      },
    });

    await transport.resolveConnectionRequest?.({
      threadId: "thread-1",
      runId,
      requestId: "connection-1",
      response: { status: "connected", connectionId: "workspace-slack" },
    });
    await drain({ [Symbol.asyncIterator]: () => iterator });

    expect(continueTurn).toHaveBeenCalledWith({
      turnId: "turn-1",
      connection: {
        id: "slack",
        status: "connected",
        connectionId: "workspace-slack",
        message: undefined,
      },
    });
  });

  it("translates Core turn events and supports in-process sequence replay", async () => {
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield {
        type: "message-start",
        message: {
          id: "assistant-1",
          role: "assistant",
          content: [],
        },
      };
      yield {
        type: "message-delta",
        messageId: "assistant-1",
        delta: { type: "text", text: "Done." },
      };
      yield {
        type: "tool-start",
        toolCall: { id: "tool-1", name: "run_checks", input: { count: 1 } },
      };
      yield {
        type: "tool-delta",
        toolCallId: "tool-1",
        toolName: "run_checks",
        resultTextDelta: "1 passed",
      };
      yield {
        type: "tool-done",
        toolCallId: "tool-1",
        toolName: "run_checks",
        status: "completed",
        resultText: "1 passed",
      };
      yield { type: "done", reason: "complete" };
    }

    const transport = createAgentKitProtocolAdapter(createRuntime(events), {
      now: () => "2026-08-28T00:00:00.000Z",
    });
    expect(transport.capabilities?.resumableRuns).toBe(false);
    expect(transport.capabilities?.["x-resumable-runs-reason"]).toContain(
      "process-local",
    );
    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Run the checks")],
    });
    const result = await drain(
      transport.subscribeToRun({ threadId: "thread-1", runId }),
    );

    expect(result.find((event) => event.type === "run.failed")).toBeUndefined();
    expect(result.map((event) => event.type)).toEqual([
      "run.started",
      "run.status",
      "message.created",
      "message.delta",
      "tool.started",
      "activity.started",
      "tool.delta",
      "tool.updated",
      "activity.completed",
      "run.status",
      "run.completed",
    ]);
    expect(result.map((event) => event.sequence)).toEqual(
      result.map((_, index) => index + 1),
    );
    expect(result[2]).toMatchObject({
      type: "message.created",
      message: { id: "assistant-1" },
    });
    expect(result[6]).toMatchObject({
      type: "tool.delta",
      toolCallId: "tool-1",
      outputTextDelta: "1 passed",
    });
    expect(result[7]).toMatchObject({
      type: "tool.updated",
      toolCall: { name: "run_checks", output: "1 passed" },
    });
    expect(result[5]).toMatchObject({
      type: "activity.started",
      activity: { kind: "check", label: "Run checks" },
    });

    const replay = await drain(
      transport.subscribeToRun({
        threadId: "thread-1",
        runId,
        afterSequence: 8,
      }),
    );
    expect(replay.map((event) => event.sequence)).toEqual([9, 10, 11]);

    await expect(
      transport.getRun?.({ threadId: "thread-1", runId }),
    ).resolves.toMatchObject({
      status: "completed",
      lastSequence: 11,
    });
  });

  it("advertises host-owned feedback only when the operation is wired", () => {
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const withoutFeedback = createAgentKitProtocolAdapter(
      createRuntime(events),
    );
    const withFeedback = createAgentKitProtocolAdapter(createRuntime(events), {
      operations: { submitFeedback: async () => undefined },
    });

    expect(withoutFeedback.capabilities?.feedback).toBe(false);
    expect(withFeedback.capabilities?.feedback).toBe(true);
  });

  it("preserves event capabilities but rejects operation claims without implementations", async () => {
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const transport = createAgentKitProtocolAdapter(createRuntime(events), {
      capabilities: {
        actions: true,
        feedback: true,
        messageQueue: true,
        resumableRuns: true,
        suggestions: true,
        threadForking: true,
        threadHistory: true,
        uploads: true,
      },
    });

    expect(transport.capabilities).toMatchObject({
      actions: false,
      feedback: false,
      messageQueue: false,
      resumableRuns: false,
      suggestions: true,
      threadForking: false,
      threadHistory: false,
      uploads: false,
    });
    await expect(
      transport.startRun({
        threadId: "thread-1",
        messages: [userMessage("Continue")],
      }),
    ).resolves.toMatchObject({
      capabilities: { suggestions: true, threadHistory: false },
    });
  });

  it("advertises and delegates host-owned durable thread forks", async () => {
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const forkThread = vi.fn(async () => ({
      id: "thread-fork",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
    }));
    const transport = createAgentKitProtocolAdapter(createRuntime(events), {
      operations: { forkThread },
    });

    expect(transport.capabilities?.threadForking).toBe(true);
    await expect(
      transport.forkThread?.({
        threadId: "thread-1",
        fromMessageId: "assistant-1",
      }),
    ).resolves.toMatchObject({ id: "thread-fork" });
    expect(forkThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      fromMessageId: "assistant-1",
    });
  });

  it("carries explicit and host-default text formats through streamed replies", async () => {
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield {
        type: "message-start",
        message: {
          id: "assistant-format-1",
          role: "assistant",
          content: [],
        },
      };
      yield {
        type: "message-delta",
        messageId: "assistant-format-1",
        delta: { type: "text", text: "**formatted**" },
      };
      yield {
        type: "message-done",
        message: {
          id: "assistant-format-1",
          role: "assistant",
          content: [
            { type: "text", text: "**formatted**", format: "markdown" },
          ],
        },
      };
      yield { type: "done", reason: "complete" };
    }

    const transport = createAgentKitProtocolAdapter(createRuntime(events), {
      textFormat: "markdown",
    });
    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Explain the result")],
    });
    const result = await drain(
      transport.subscribeToRun({ threadId: "thread-1", runId }),
    );

    expect(result).toContainEqual(
      expect.objectContaining({
        type: "message.delta",
        format: "markdown",
      }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({
        type: "message.completed",
        message: expect.objectContaining({
          parts: [{ type: "text", text: "**formatted**", format: "markdown" }],
        }),
      }),
    );
  });

  it("forwards provider-neutral run options into the Core turn", async () => {
    let receivedInput: unknown;
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const runtime = createRuntime(events);
    runtime.createSession = async () => ({
      id: "thread-1",
      runtimeId: runtime.id,
      startTurn: async (input) => {
        receivedInput = input;
        return {
          id: "turn-1",
          sessionId: "thread-1",
          events: events(),
        };
      },
    });

    const transport = createAgentKitProtocolAdapter(runtime);
    await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Inspect it")],
      options: {
        model: "frontier",
        reasoningEffort: "high",
        toolChoice: "auto",
        parallelToolCalls: true,
        locale: "en-CA",
      },
    });

    expect(receivedInput).toMatchObject({
      model: "frontier",
      reasoningEffort: "high",
      providerOptions: { toolChoice: "auto", parallelToolCalls: true },
      metadata: { locale: "en-CA" },
    });
  });

  it("protects host metadata when creating a thread", async () => {
    let receivedMetadata: unknown;
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const runtime = createRuntime(events);
    runtime.createSession = async (input) => {
      receivedMetadata = input?.metadata;
      return {
        id: input?.id ?? "thread-created",
        runtimeId: runtime.id,
        threadId: input?.threadId,
        startTurn: async () => ({
          id: "turn-created",
          sessionId: input?.id ?? "thread-created",
          events: events(),
        }),
      };
    };
    const transport = createAgentKitProtocolAdapter(runtime, {
      metadata: trustedMetadata,
    });

    await transport.createThread?.({
      id: "thread-created",
      metadata: callerMetadata,
    });

    expectTrustedMetadata(receivedMetadata);
  });

  it("protects host metadata when opening an implicit runtime session", async () => {
    let receivedMetadata: unknown;
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const runtime = createRuntime(events);
    runtime.getSession = async () => null;
    runtime.createSession = async (input) => {
      receivedMetadata = input?.metadata;
      return {
        id: "thread-opened",
        runtimeId: runtime.id,
        threadId: "thread-opened",
        startTurn: async () => ({
          id: "turn-opened",
          sessionId: "thread-opened",
          events: events(),
        }),
      };
    };
    const transport = createAgentKitProtocolAdapter(runtime, {
      metadata: trustedMetadata,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-opened",
      messages: [userMessage("Open it")],
      metadata: callerMetadata,
    });
    await drain(transport.subscribeToRun({ threadId: "thread-opened", runId }));

    expectTrustedMetadata(receivedMetadata);
  });

  it("protects host metadata when starting a run", async () => {
    let receivedMetadata: unknown;
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const runtime = createRuntime(events);
    runtime.getSession = async () => ({
      id: "thread-existing",
      runtimeId: runtime.id,
      threadId: "thread-existing",
      startTurn: async (input) => {
        receivedMetadata = input.metadata;
        return {
          id: "turn-existing",
          sessionId: "thread-existing",
          metadata: callerMetadata,
          events: events(),
        };
      },
    });
    const transport = createAgentKitProtocolAdapter(runtime, {
      metadata: trustedMetadata,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-existing",
      messages: [userMessage("Start it")],
      metadata: callerMetadata,
    });
    const replay = await drain(
      transport.subscribeToRun({ threadId: "thread-existing", runId }),
    );

    expectTrustedMetadata(receivedMetadata);
    expectTrustedMetadata(replay[0]?.metadata);
  });

  it("protects host metadata when forking a thread", async () => {
    let receivedMetadata: unknown;
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const runtime = createRuntime(events, {
      capabilities: {
        messages: { streaming: true },
        sessions: { create: true, persistent: true, fork: true },
      },
    });
    runtime.getSession = async () => ({
      id: "thread-source",
      runtimeId: runtime.id,
      threadId: "thread-source",
      startTurn: async () => ({
        id: "turn-source",
        sessionId: "thread-source",
        events: events(),
      }),
      snapshot: async () => ({
        id: "thread-source",
        runtimeId: runtime.id,
        threadId: "thread-source",
        metadata: callerMetadata,
      }),
    });
    runtime.createSession = async (input) => {
      receivedMetadata = input?.metadata;
      return {
        id: input?.id ?? "thread-forked",
        runtimeId: runtime.id,
        threadId: input?.threadId,
        startTurn: async () => ({
          id: "turn-forked",
          sessionId: input?.id ?? "thread-forked",
          events: events(),
        }),
      };
    };
    const transport = createAgentKitProtocolAdapter(runtime, {
      createId: () => "thread-forked",
      metadata: trustedMetadata,
    });

    await transport.forkThread?.({
      threadId: "thread-source",
      metadata: callerMetadata,
    });

    expectTrustedMetadata(receivedMetadata);
  });

  it("protects host metadata on action, upload, queue, and feedback operations", async () => {
    let actionMetadata: unknown;
    let uploadMetadata: unknown;
    let queueMetadata: unknown;
    let feedbackMetadata: unknown;
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const transport = createAgentKitProtocolAdapter(createRuntime(events), {
      metadata: trustedMetadata,
      operations: {
        async invokeAction(input) {
          actionMetadata = input.invocation.metadata;
          return {
            invocationId: input.invocation.id,
            status: "completed",
          };
        },
        async createUpload(input) {
          uploadMetadata = input.descriptor.metadata;
          return {
            uploadId: "upload-1",
            method: "PUT",
            url: "https://example.com/upload",
          };
        },
        async queueMessage(input) {
          queueMetadata = input.metadata;
          return {
            message: {
              id: "queued-1",
              threadId: input.threadId,
              text: input.text,
              createdAt: "2026-08-29T00:00:00.000Z",
              metadata: input.metadata,
            },
          };
        },
        async submitFeedback(input) {
          feedbackMetadata = input.metadata;
        },
      },
    });

    await transport.invokeAction?.({
      invocation: {
        id: "invocation-1",
        action: "publish",
        threadId: "thread-1",
        metadata: callerMetadata,
      },
    });
    await transport.createUpload?.({
      threadId: "thread-1",
      descriptor: {
        name: "release.txt",
        mediaType: "text/plain",
        size: 12,
        metadata: callerMetadata,
      },
    });
    await transport.queueMessage?.({
      threadId: "thread-1",
      text: "Publish after approval",
      metadata: callerMetadata,
    });
    await transport.submitFeedback?.({
      threadId: "thread-1",
      messageId: "assistant-1",
      value: "positive",
      metadata: callerMetadata,
    });

    expectTrustedMetadata(actionMetadata);
    expectTrustedMetadata(uploadMetadata);
    expectTrustedMetadata(queueMetadata);
    expectTrustedMetadata(feedbackMetadata);
  });

  it("restores existing Core sessions and projects their message history", async () => {
    let created = false;
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const runtime = createRuntime(events);
    runtime.createSession = async () => {
      created = true;
      throw new Error("should not create");
    };
    runtime.getSession = async () => ({
      id: "thread-1",
      threadId: "thread-1",
      runtimeId: runtime.id,
      startTurn: async () => ({
        id: "turn-1",
        sessionId: "thread-1",
        events: events(),
      }),
      snapshot: async () => ({
        id: "thread-1",
        threadId: "thread-1",
        runtimeId: runtime.id,
        messages: [
          {
            id: "assistant-existing",
            role: "assistant",
            content: [{ type: "text", text: "Existing response" }],
          },
        ],
      }),
    });

    const transport = createAgentKitProtocolAdapter(runtime);
    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-1",
    });
    await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Continue")],
    });

    expect(created).toBe(false);
    expect(snapshot?.messages[0]).toMatchObject({
      id: "assistant-existing",
      parts: [{ type: "text", text: "Existing response" }],
    });
  });

  it("keeps an approval turn resumable until Core continues it", async () => {
    let continueTurnCalled = false;
    async function* approvalEvents(): AsyncIterable<AgentChatRuntimeEvent> {
      yield {
        type: "approval-request",
        approvalId: "approval-1",
        toolCallId: "tool-1",
        toolName: "publish",
        message: "Publish the release?",
      };
      yield { type: "done", reason: "tool-use" };
    }
    const runtime = createRuntime(approvalEvents, {
      capabilities: {
        messages: { streaming: true },
        tools: { events: true, approvals: true },
      },
    });
    runtime.createSession = async () => ({
      id: "thread-1",
      runtimeId: runtime.id,
      startTurn: async () => ({
        id: "turn-1",
        sessionId: "thread-1",
        events: approvalEvents(),
      }),
      continueTurn: async () => {
        continueTurnCalled = true;
        async function* resumed(): AsyncIterable<AgentChatRuntimeEvent> {
          yield { type: "done", reason: "complete" };
        }
        return {
          id: "turn-2",
          sessionId: "thread-1",
          events: resumed(),
        };
      },
    });

    const transport = createAgentKitProtocolAdapter(runtime);
    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Publish it")],
    });
    const stream = transport.subscribeToRun({ threadId: "thread-1", runId });
    const iterator = stream[Symbol.asyncIterator]();
    let approvalSeen = false;
    while (!approvalSeen) {
      const next = await iterator.next();
      expect(next.done).toBe(false);
      approvalSeen = next.value?.type === "approval.requested";
    }

    await transport.resolveApproval?.({
      threadId: "thread-1",
      runId,
      approvalId: "approval-1",
      response: approvalResponse("approve"),
    });
    const remaining: AgentEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      remaining.push(next.value);
    }

    expect(continueTurnCalled).toBe(true);
    expect(remaining.map((event) => event.type)).toContain("run.completed");
  });

  it("binds approval decisions to the exact pending request and fails closed", async () => {
    const continueTurn = vi.fn(
      async (input?: {
        approval?: { id: string; approved: boolean; message?: string };
      }) => ({
        id: "turn-2",
        sessionId: "thread-1",
        events: (async function* (): AsyncIterable<AgentChatRuntimeEvent> {
          yield { type: "done", reason: "complete" };
        })(),
        metadata: input?.approval,
      }),
    );
    async function* approvalEvents(): AsyncIterable<AgentChatRuntimeEvent> {
      yield {
        type: "approval-request",
        approvalId: "approval-current",
        toolCallId: "tool-1",
        toolName: "publish",
        message: "Publish?",
      };
      yield { type: "done", reason: "tool-use" };
    }
    const runtime = createRuntime(approvalEvents, {
      capabilities: {
        messages: { streaming: true },
        tools: { events: true, approvals: true },
      },
    });
    runtime.createSession = async () => ({
      id: "thread-1",
      runtimeId: runtime.id,
      startTurn: async () => ({
        id: "turn-1",
        sessionId: "thread-1",
        events: approvalEvents(),
      }),
      continueTurn,
    });
    const transport = createAgentKitProtocolAdapter(runtime);
    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Publish")],
    });
    const iterator = transport
      .subscribeToRun({ threadId: "thread-1", runId })
      [Symbol.asyncIterator]();
    while (true) {
      const next = await iterator.next();
      if (next.value?.type === "approval.requested") break;
    }

    await expect(
      transport.resolveApproval?.({
        threadId: "thread-1",
        runId,
        approvalId: "approval-stale",
        response: approvalResponse("approve"),
      }),
    ).rejects.toThrow(
      "Approval response approval-stale does not match pending approval approval-current",
    );
    await expect(
      transport.resolveApproval?.({
        threadId: "thread-1",
        runId,
        approvalId: "approval-current",
        response: {} as AgentApprovalResponse,
      }),
    ).rejects.toThrow("must include decision");
    expect(continueTurn).not.toHaveBeenCalled();

    await transport.resolveApproval?.({
      threadId: "thread-1",
      runId,
      approvalId: "approval-current",
      optionId: "approve",
      response: {
        ...approvalResponse("deny", { message: "Not yet" }),
        optionIds: ["approve"],
        other: "Use the staging channel",
      },
    });
    await drain({
      [Symbol.asyncIterator]: () => iterator,
    });

    expect(continueTurn).toHaveBeenCalledWith({
      turnId: "turn-1",
      approval: {
        id: "approval-current",
        approved: false,
        message: '{"message":"Not yet","other":"Use the staging channel"}',
      },
    });
    await expect(
      transport.resolveApproval?.({
        threadId: "thread-1",
        runId,
        approvalId: "approval-current",
        response: approvalResponse("approve"),
      }),
    ).rejects.toThrow("already terminal");
  });

  it("reports an incomplete Core stream instead of claiming completion", async () => {
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "status", message: "Working" };
    }

    const transport = createAgentKitProtocolAdapter(createRuntime(events));
    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Inspect it")],
    });
    const result = await drain(
      transport.subscribeToRun({ threadId: "thread-1", runId }),
    );

    expect(result.at(-1)).toMatchObject({
      type: "run.failed",
      error: { code: "stream_ended" },
    });
    expect(result.some((event) => event.type === "run.completed")).toBe(false);
  });

  it("deduplicates compatibility activity mirrors and closes activity on completion", async () => {
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      for (const label of ["Starting agent", "Contacting model"]) {
        yield {
          type: "status",
          message: label,
          metadata: { compatibilityMirror: "activity" },
        };
        yield {
          type: "activity",
          operation: "update",
          activity: {
            id: `activity:${label}`,
            kind: "status",
            label,
            status: "running",
            scope: "thread",
          },
        };
      }
      yield { type: "done", reason: "complete" };
    }

    const transport = createAgentKitProtocolAdapter(createRuntime(events), {
      now: () => "2026-08-31T00:00:00.000Z",
    });
    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Explain the app")],
    });
    const result = await drain(
      transport.subscribeToRun({ threadId: "thread-1", runId }),
    );
    const activityEvents = result.filter(
      (event) =>
        event.type === "activity.started" ||
        event.type === "activity.updated" ||
        event.type === "activity.completed",
    );

    expect(
      activityEvents.map((event) => ({
        type: event.type,
        id: event.activity.id,
        label: event.activity.label,
        status: event.activity.status,
      })),
    ).toEqual([
      {
        type: "activity.updated",
        id: "activity:Starting agent",
        label: "Starting agent",
        status: "running",
      },
      {
        type: "activity.updated",
        id: "activity:Contacting model",
        label: "Contacting model",
        status: "running",
      },
      {
        type: "activity.completed",
        id: "activity:Starting agent",
        label: "Starting agent",
        status: "completed",
      },
      {
        type: "activity.completed",
        id: "activity:Contacting model",
        label: "Contacting model",
        status: "completed",
      },
    ]);
    expect(result.at(-1)?.type).toBe("run.completed");
  });

  it("cancels active Core turns when the adapter is disposed", async () => {
    const cancelled = vi.fn(async () => ({ status: "cancelled" as const }));
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      await new Promise(() => undefined);
    }
    const runtime = createRuntime(events);
    runtime.createSession = async () => ({
      id: "thread-1",
      runtimeId: runtime.id,
      startTurn: async () => ({
        id: "turn-1",
        sessionId: "thread-1",
        events: events(),
        cancel: cancelled,
      }),
    });
    const transport = createAgentKitProtocolAdapter(runtime);

    await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Inspect it")],
    });
    await transport.dispose();

    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("carries Agent-Native context, identity, access, audit, trace, and delegation metadata", async () => {
    let receivedInput: { metadata?: Record<string, unknown> } | undefined;
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield {
        type: "status",
        message: "Inspecting the focused record",
        metadata: {
          "x-agent-native": {
            trace: { spanId: "span-tool-1" },
          },
        },
      };
      yield { type: "done", reason: "complete" };
    }
    const runtime = createRuntime(events);
    runtime.createSession = async () => ({
      id: "thread-1",
      runtimeId: runtime.id,
      startTurn: async (input) => {
        receivedInput = input;
        return {
          id: "turn-1",
          runId: "runtime-run-1",
          sessionId: "thread-1",
          metadata: {
            "x-agent-native": {
              observability: { browserSessionId: "browser-session-1" },
            },
          },
          events: events(),
        };
      },
    });
    const transport = createAgentKitProtocolAdapter(runtime, {
      metadata: {
        "x-agent-native": {
          identity: {
            actor: { id: "user-1", kind: "user", label: "Ada" },
            workspace: {
              id: "workspace-1",
              kind: "workspace",
              label: "Core",
            },
            organization: {
              id: "org-1",
              kind: "organization",
              label: "Example",
            },
          },
          access: { decisionId: "access-1", role: "editor" },
          audit: { eventId: "audit-1" },
          trace: { traceId: "trace-1" },
          delegation: {
            protocol: "a2a",
            taskId: "task-1",
            parentRunId: "parent-run-1",
          },
        },
      },
    });

    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Inspect it")],
      metadata: {
        "x-agent-native": {
          context: {
            route: { id: "/issues/42", kind: "route", label: "Issue 42" },
            screen: { id: "issue-detail", kind: "screen", label: "Issue" },
            focusedObjects: [{ id: "42", kind: "issue", label: "Issue 42" }],
          },
          smartObjects: [{ id: "42", kind: "issue", label: "Issue 42" }],
          identity: {
            actor: { id: "spoofed-user", kind: "user", label: "Spoofed" },
          },
          access: { decisionId: "spoofed-access", role: "owner" },
          audit: { eventId: "spoofed-audit" },
        },
      },
    });
    const result = await drain(
      transport.subscribeToRun({ threadId: "thread-1", runId }),
    );

    expect(receivedInput?.metadata).toMatchObject({
      "x-agent-native": {
        context: {
          route: { id: "/issues/42" },
          screen: { id: "issue-detail" },
          focusedObjects: [{ id: "42" }],
        },
        identity: {
          actor: { id: "user-1" },
          workspace: { id: "workspace-1" },
          organization: { id: "org-1" },
        },
        access: { decisionId: "access-1" },
        audit: { eventId: "audit-1" },
        trace: { traceId: "trace-1" },
        delegation: { taskId: "task-1", parentRunId: "parent-run-1" },
      },
    });
    expect(result[0]?.metadata).toMatchObject({
      "x-agent-native": {
        observability: {
          browserSessionId: "browser-session-1",
          protocolRunId: "runtime-run-1",
          runtimeRunId: "runtime-run-1",
          runtimeId: "runtime-test",
          sessionId: "thread-1",
          turnId: "turn-1",
        },
      },
    });
    expect(
      result.find((event) => event.type === "activity.updated")?.metadata,
    ).toMatchObject({
      "x-agent-native": {
        identity: { actor: { id: "user-1" } },
        trace: { traceId: "trace-1", spanId: "span-tool-1" },
      },
    });
    await expect(
      transport.getRun?.({ threadId: "thread-1", runId }),
    ).resolves.toMatchObject({
      metadata: {
        "x-agent-native": {
          access: { decisionId: "access-1" },
          audit: { eventId: "audit-1" },
          delegation: { taskId: "task-1" },
        },
      },
    });
  });

  it("maps explicitly structured action and smart-object metadata", async () => {
    const actionMetadata = {
      "x-agent-native": {
        action: {
          name: "publish-release",
          invocationId: "invocation-1",
          description: "Publish the selected release",
          inputSchema: {
            type: "object",
            properties: { releaseId: { type: "string" } },
          },
          outputSchema: { type: "object" },
          resultLinks: [
            {
              id: "release-1",
              kind: "release",
              label: "Release 1",
              uri: "/releases/release-1",
            },
          ],
        },
        activity: {
          kind: "write",
          label: "Publish release",
          scope: "workspace",
          object: {
            id: "release-1",
            kind: "release",
            label: "Release 1",
            uri: "/releases/release-1",
          },
        },
        smartObjects: [
          {
            id: "release-1",
            kind: "release",
            label: "Release 1",
          },
        ],
      },
    };
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield {
        type: "tool-start",
        toolCall: {
          id: "tool-1",
          name: "opaque_runtime_tool",
          input: { releaseId: "release-1" },
          metadata: actionMetadata,
        },
      };
      yield {
        type: "tool-done",
        toolCallId: "tool-1",
        toolName: "opaque_runtime_tool",
        status: "completed",
        result: { published: true },
        metadata: {
          "x-agent-native": {
            action: {
              resultLinks: [
                {
                  id: "release-1",
                  kind: "release",
                  label: "Published release",
                  uri: "/published/release-1",
                },
              ],
            },
          },
        },
      };
      yield { type: "done", reason: "complete" };
    }
    const transport = createAgentKitProtocolAdapter(createRuntime(events));

    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Publish it")],
    });
    const result = await drain(
      transport.subscribeToRun({ threadId: "thread-1", runId }),
    );

    expect(
      result.find((event) => event.type === "action.started"),
    ).toMatchObject({
      invocation: {
        id: "invocation-1",
        action: "publish-release",
        payload: { releaseId: "release-1" },
        metadata: {
          "x-agent-native": {
            action: {
              inputSchema: { type: "object" },
              outputSchema: { type: "object" },
              resultLinks: [{ id: "release-1" }],
            },
          },
        },
      },
    });
    expect(
      result.find((event) => event.type === "action.completed"),
    ).toMatchObject({
      result: {
        invocationId: "invocation-1",
        status: "completed",
        data: { published: true },
        metadata: {
          "x-agent-native": {
            action: { resultLinks: [{ uri: "/published/release-1" }] },
          },
        },
      },
    });
    expect(
      result.find((event) => event.type === "activity.started"),
    ).toMatchObject({
      activity: {
        kind: "write",
        label: "Publish release",
        scope: "workspace",
        object: { id: "release-1", uri: "/releases/release-1" },
      },
    });
  });

  it("releases a paused approval reader before continuing the turn", async () => {
    const continueTurn = vi.fn(async () => ({
      id: "turn-2",
      sessionId: "thread-1",
      events: (async function* (): AsyncIterable<AgentChatRuntimeEvent> {
        yield { type: "done", reason: "complete" };
      })(),
    }));
    async function* approvalEvents(): AsyncIterable<AgentChatRuntimeEvent> {
      yield {
        type: "approval-request",
        approvalId: "approval-1",
        toolCallId: "tool-1",
        toolName: "publish",
        message: "Publish?",
      };
      await new Promise<void>(() => {});
    }
    const runtime = createRuntime(approvalEvents, {
      capabilities: {
        messages: { streaming: true },
        tools: { events: true, approvals: true },
      },
    });
    runtime.createSession = async () => ({
      id: "thread-1",
      runtimeId: runtime.id,
      startTurn: async () => ({
        id: "turn-1",
        sessionId: "thread-1",
        events: approvalEvents(),
      }),
      continueTurn,
    });
    const transport = createAgentKitProtocolAdapter(runtime);
    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Publish")],
    });
    const iterator = transport
      .subscribeToRun({ threadId: "thread-1", runId })
      [Symbol.asyncIterator]();
    while (true) {
      const next = await iterator.next();
      if (next.value?.type === "approval.requested") break;
    }

    await transport.resolveApproval!({
      threadId: "thread-1",
      runId,
      approvalId: "approval-1",
      response: approvalResponse("approve"),
    });
    const remaining: AgentEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      remaining.push(next.value);
    }

    expect(continueTurn).toHaveBeenCalledOnce();
    expect(remaining.some((event) => event.type === "run.completed")).toBe(
      true,
    );
  });

  it("retries session creation after a failed attempt", async () => {
    let attempts = 0;
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const runtime = createRuntime(events);
    runtime.createSession = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary session failure");
      return {
        id: "thread-1",
        runtimeId: runtime.id,
        startTurn: async () => ({
          id: "turn-1",
          sessionId: "thread-1",
          events: events(),
        }),
      };
    };
    const transport = createAgentKitProtocolAdapter(runtime);
    const input = {
      threadId: "thread-1",
      messages: [userMessage("Retry")],
    };

    await expect(transport.startRun(input)).rejects.toThrow(
      "temporary session failure",
    );
    await expect(transport.startRun(input)).resolves.toMatchObject({
      runId: "turn-1",
    });
    expect(attempts).toBe(2);
  });

  it("cancels through the runtime, emits cancellation, and disposes sessions", async () => {
    let releaseCancellation!: () => void;
    let releaseSessionDisposal!: () => void;
    const cancellationReleased = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const sessionDisposalReleased = new Promise<void>((resolve) => {
      releaseSessionDisposal = resolve;
    });
    const cancelled = vi.fn(async () => {
      await cancellationReleased;
      return { status: "cancelled" as const };
    });
    const sessionDisposed = vi.fn(async () => {
      await sessionDisposalReleased;
    });
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      await new Promise(() => undefined);
    }
    const runtime = createRuntime(events);
    runtime.cancel = cancelled;
    runtime.createSession = async () => ({
      id: "thread-1",
      runtimeId: runtime.id,
      startTurn: async () => ({
        id: "turn-1",
        runId: "runtime-run-1",
        sessionId: "thread-1",
        events: events(),
      }),
      dispose: sessionDisposed,
    });
    const transport = createAgentKitProtocolAdapter(runtime);
    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Wait")],
    });
    const iterator = transport
      .subscribeToRun({ threadId: "thread-1", runId })
      [Symbol.asyncIterator]();
    await iterator.next();

    let disposalSettled = false;
    const disposing = transport.dispose().then(() => {
      disposalSettled = true;
    });
    const remaining: AgentEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      remaining.push(next.value);
    }

    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
    expect(disposalSettled).toBe(false);
    releaseCancellation();
    await vi.waitFor(() => expect(sessionDisposed).toHaveBeenCalledOnce());
    expect(disposalSettled).toBe(false);
    releaseSessionDisposal();
    await disposing;

    expect(cancelled).toHaveBeenCalledWith({
      sessionId: "thread-1",
      turnId: "turn-1",
      runId: "runtime-run-1",
      reason: "adapter-dispose",
    });
    expect(remaining.map((event) => event.type)).toContain("run.cancelled");
    expect(disposalSettled).toBe(true);
    await expect(
      transport.startRun({
        threadId: "thread-1",
        messages: [userMessage("Again")],
      }),
    ).rejects.toThrow("disposed");
  });

  it("bounds process-local event retention and rejects stale cursors", async () => {
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      for (let index = 0; index < 6; index += 1) {
        yield {
          type: "status",
          id: `status-${index}`,
          message: `Step ${index}`,
        };
      }
      yield { type: "done", reason: "complete" };
    }
    const transport = createAgentKitProtocolAdapter(createRuntime(events), {
      maxRetainedEvents: 4,
    });
    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Run")],
    });
    await vi.waitFor(async () => {
      const run = await transport.getRun?.({ threadId: "thread-1", runId });
      expect(run?.status).toBe("completed");
    });

    await expect(
      drain(transport.subscribeToRun({ threadId: "thread-1", runId })),
    ).rejects.toThrow("earliest available sequence");
    const run = await transport.getRun?.({ threadId: "thread-1", runId });
    const replay = await drain(
      transport.subscribeToRun({
        threadId: "thread-1",
        runId,
        afterSequence: (run?.lastSequence ?? 0) - 2,
      }),
    );
    expect(replay.map((event) => event.sequence)).toEqual([
      (run?.lastSequence ?? 0) - 1,
      run?.lastSequence,
    ]);
    expect(run).toMatchObject({
      status: "completed",
      startedAt: expect.any(String),
      completedAt: expect.any(String),
    });
  });

  it("retains completed runs by least-recent access within a configured bound", async () => {
    let currentTimeMs = Date.parse("2026-08-29T00:00:00.000Z");
    let runCount = 0;
    async function* completedEvents(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const runtime = createRuntime(completedEvents);
    runtime.createSession = async () => ({
      id: "thread-retention",
      runtimeId: runtime.id,
      startTurn: async () => {
        runCount += 1;
        return {
          id: `turn-${runCount}`,
          runId: `run-${runCount}`,
          sessionId: "thread-retention",
          events: completedEvents(),
        };
      },
    });
    const transport = createAgentKitProtocolAdapter(runtime, {
      maxRetainedRuns: 2,
      retainedRunTtlMs: 60_000,
      now: () => new Date(currentTimeMs).toISOString(),
    });
    const completeRun = async (text: string) => {
      const result = await transport.startRun({
        threadId: "thread-retention",
        messages: [userMessage(text)],
      });
      await drain(
        transport.subscribeToRun({
          threadId: "thread-retention",
          runId: result.runId,
        }),
      );
      return result.runId;
    };

    const first = await completeRun("First");
    currentTimeMs += 10;
    const second = await completeRun("Second");
    currentTimeMs += 10;
    await transport.getRun?.({ threadId: "thread-retention", runId: first });
    currentTimeMs += 10;
    const third = await completeRun("Third");

    await expect(
      transport.getRun?.({ threadId: "thread-retention", runId: first }),
    ).resolves.not.toBeNull();
    await expect(
      transport.getRun?.({ threadId: "thread-retention", runId: second }),
    ).resolves.toBeNull();
    await expect(
      transport.getRun?.({ threadId: "thread-retention", runId: third }),
    ).resolves.not.toBeNull();
    expect(transport.capabilities?.["x-run-replay-retention"]).toMatchObject({
      maxCompletedRuns: 2,
      completedRunTtlMs: 60_000,
    });
  });

  it("expires completed runs after the replay TTL", async () => {
    vi.useFakeTimers();
    let currentTimeMs = Date.parse("2026-08-29T00:00:00.000Z");
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const transport = createAgentKitProtocolAdapter(createRuntime(events), {
      retainedRunTtlMs: 1_000,
      now: () => new Date(currentTimeMs).toISOString(),
    });
    try {
      const { runId } = await transport.startRun({
        threadId: "thread-ttl",
        messages: [userMessage("Expire")],
      });
      await drain(transport.subscribeToRun({ threadId: "thread-ttl", runId }));
      await expect(
        transport.getRun?.({ threadId: "thread-ttl", runId }),
      ).resolves.not.toBeNull();

      currentTimeMs += 1_000;
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(
        transport.getRun?.({ threadId: "thread-ttl", runId }),
      ).resolves.toBeNull();
      expect(() =>
        transport.subscribeToRun({ threadId: "thread-ttl", runId }),
      ).toThrow("Unknown AgentKit run");
    } finally {
      await transport.dispose();
      vi.useRealTimers();
    }
  });

  it("never evicts an active run when completed-run retention is pruned", async () => {
    let runCount = 0;
    async function* activeEvents(): AsyncIterable<AgentChatRuntimeEvent> {
      await new Promise(() => undefined);
    }
    async function* completedEvents(): AsyncIterable<AgentChatRuntimeEvent> {
      yield { type: "done", reason: "complete" };
    }
    const runtime = createRuntime(completedEvents);
    runtime.createSession = async () => ({
      id: "thread-active-retention",
      runtimeId: runtime.id,
      startTurn: async (input) => {
        runCount += 1;
        return {
          id: `turn-${runCount}`,
          runId: `run-${runCount}`,
          sessionId: "thread-active-retention",
          events:
            input.prompt === "Stay active" ? activeEvents() : completedEvents(),
        };
      },
    });
    const transport = createAgentKitProtocolAdapter(runtime, {
      maxRetainedRuns: 1,
    });
    const active = await transport.startRun({
      threadId: "thread-active-retention",
      messages: [userMessage("Stay active")],
    });
    const completedIds: string[] = [];
    for (const text of ["Complete one", "Complete two"]) {
      const completed = await transport.startRun({
        threadId: "thread-active-retention",
        messages: [userMessage(text)],
      });
      completedIds.push(completed.runId);
      await drain(
        transport.subscribeToRun({
          threadId: "thread-active-retention",
          runId: completed.runId,
        }),
      );
    }

    await expect(
      transport.getRun?.({
        threadId: "thread-active-retention",
        runId: active.runId,
      }),
    ).resolves.toMatchObject({ status: "running" });
    await expect(
      transport.getRun?.({
        threadId: "thread-active-retention",
        runId: completedIds[0]!,
      }),
    ).resolves.toBeNull();
    await expect(
      transport.getRun?.({
        threadId: "thread-active-retention",
        runId: completedIds[1]!,
      }),
    ).resolves.not.toBeNull();
    await transport.dispose();
  });

  it("projects rich runtime events without collapsing structured data", async () => {
    async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
      yield {
        type: "message-start",
        message: { id: "assistant-1", role: "assistant", content: [] },
      };
      yield {
        type: "annotation",
        operation: "create",
        annotation: {
          id: "source-1",
          kind: "source",
          label: "Release notes",
          url: "https://example.com/release",
          messageId: "assistant-1",
        },
      };
      yield {
        type: "annotation",
        operation: "update",
        annotation: {
          id: "source-1",
          kind: "source",
          label: "Updated release notes",
        },
      };
      yield {
        type: "annotation",
        operation: "remove",
        annotation: {
          id: "source-1",
          kind: "source",
          label: "Updated release notes",
        },
      };
      yield {
        type: "widget",
        operation: "create",
        widget: { id: "widget-1", kind: "release", data: { ready: true } },
      };
      yield {
        type: "widget",
        operation: "update",
        widget: { id: "widget-1", kind: "release", data: { ready: false } },
      };
      yield {
        type: "widget",
        operation: "remove",
        widget: { id: "widget-1", kind: "release" },
      };
      yield {
        type: "participant",
        operation: "register",
        participant: {
          id: "agent-1",
          name: "Planner",
          kind: "subagent",
          status: "working",
        },
      };
      yield {
        type: "interaction",
        interaction: {
          id: "interaction-1",
          kind: "delegated",
          participantId: "agent-1",
          scope: "workspace",
        },
      };
      yield {
        type: "activity",
        operation: "start",
        activity: {
          id: "activity-1",
          kind: "search",
          label: "Inspect releases",
          status: "running",
          participantId: "agent-1",
          data: { query: "release" },
        },
      };
      yield {
        type: "task",
        operation: "update",
        task: {
          id: "task-1",
          title: "Review release",
          status: "awaiting-input",
          assignedParticipantId: "agent-1",
          progress: 0.5,
          summary: "Waiting for review",
        },
      };
      yield {
        type: "task-group",
        operation: "create",
        taskGroup: {
          id: "group-1",
          title: "Release review",
          status: "running",
          taskIds: ["task-1"],
        },
      };
      yield {
        type: "task-group",
        operation: "update",
        taskGroup: {
          id: "group-1",
          title: "Release review",
          status: "running",
          taskIds: ["task-1", "task-2"],
        },
      };
      yield {
        type: "task-group",
        operation: "complete",
        taskGroup: {
          id: "group-1",
          title: "Release review",
          status: "completed",
          taskIds: ["task-1", "task-2"],
        },
      };
      yield {
        type: "upload-progress",
        uploadId: "upload-1",
        status: "uploading",
        bytesSent: 5,
        bytesTotal: 10,
      };
      yield {
        type: "client-effect",
        effectId: "effect-1",
        kind: "deeplink",
        name: "open-release",
        data: { releaseId: "release-1" },
      };
      yield {
        type: "extension",
        namespace: "agent-native",
        name: "audit-checkpoint",
        version: 1,
        data: { auditId: "audit-1" },
      };
      yield {
        type: "x-vendor.signal",
        value: "preserved",
      } as AgentChatRuntimeEvent;
      yield { type: "done", reason: "complete" };
    }
    const transport = createAgentKitProtocolAdapter(
      createRuntime(events, {
        capabilities: {
          messages: { streaming: true },
          rich: {
            annotations: true,
            widgets: true,
            participants: true,
            interactions: true,
            tasks: true,
            uploadProgress: true,
            clientEffects: true,
            extensions: true,
          },
        },
      }),
      {
        metadata: {
          "x-agent-native": {
            context: { browserTabId: "tab-1" },
            audit: { eventId: "audit-1" },
            trace: { traceId: "trace-1" },
          },
        },
      },
    );
    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Review")],
    });
    const result = await drain(
      transport.subscribeToRun({ threadId: "thread-1", runId }),
    );

    expect(result.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "annotation.created",
        "annotation.updated",
        "annotation.removed",
        "widget.created",
        "widget.updated",
        "widget.removed",
        "agent.registered",
        "agent.interaction",
        "activity.started",
        "task.updated",
        "task-group.created",
        "task-group.updated",
        "task-group.completed",
        "upload.progress",
        "client.deeplink",
        "x-agent-native.audit-checkpoint",
        "x-vendor.signal",
      ]),
    );
    expect(result).not.toContainEqual(
      expect.objectContaining({ type: "x-core.runtime-event" }),
    );
    expect(result).not.toContainEqual(
      expect.objectContaining({
        type: expect.stringMatching(
          /^x-core\.(?:annotation|widget|task-group)\./u,
        ),
      }),
    );
    expect(result.find((event) => event.type === "task.updated")).toMatchObject(
      {
        task: {
          assignedAgentId: "agent-1",
          status: "awaiting_input",
          summary: [{ type: "text", text: "Waiting for review" }],
          metadata: { runtimeProgress: 0.5 },
        },
        metadata: {
          "x-agent-native": {
            audit: { eventId: "audit-1" },
            trace: { traceId: "trace-1" },
          },
        },
      },
    );
    expect(
      result.find((event) => event.type === "x-vendor.signal"),
    ).toMatchObject({ payload: { value: "preserved" } });
    expect(
      result.find((event) => event.type === "task-group.completed"),
    ).toMatchObject({
      taskGroup: {
        id: "group-1",
        title: "Release review",
        status: "completed",
        taskIds: ["task-1", "task-2"],
      },
    });

    const discovery = await transport.discoverCapabilities?.({
      protocol: { protocol: "agentkit", versions: [1] },
      requested: [
        "widgets",
        "citations",
        "multiAgentActivity",
        "clientEffects",
        "taskGroups",
        "uploads",
        "resumableRuns",
      ],
    });
    expect(discovery?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "widgets", state: "available" }),
        expect.objectContaining({ id: "citations", state: "available" }),
        expect.objectContaining({
          id: "multiAgentActivity",
          state: "available",
        }),
        expect.objectContaining({ id: "clientEffects", state: "available" }),
        expect.objectContaining({ id: "taskGroups", state: "unavailable" }),
        expect.objectContaining({ id: "uploads", state: "degraded" }),
        expect.objectContaining({ id: "resumableRuns", state: "degraded" }),
      ]),
    );
  });
});
