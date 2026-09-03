import type {
  AgentEvent,
  AgentMessage,
  AgentQueuedMessage,
  AgentTransport,
} from "@agent-native/agentkit-protocol";
import { AgentKitProtocolError } from "@agent-native/agentkit-protocol";
import { describe, expect, it, vi } from "vitest";

import { AgentKitCapabilityError, AgentKitClient } from "./client.js";

function protocolEvent(
  sequence: number,
  event: Omit<
    AgentEvent,
    "id" | "threadId" | "runId" | "sequence" | "occurredAt"
  >,
): AgentEvent {
  return {
    ...event,
    id: `event-${sequence}`,
    threadId: "thread-1",
    runId: "run-1",
    sequence,
    occurredAt: "2026-08-29T00:00:00.000Z",
  } as AgentEvent;
}

function createTransport(events: AgentEvent[]): AgentTransport {
  return {
    capabilities: { resumableRuns: true, messageQueue: true },
    async startRun() {
      return { runId: "run-1" };
    },
    async *subscribeToRun(input) {
      yield* events.filter(
        (event) => event.sequence > (input.afterSequence ?? 0),
      );
    },
    async cancelRun() {},
  };
}

describe("AgentKitClient", () => {
  it("keeps a missing durable thread as an empty new-chat projection", async () => {
    const getThreadSnapshot = vi.fn(async () => null);
    const getThread = vi.fn(async () => {
      throw new Error("split thread reads must not run");
    });
    const listQueuedMessages = vi.fn(async () => {
      throw new Error("queue reads must not run");
    });
    const transport = createTransport([]);
    transport.getThreadSnapshot = getThreadSnapshot;
    transport.getThread = getThread;
    transport.listQueuedMessages = listQueuedMessages;
    const client = new AgentKitClient({ transport });

    await expect(client.loadThread("new-thread")).resolves.toMatchObject({
      id: "new-thread",
      messages: [],
      queuedMessages: [],
    });

    expect(getThreadSnapshot).toHaveBeenCalledOnce();
    expect(getThread).not.toHaveBeenCalled();
    expect(listQueuedMessages).not.toHaveBeenCalled();
    expect(client.getSnapshot()).toMatchObject({
      connection: "connected",
      error: undefined,
    });
  });

  it("preserves both conversations across consecutive distinct runs", async () => {
    let runCount = 0;
    const transport: AgentTransport = {
      async startRun() {
        runCount += 1;
        return { runId: `run-${runCount}` };
      },
      async *subscribeToRun({ runId }) {
        const runNumber = Number(runId.split("-").at(-1));
        const event = (
          sequence: number,
          value: Omit<
            AgentEvent,
            "id" | "threadId" | "runId" | "sequence" | "occurredAt"
          >,
        ) =>
          ({
            ...value,
            id: `${runId}-event-${sequence}`,
            threadId: "thread-1",
            runId,
            sequence,
            occurredAt: "2026-08-29T00:00:00.000Z",
          }) as AgentEvent;
        yield event(1, { type: "run.started" });
        yield event(2, {
          type: "message.created",
          message: {
            id: `assistant-${runNumber}`,
            role: "assistant",
            status: "streaming",
            parts: [],
          },
        });
        yield event(3, {
          type: "message.delta",
          messageId: `assistant-${runNumber}`,
          text: `Response ${runNumber}`,
        });
        yield event(4, { type: "run.completed" });
      },
      async cancelRun() {},
    };
    let messageCount = 0;
    const client = new AgentKitClient({
      transport,
      createId: () => `user-${++messageCount}`,
      now: () => "2026-08-29T00:00:00.000Z",
    });

    const firstRun = await client.sendMessage({
      threadId: "thread-1",
      text: "First request",
    });
    await firstRun.completed;
    const secondRun = await client.sendMessage({
      threadId: "thread-1",
      text: "Second request",
    });
    await secondRun.completed;

    const thread = client.getThread("thread-1");
    expect(thread.messages).toMatchObject([
      { id: "user-1", role: "user", parts: [{ text: "First request" }] },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ text: "Response 1" }],
      },
      { id: "user-2", role: "user", parts: [{ text: "Second request" }] },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [{ text: "Response 2" }],
      },
    ]);
    expect(firstRun.runId).toBe("run-1");
    expect(secondRun.runId).toBe("run-2");
    expect(Object.keys(thread.runs)).toEqual(["run-1", "run-2"]);
    expect(new Set(thread.events.map((event) => event.runId))).toEqual(
      new Set(["run-1", "run-2"]),
    );
  });

  it("reconciles streamed message ids with the durable snapshot before message-scoped actions", async () => {
    const forkThread = vi.fn(async (input) => ({
      id: "thread-fork",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      messages: [],
      metadata: { fromMessageId: input.fromMessageId },
    }));
    const transport: AgentTransport = {
      capabilities: { threadForking: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {
        yield protocolEvent(1, { type: "run.started" });
        yield protocolEvent(2, {
          type: "message.created",
          message: {
            id: "assistant-transient",
            role: "assistant",
            status: "streaming",
            parts: [],
          },
        });
        yield protocolEvent(3, {
          type: "message.delta",
          messageId: "assistant-transient",
          text: "Durable ",
        });
        yield protocolEvent(4, {
          type: "message.delta",
          messageId: "assistant-transient",
          text: "response",
        });
        yield protocolEvent(5, {
          type: "activity.completed",
          activity: {
            id: "activity-1",
            kind: "tool",
            label: "Read release contract",
            status: "completed",
          },
        });
        yield protocolEvent(6, { type: "run.completed" });
      },
      async cancelRun() {},
      async getThreadSnapshot() {
        return {
          id: "thread-1",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:01.000Z",
          messages: [
            {
              id: "user-durable",
              role: "user",
              status: "complete",
              parts: [{ type: "text", text: "Review release" }],
            },
            {
              id: "assistant-durable",
              role: "assistant",
              status: "complete",
              parts: [
                {
                  type: "data",
                  data: { tool: "release-review" },
                  mediaType: "application/json",
                },
                { type: "text", text: "Durable response" },
              ],
            },
          ],
        };
      },
      forkThread,
    };
    const client = new AgentKitClient({
      transport,
      createId: () => "user-transient",
      now: () => "2026-08-29T00:00:00.000Z",
    });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Review release",
    });
    await run.completed;

    expect(
      client.getThread("thread-1").messages.map((message) => message.id),
    ).toEqual(["user-durable", "assistant-durable"]);
    expect(client.getThread("thread-1").activities["activity-1"]).toMatchObject(
      { label: "Read release contract", status: "completed" },
    );
    expect(
      client
        .getThread("thread-1")
        .events.filter(
          (event) =>
            event.type === "message.created" || event.type === "message.delta",
        )
        .map((event) =>
          event.type === "message.created" ? event.message.id : event.messageId,
        ),
    ).toEqual(["assistant-durable", "assistant-durable", "assistant-durable"]);

    await client.forkThread("thread-1", "assistant-durable");
    expect(forkThread).toHaveBeenCalledWith(
      { threadId: "thread-1", fromMessageId: "assistant-durable" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not reuse an already-matched durable id for identical content", async () => {
    let snapshotReads = 0;
    const durableMessage = (id: string): AgentMessage => ({
      id,
      role: "user",
      status: "complete",
      parts: [{ type: "text", text: "Same request" }],
    });
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-2" };
      },
      async *subscribeToRun() {
        yield {
          ...protocolEvent(1, { type: "run.started" }),
          runId: "run-2",
        };
        yield {
          ...protocolEvent(2, { type: "run.completed" }),
          runId: "run-2",
        };
      },
      async cancelRun() {},
      async getThreadSnapshot() {
        snapshotReads += 1;
        return {
          id: "thread-1",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:01.000Z",
          messages:
            snapshotReads === 1
              ? [durableMessage("D1")]
              : [durableMessage("D1"), durableMessage("D2")],
        };
      },
    };
    const client = new AgentKitClient({
      transport,
      createId: () => "O2",
      now: () => "2026-08-29T00:00:00.000Z",
    });

    await client.loadThread("thread-1");
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Same request",
    });
    await run.completed;

    expect(client.getThread("thread-1").messages).toEqual([
      durableMessage("D1"),
      durableMessage("D2"),
    ]);
  });

  it("adds a requested approval and removes it when resolved", async () => {
    let releaseResolution: (() => void) | undefined;
    let markRequested: (() => void) | undefined;
    const resolutionPending = new Promise<void>((resolve) => {
      releaseResolution = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      markRequested = resolve;
    });
    const transport = createTransport([]);
    transport.subscribeToRun = async function* () {
      yield protocolEvent(1, { type: "run.started" });
      yield protocolEvent(2, {
        type: "approval.requested",
        request: {
          id: "approval-1",
          title: "Publish the dashboard?",
          description: "This makes the workspace visible to everyone.",
        },
      });
      markRequested?.();
      await resolutionPending;
      yield protocolEvent(3, {
        type: "approval.resolved",
        approvalId: "approval-1",
        response: { decision: "approve", optionIds: ["approve"] },
      });
      yield protocolEvent(4, { type: "run.completed" });
    };
    const client = new AgentKitClient({ transport });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Publish it",
    });
    await requested;

    expect(client.getThread("thread-1").approvals["approval-1"]).toMatchObject({
      title: "Publish the dashboard?",
    });
    expect(client.getThread("thread-1").approvalRunIds["approval-1"]).toBe(
      "run-1",
    );

    releaseResolution?.();
    await run.completed;

    expect(client.getThread("thread-1").approvals).toEqual({});
    expect(client.getThread("thread-1").approvalRunIds).toEqual({});
    expect(
      client
        .getThread("thread-1")
        .events.map((event) => event.type)
        .filter((type) => type.startsWith("approval.")),
    ).toEqual(["approval.requested", "approval.resolved"]);
  });

  it("reduces streamed events into one immutable thread snapshot", async () => {
    const transport = createTransport([
      protocolEvent(1, { type: "run.started" }),
      protocolEvent(2, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: [],
        },
      }),
      protocolEvent(3, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "Workspace ",
      }),
      protocolEvent(4, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "reviewed.",
      }),
      protocolEvent(5, {
        type: "suggestions.updated",
        suggestions: [{ id: "next", label: "Run checks" }],
      }),
      protocolEvent(6, { type: "run.completed" }),
    ]);
    const client = new AgentKitClient({
      transport,
      createId: () => "user-1",
      now: () => "2026-08-29T00:00:00.000Z",
    });
    const listener = vi.fn();
    client.subscribe(listener);

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Review the workspace",
    });
    await run.completed;

    const thread = client.getThread("thread-1");
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]?.parts).toEqual([
      { type: "text", text: "Workspace reviewed." },
    ]);
    expect(thread.suggestions).toEqual([{ id: "next", label: "Run checks" }]);
    expect(thread.runs["run-1"]).toMatchObject({
      status: "completed",
      lastSequence: 6,
    });
    expect(listener).toHaveBeenCalled();
  });

  it("resumes from the last accepted sequence after a dropped stream", async () => {
    let subscriptions = 0;
    const transport = createTransport([]);
    transport.subscribeToRun = async function* (input) {
      subscriptions += 1;
      if (subscriptions === 1) {
        yield protocolEvent(1, { type: "run.started" });
        throw new Error("connection dropped");
      }
      expect(input.afterSequence).toBe(1);
      yield protocolEvent(2, { type: "run.completed" });
    };
    const client = new AgentKitClient({
      transport,
      reconnect: { attempts: 1, delayMs: () => 0 },
    });

    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await run.completed;

    expect(subscriptions).toBe(2);
    expect(client.getThread("thread-1").runs["run-1"]?.lastSequence).toBe(2);
  });

  it("rejects a sequence gap before advancing the durable resume cursor", async () => {
    const subscribeToRun = vi.fn(async function* () {
      yield protocolEvent(1, { type: "run.started" });
      yield protocolEvent(3, { type: "run.completed" });
    });
    const transport = createTransport([]);
    transport.subscribeToRun = subscribeToRun;
    const client = new AgentKitClient({
      transport,
      reconnect: { attempts: 3, delayMs: () => 0 },
    });

    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });

    await expect(run.completed).rejects.toThrow(
      "expected 2 after 1, received 3",
    );
    expect(subscribeToRun).toHaveBeenCalledOnce();
    expect(client.getThread("thread-1").runs["run-1"]?.lastSequence).toBe(1);
    expect(
      client.getThread("thread-1").events.map((item) => item.sequence),
    ).toEqual([1]);
  });

  it("rejects a stream that closes without an explicit terminal event", async () => {
    const client = new AgentKitClient({
      transport: createTransport([protocolEvent(1, { type: "run.started" })]),
      reconnect: { attempts: 0 },
    });

    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });

    await expect(run.completed).rejects.toThrow(
      "ended without a terminal event",
    );
    expect(client.getSnapshot().connection).toBe("error");
  });

  it("preserves tasks, tool deltas, action results, and upload progress", async () => {
    const client = new AgentKitClient({
      transport: createTransport([
        protocolEvent(1, { type: "run.started" }),
        protocolEvent(2, {
          type: "task.created",
          task: {
            id: "task-1",
            title: "Verify dashboard",
            status: "running",
          },
        }),
        protocolEvent(3, {
          type: "tool.started",
          toolCall: {
            id: "tool-1",
            name: "Run checks",
            status: "running",
          },
        }),
        protocolEvent(4, {
          type: "tool.delta",
          toolCallId: "tool-1",
          outputTextDelta: "12 ",
        }),
        protocolEvent(5, {
          type: "tool.delta",
          toolCallId: "tool-1",
          outputTextDelta: "passed",
        }),
        protocolEvent(6, {
          type: "action.started",
          invocation: {
            id: "action-1",
            action: "dashboard.publish",
            threadId: "thread-1",
          },
        }),
        protocolEvent(7, {
          type: "action.completed",
          result: {
            invocationId: "action-1",
            status: "completed",
          },
        }),
        protocolEvent(8, {
          type: "upload.progress",
          progress: { uploadId: "upload-1", loaded: 5, total: 10 },
        }),
        protocolEvent(9, {
          type: "task.completed",
          task: {
            id: "task-1",
            title: "Verify dashboard",
            status: "completed",
          },
        }),
        protocolEvent(10, { type: "run.completed" }),
      ]),
    });

    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await run.completed;

    const thread = client.getThread("thread-1");
    expect(thread.tasks["task-1"]?.status).toBe("completed");
    expect(thread.tools["tool-1"]?.output).toBe("12 passed");
    expect(thread.actions["action-1"]?.result?.status).toBe("completed");
    expect(thread.uploads["upload-1"]).toEqual({
      uploadId: "upload-1",
      loaded: 5,
      total: 10,
    });
  });

  it("preserves agent identity, append-only interactions, and off-surface work", async () => {
    const client = new AgentKitClient({
      transport: createTransport([
        protocolEvent(1, { type: "run.started" }),
        protocolEvent(2, {
          type: "agent.registered",
          agent: {
            id: "agent-planck",
            name: "Planck",
            kind: "subagent",
            status: "working",
            origin: {
              id: "app-dispatch",
              kind: "app",
              label: "Dispatch",
            },
          },
        }),
        protocolEvent(3, {
          type: "agent.interaction",
          interaction: {
            id: "interaction-1",
            kind: "started",
            agentId: "agent-planck",
            scope: "workspace",
          },
        }),
        protocolEvent(4, {
          type: "activity.started",
          activity: {
            id: "activity-1",
            kind: "read",
            label: "Read release files",
            status: "running",
            agentId: "agent-planck",
            scope: "external",
            source: {
              id: "app-agent-native",
              kind: "app",
              label: "Agent-Native",
            },
          },
        }),
        protocolEvent(5, {
          type: "agent.updated",
          agent: {
            id: "agent-planck",
            name: "Planck",
            kind: "subagent",
            status: "completed",
          },
        }),
        protocolEvent(6, {
          type: "agent.interaction",
          interaction: {
            id: "interaction-2",
            kind: "completed",
            agentId: "agent-planck",
            detail: "Release review complete",
          },
        }),
        protocolEvent(7, {
          type: "agent.interaction",
          interaction: {
            id: "interaction-1",
            kind: "started",
            agentId: "agent-planck",
            detail: "A later duplicate must not rewrite history",
          },
        }),
        protocolEvent(8, { type: "run.completed" }),
      ]),
    });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Review the release",
    });
    await run.completed;

    const thread = client.getThread("thread-1");
    expect(thread.agents["agent-planck"]).toMatchObject({
      name: "Planck",
      status: "completed",
    });
    expect(thread.agentInteractions).toEqual([
      expect.objectContaining({ id: "interaction-1", kind: "started" }),
      expect.objectContaining({ id: "interaction-2", kind: "completed" }),
    ]);
    expect(thread.agentInteractions[0]?.detail).toBeUndefined();
    expect(thread.activities["activity-1"]).toMatchObject({
      agentId: "agent-planck",
      scope: "external",
      source: { label: "Agent-Native" },
    });
  });

  it("rolls an optimistic queue removal back when persistence fails", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Follow up",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: queued.createdAt,
      updatedAt: queued.createdAt,
      messages: [],
      queuedMessages: [queued],
    });
    transport.removeQueuedMessage = async () => {
      throw new Error("write failed");
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    await expect(
      client.removeQueuedMessage("thread-1", "queued-1"),
    ).rejects.toThrow("write failed");
    expect(client.getThread("thread-1").queuedMessages).toEqual([queued]);
  });

  it("promotes a queued message into a subscribed run", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Continue with the release",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: queued.createdAt,
      updatedAt: queued.createdAt,
      messages: [],
      queuedMessages: [queued],
    });
    transport.steerQueuedMessage = async () => ({ runId: "run-1" });
    transport.subscribeToRun = async function* () {
      yield protocolEvent(1, { type: "run.started" });
      yield protocolEvent(2, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: [],
        },
      });
      yield protocolEvent(3, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "Release continued.",
      });
      yield protocolEvent(4, { type: "run.completed" });
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    const run = await client.steerQueuedMessage("thread-1", "queued-1");
    await run?.completed;

    expect(client.getThread("thread-1")).toMatchObject({
      queuedMessages: [],
      messages: [
        { id: "queued-1", role: "user" },
        { id: "assistant-1", role: "assistant" },
      ],
    });
  });

  it("rolls rejected steering back without reporting a connection outage", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Continue with the release",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: queued.createdAt,
      updatedAt: queued.createdAt,
      messages: [],
      queuedMessages: [queued],
    });
    transport.steerQueuedMessage = async () => {
      throw new Error("Steering rejected");
    };
    const onError = vi.fn();
    const client = new AgentKitClient({ transport, onError });
    await client.loadThread("thread-1");

    await expect(
      client.steerQueuedMessage("thread-1", "queued-1"),
    ).rejects.toThrow("Steering rejected");

    expect(client.getThread("thread-1")).toMatchObject({
      queuedMessages: [queued],
      messages: [],
    });
    expect(client.getSnapshot()).toMatchObject({
      connection: "connected",
      error: undefined,
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "queue_steer_failed",
        message: "Steering rejected",
      }),
    );
  });

  it("promotes the next queued message after a run completes", async () => {
    let runCount = 0;
    const promoted = vi.fn(async () => ({ runId: "run-2" }));
    const transport: AgentTransport = {
      capabilities: { messageQueue: true },
      async startRun() {
        runCount += 1;
        return { runId: `run-${runCount}` };
      },
      steerQueuedMessage: promoted,
      async queueMessage(input) {
        return {
          message: {
            id: "queued-1",
            threadId: input.threadId,
            text: input.text,
            createdAt: "2026-08-29T00:00:00.000Z",
          },
        };
      },
      async *subscribeToRun({ runId }) {
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        yield { ...protocolEvent(2, { type: "run.completed" }), runId };
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    await client.queueMessage({
      threadId: "thread-1",
      text: "Run after approval",
    });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Start release review",
    });
    await run.completed;
    await vi.waitFor(() => expect(promoted).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").runs["run-2"]?.status).toBe(
        "completed",
      ),
    );

    expect(promoted).toHaveBeenCalledWith(
      {
        threadId: "thread-1",
        messageId: "queued-1",
      },
      expect.objectContaining({
        correlationId: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(client.getThread("thread-1").queuedMessages).toEqual([]);
  });

  it("discovers capabilities before the first run starts", async () => {
    const calls: string[] = [];
    const transport: AgentTransport = {
      async getCapabilities() {
        calls.push("capabilities");
        return { approvals: true, widgets: true, resumableRuns: false };
      },
      async startRun() {
        calls.push("start");
        return { runId: "run-1" };
      },
      async *subscribeToRun() {
        yield protocolEvent(1, { type: "run.started" });
        yield protocolEvent(2, { type: "run.completed" });
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Review it",
    });
    await run.completed;

    expect(calls).toEqual(["capabilities", "start"]);
    expect(client.getSnapshot()).toMatchObject({
      capabilitiesStatus: "ready",
      capabilities: { approvals: true, widgets: true, resumableRuns: false },
    });
  });

  it("rejects an aborted request before invoking the transport", async () => {
    const startRun = vi.fn(async () => ({ runId: "run-1" }));
    const transport: AgentTransport = {
      capabilities: {},
      startRun,
      async *subscribeToRun() {},
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const controller = new AbortController();
    controller.abort("caller left");

    const failure = await client
      .sendMessage(
        { threadId: "thread-1", text: "Do not send" },
        { signal: controller.signal, correlationId: "request-preflight" },
      )
      .catch((error) => error);

    expect(startRun).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(AgentKitProtocolError);
    expect(failure).toMatchObject({
      code: "request_aborted",
      retryable: false,
      correlationId: "request-preflight",
    });
  });

  it("propagates correlation and aborts an in-flight transport operation", async () => {
    const invoked = Promise.withResolvers<void>();
    let preflightCorrelationId: string | undefined;
    let observedSignal: AbortSignal | undefined;
    let observedCorrelationId: string | undefined;
    const transport: AgentTransport = {
      async getCapabilities(context) {
        preflightCorrelationId = context?.correlationId;
        return {};
      },
      async startRun(_input, context) {
        observedSignal = context?.signal;
        observedCorrelationId = context?.correlationId;
        invoked.resolve();
        return await new Promise((_resolve, reject) => {
          context?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
      async *subscribeToRun() {},
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const controller = new AbortController();
    const operation = client.sendMessage(
      { threadId: "thread-1", text: "Wait for cancellation" },
      { signal: controller.signal, correlationId: "request-in-flight" },
    );
    await invoked.promise;

    controller.abort("caller left");
    const failure = await operation.catch((error) => error);

    expect(preflightCorrelationId).toBe("request-in-flight");
    expect(observedCorrelationId).toBe("request-in-flight");
    expect(observedSignal?.aborted).toBe(true);
    expect(failure).toBeInstanceOf(AgentKitProtocolError);
    expect(failure).toMatchObject({
      code: "request_aborted",
      retryable: false,
      correlationId: "request-in-flight",
    });
  });

  it("hydrates rich thread state and resumes every active run", async () => {
    const subscriptions: string[] = [];
    const transport: AgentTransport = {
      capabilities: { resumableRuns: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async getThreadSnapshot() {
        return {
          id: "thread-1",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          messages: [],
          activeRunIds: ["run-1", "run-2"],
          runs: [
            {
              id: "run-1",
              threadId: "thread-1",
              status: "running" as const,
              lastSequence: 2,
            },
            {
              id: "run-2",
              threadId: "thread-1",
              status: "awaiting_approval" as const,
              lastSequence: 1,
            },
          ],
          events: [
            protocolEvent(1, { type: "run.started" }),
            protocolEvent(2, {
              type: "activity.started",
              activity: {
                id: "activity-1",
                kind: "search",
                label: "Inspect workspace",
                status: "running",
              },
            }),
          ],
        };
      },
      async *subscribeToRun({ runId, afterSequence }) {
        subscriptions.push(`${runId}:${afterSequence}`);
        yield {
          ...protocolEvent((afterSequence ?? 0) + 1, {
            type: "run.completed",
          }),
          runId,
        };
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });

    const thread = await client.loadThread("thread-1");
    await vi.waitFor(() => expect(subscriptions).toHaveLength(2));

    expect(thread.activities["activity-1"]).toMatchObject({
      label: "Inspect workspace",
    });
    expect(thread.activeRunIds).toEqual(["run-1", "run-2"]);
    expect(new Set(subscriptions)).toEqual(new Set(["run-1:2", "run-2:1"]));
  });

  it("aborts active stream consumers when disposed", async () => {
    let observedSignal: AbortSignal | undefined;
    const subscribed = Promise.withResolvers<void>();
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun({ signal }) {
        observedSignal = signal;
        subscribed.resolve();
        yield protocolEvent(1, { type: "run.started" });
        await new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await subscribed.promise;

    await client.dispose();
    await expect(run.completed).resolves.toBeUndefined();

    expect(observedSignal?.aborted).toBe(true);
    expect(client.getSnapshot().connection).toBe("offline");
    await expect(
      client.sendMessage({ threadId: "thread-1", text: "Again" }),
    ).rejects.toThrow("disposed");
  });

  it("borrows transports by default across StrictMode-style remounts", async () => {
    const dispose = vi.fn();
    const transport = { ...createTransport([]), dispose };

    const firstMount = new AgentKitClient({ transport });
    await firstMount.dispose();
    await firstMount.dispose();
    const secondMount = new AgentKitClient({ transport });
    await secondMount.dispose();

    expect(dispose).not.toHaveBeenCalled();
  });

  it("awaits disposal of an owned transport exactly once", async () => {
    const released = Promise.withResolvers<void>();
    const dispose = vi.fn(async () => released.promise);
    const client = new AgentKitClient({
      transport: { ...createTransport([]), dispose },
      transportOwnership: "owned",
    });

    const first = client.shutdown();
    const second = client.dispose();

    expect(dispose).toHaveBeenCalledOnce();
    expect(second).toBe(first);

    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    released.resolve();
    await first;
    expect(settled).toBe(true);
  });

  it("keeps a failed optimistic message visible and marked as an error", async () => {
    const transport = createTransport([]);
    transport.startRun = async () => {
      throw new Error("The agent service is unavailable.");
    };
    const client = new AgentKitClient({
      transport,
      createId: () => "message-failed",
    });

    await expect(
      client.sendMessage({ threadId: "thread-1", text: "Keep my draft" }),
    ).rejects.toThrow("unavailable");

    expect(client.getThread("thread-1").messages).toEqual([
      expect.objectContaining({ id: "message-failed", status: "error" }),
    ]);
    expect(client.getSnapshot().error).toMatchObject({
      code: "run_start_failed",
      retryable: true,
    });
  });

  it("does not mark an accepted user message failed when only its subscription fails", async () => {
    const transport = createTransport([]);
    transport.subscribeToRun = async function* () {
      throw new Error("stream unavailable");
    };
    const client = new AgentKitClient({
      transport,
      createId: () => "message-accepted",
      reconnect: { attempts: 0 },
    });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Accepted by the server",
    });
    await expect(run.completed).rejects.toThrow("stream unavailable");

    expect(client.getThread("thread-1").messages).toEqual([
      expect.objectContaining({ id: "message-accepted", status: "complete" }),
    ]);
    expect(client.getSnapshot().error).toMatchObject({
      code: "run_stream_failed",
      retryable: true,
    });
  });

  it("deduplicates leased thread loads and stops hydration streams after the last release", async () => {
    const snapshotRequested = vi.fn();
    const subscribed = Promise.withResolvers<void>();
    let observedSignal: AbortSignal | undefined;
    const transport: AgentTransport = {
      capabilities: { resumableRuns: true, durableThreadSnapshots: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async getThreadSnapshot() {
        snapshotRequested();
        return {
          id: "thread-1",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          messages: [],
          runs: [
            {
              id: "run-1",
              threadId: "thread-1",
              status: "running",
              lastSequence: 0,
            },
          ],
          activeRunIds: ["run-1"],
        };
      },
      async *subscribeToRun({ signal }) {
        observedSignal = signal;
        subscribed.resolve();
        await new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });

    const [first, second] = await Promise.all([
      client.openThread("thread-1"),
      client.openThread("thread-1"),
    ]);
    await subscribed.promise;

    expect(snapshotRequested).toHaveBeenCalledOnce();
    first.release();
    expect(observedSignal?.aborted).toBe(false);
    second.dispose();
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
  });

  it("retains active runs across thread release when the host owns background work", async () => {
    const subscribed = Promise.withResolvers<void>();
    let observedSignal: AbortSignal | undefined;
    const transport: AgentTransport = {
      capabilities: { resumableRuns: true, durableThreadSnapshots: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async getThreadSnapshot() {
        return {
          id: "thread-1",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          messages: [],
          runs: [
            {
              id: "run-1",
              threadId: "thread-1",
              status: "running",
              lastSequence: 0,
            },
          ],
          activeRunIds: ["run-1"],
        };
      },
      async *subscribeToRun({ signal }) {
        observedSignal = signal;
        subscribed.resolve();
        await new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({
      transport,
      retainActiveRunsOnThreadRelease: true,
    });

    const lease = await client.openThread("thread-1");
    await subscribed.promise;
    lease.release();

    expect(observedSignal?.aborted).toBe(false);
    await client.dispose();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("aborts a reconnect wait after authoritative cancellation", async () => {
    const cancelRun = vi.fn(async () => undefined);
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {
        throw new Error("connection dropped");
      },
      cancelRun,
    };
    const client = new AgentKitClient({
      transport,
      reconnect: { attempts: 3, delayMs: () => 60_000 },
    });
    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await vi.waitFor(() =>
      expect(client.getSnapshot().connection).toBe("reconnecting"),
    );

    await run.cancel();
    await expect(run.completed).resolves.toBeUndefined();

    expect(cancelRun).toHaveBeenCalledWith(
      {
        threadId: "thread-1",
        runId: "run-1",
      },
      expect.objectContaining({
        correlationId: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
      "cancelled",
    );
  });

  it("isolates consumers by thread when providers reuse a run id", async () => {
    const subscriptions: string[] = [];
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "shared-run" };
      },
      async *subscribeToRun({ threadId, runId }) {
        subscriptions.push(`${threadId}:${runId}`);
        yield {
          ...protocolEvent(1, { type: "run.started" }),
          id: `${threadId}-started`,
          threadId,
          runId,
        };
        yield {
          ...protocolEvent(2, { type: "run.completed" }),
          id: `${threadId}-completed`,
          threadId,
          runId,
        };
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });

    const [first, second] = await Promise.all([
      client.sendMessage({ threadId: "thread-a", text: "A" }),
      client.sendMessage({ threadId: "thread-b", text: "B" }),
    ]);
    await Promise.all([first.completed, second.completed]);

    expect(new Set(subscriptions)).toEqual(
      new Set(["thread-a:shared-run", "thread-b:shared-run"]),
    );
    expect(client.getThread("thread-a").runs["shared-run"]?.status).toBe(
      "completed",
    );
    expect(client.getThread("thread-b").runs["shared-run"]?.status).toBe(
      "completed",
    );
  });

  it("publishes a started run before the stream produces its first event", async () => {
    const releaseStream = Promise.withResolvers<void>();
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-starting" };
      },
      async *subscribeToRun({ threadId, runId }) {
        await releaseStream.promise;
        yield { ...protocolEvent(1, { type: "run.started" }), threadId, runId };
        yield {
          ...protocolEvent(2, { type: "run.completed" }),
          threadId,
          runId,
        };
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Start once",
    });

    expect(client.getThread("thread-1").activeRunIds).toEqual(["run-starting"]);
    expect(client.getThread("thread-1").runs["run-starting"]?.status).toBe(
      "running",
    );

    releaseStream.resolve();
    await run.completed;
    expect(client.getThread("thread-1").activeRunIds).toEqual([]);
  });

  it("publishes a promoted queued run before its stream produces an event", async () => {
    const releaseStream = Promise.withResolvers<void>();
    const transport: AgentTransport = {
      capabilities: { messageQueue: true },
      async startRun() {
        return { runId: "unused" };
      },
      async *subscribeToRun({ threadId, runId }) {
        await releaseStream.promise;
        yield { ...protocolEvent(1, { type: "run.started" }), threadId, runId };
        yield {
          ...protocolEvent(2, { type: "run.completed" }),
          threadId,
          runId,
        };
      },
      async cancelRun() {},
      async queueMessage(input) {
        return {
          message: {
            id: "queued-starting",
            threadId: input.threadId,
            text: input.text,
            createdAt: "2026-08-31T00:00:00.000Z",
          },
        };
      },
      async steerQueuedMessage() {
        return { runId: "run-promoted" };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.queueMessage({ threadId: "thread-1", text: "Run next" });

    const run = await client.steerQueuedMessage("thread-1", "queued-starting");

    expect(client.getThread("thread-1").activeRunIds).toEqual(["run-promoted"]);
    expect(client.getThread("thread-1").runs["run-promoted"]?.status).toBe(
      "running",
    );

    releaseStream.resolve();
    await run?.completed;
    expect(client.getThread("thread-1").activeRunIds).toEqual([]);
  });

  it("does not promote queued work while a parallel run is still active", async () => {
    let runCount = 0;
    const terminals = new Map<
      string,
      ReturnType<typeof Promise.withResolvers<void>>
    >();
    const steerQueuedMessage = vi.fn(async () => undefined);
    const transport: AgentTransport = {
      capabilities: { messageQueue: true },
      async startRun() {
        runCount += 1;
        return { runId: `run-${runCount}` };
      },
      async *subscribeToRun({ runId }) {
        const terminal = Promise.withResolvers<void>();
        terminals.set(runId, terminal);
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        await terminal.promise;
        yield { ...protocolEvent(2, { type: "run.completed" }), runId };
      },
      async cancelRun() {},
      async queueMessage(input) {
        return {
          message: {
            id: "queued-1",
            threadId: input.threadId,
            text: input.text,
            createdAt: "2026-08-29T00:00:00.000Z",
          },
        };
      },
      steerQueuedMessage,
    };
    const client = new AgentKitClient({ transport });
    await client.queueMessage({ threadId: "thread-1", text: "Run later" });
    const first = await client.sendMessage({ threadId: "thread-1", text: "A" });
    const second = await client.sendMessage({
      threadId: "thread-1",
      text: "B",
    });
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").activeRunIds).toHaveLength(2),
    );

    terminals.get("run-1")?.resolve();
    await first.completed;
    expect(steerQueuedMessage).not.toHaveBeenCalled();

    terminals.get("run-2")?.resolve();
    await second.completed;
    await vi.waitFor(() => expect(steerQueuedMessage).toHaveBeenCalledOnce());
  });

  it("merges a stale load without discarding newer optimistic and run state", async () => {
    const snapshot =
      Promise.withResolvers<
        Awaited<ReturnType<NonNullable<AgentTransport["getThreadSnapshot"]>>>
      >();
    const transport: AgentTransport = {
      async getThreadSnapshot() {
        return snapshot.promise;
      },
      async startRun() {
        return { runId: "run-live" };
      },
      async *subscribeToRun({ runId }) {
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        yield { ...protocolEvent(2, { type: "run.completed" }), runId };
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({
      transport,
      createId: () => "message-live",
    });
    const loading = client.loadThread("thread-1");
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Do not lose this",
    });
    await run.completed;
    snapshot.resolve({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      messages: [
        {
          id: "message-persisted",
          role: "assistant",
          parts: [{ type: "text", text: "Earlier context" }],
        },
      ],
    });
    await loading;

    expect(
      client.getThread("thread-1").messages.map((message) => message.id),
    ).toEqual(["message-persisted", "message-live"]);
    expect(client.getThread("thread-1").runs["run-live"]?.status).toBe(
      "completed",
    );
  });

  it("fails negotiated unsupported mutations before calling the transport", async () => {
    const queueMessage = vi.fn();
    const client = new AgentKitClient({
      transport: {
        capabilities: { messageQueue: false },
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
        queueMessage,
      },
    });

    const failure = await client
      .queueMessage({ threadId: "thread-1", text: "Later" })
      .catch((error) => error);

    expect(failure).toBeInstanceOf(AgentKitCapabilityError);
    expect(failure).toMatchObject({
      code: "capability_unsupported",
      capability: "messageQueue",
      retryable: false,
    });
    expect(queueMessage).not.toHaveBeenCalled();
  });

  it("classifies permanent start failures as non-retryable", async () => {
    const transport = createTransport([]);
    transport.startRun = async () => {
      throw Object.assign(new Error("The request is invalid."), {
        status: 400,
        code: "invalid_request",
      });
    };
    const client = new AgentKitClient({ transport });

    await expect(
      client.sendMessage({ threadId: "thread-1", text: "Invalid" }),
    ).rejects.toThrow("invalid");
    expect(client.getSnapshot().error).toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
  });
});
