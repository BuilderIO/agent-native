import { describe, expect, it, vi } from "vitest";

import type {
  AgentEvent,
  AgentMessage,
  AgentQueuedMessage,
  AgentThreadSnapshot,
  AgentTransport,
} from "../protocol/index.js";
import type { AgentStreamIntegrityReport } from "../protocol/index.js";
import {
  AgentProtocolValidationError,
  AgentKitProtocolError,
  createAgentKitProtocolVersionOffer,
  createCapabilityUnsupportedError,
  negotiateAgentKitProtocolVersion,
} from "../protocol/index.js";
import {
  AgentKitCapabilityError,
  AgentKitClient,
  AgentKitRunSlotBusyError,
} from "./client.js";

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
  it.each(["accepted", "rejected"])(
    "acknowledges the recoverable local message before a %s startRun settles",
    async (outcome) => {
      const started = Promise.withResolvers<{ runId: string }>();
      const startRun = vi.fn<AgentTransport["startRun"]>(() => started.promise);
      const client = new AgentKitClient({
        transport: {
          ...createTransport([protocolEvent(1, { type: "run.completed" })]),
          startRun,
        },
      });
      const metadata = { references: [{ type: "file", path: "/notes.md" }] };
      const options = { metadata: { mode: "act" } };
      const onLocalSubmit = vi.fn(() => {
        expect(client.getThread("thread-1").messages).toEqual([
          expect.objectContaining({
            role: "user",
            parts: [{ type: "text", text: "First prompt" }],
            metadata,
          }),
        ]);
        expect(startRun).not.toHaveBeenCalled();
      });
      const settled = vi.fn();
      const submission = client
        .sendMessage({
          threadId: "thread-1",
          text: "First prompt",
          options,
          metadata,
          onLocalSubmit,
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        )
        .finally(settled);
      await vi.waitFor(() => expect(startRun).toHaveBeenCalledOnce());
      expect(onLocalSubmit).toHaveBeenCalledOnce();
      expect(settled).not.toHaveBeenCalled();
      const request = startRun.mock.calls[0]![0];
      expect(Object.keys(request).sort()).toEqual([
        "messages",
        "metadata",
        "options",
        "threadId",
      ]);
      expect(request.options).toEqual(options);
      expect(request.metadata).toEqual(metadata);
      expect(structuredClone(request)).toEqual(request);

      const failure = new Error("Agent service unavailable");
      if (outcome === "accepted") started.resolve({ runId: "run-1" });
      else started.reject(failure);
      const result = await submission;
      expect(onLocalSubmit).toHaveBeenCalledOnce();
      if (outcome === "accepted") {
        expect(result).toMatchObject({ value: { runId: "run-1" } });
        if ("value" in result) await result.value.completed;
      } else {
        expect(result).toEqual({ error: failure });
        expect(client.getThread("thread-1").messages).toEqual([
          expect.objectContaining({
            status: "error",
            parts: [{ type: "text", text: "First prompt" }],
            metadata,
          }),
        ]);
        expect(client.getSnapshot().error).toMatchObject({
          code: "run_start_failed",
        });
      }
      await client.shutdown();
    },
  );

  it("does not acknowledge a message rejected by capability preflight", async () => {
    const startRun = vi.fn<AgentTransport["startRun"]>();
    const client = new AgentKitClient({
      transport: {
        ...createTransport([]),
        capabilities: { modelSelection: false },
        startRun,
      },
    });
    const onLocalSubmit = vi.fn();
    await expect(
      client.sendMessage({
        threadId: "thread-1",
        text: "Keep this draft",
        options: { model: "unsupported-model" },
        onLocalSubmit,
      }),
    ).rejects.toBeInstanceOf(AgentKitCapabilityError);
    expect(onLocalSubmit).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
    expect(client.getThread("thread-1").messages).toEqual([]);
    await client.shutdown();
  });

  it("reconciles confirmed user messages with their optimistic submissions", async () => {
    let runNumber = 0;
    const transport: AgentTransport = {
      capabilities: { resumableRuns: true },
      async startRun() {
        runNumber += 1;
        return { runId: `run-${runNumber}` };
      },
      async *subscribeToRun({ runId }) {
        const event = (
          sequence: number,
          body: Omit<
            AgentEvent,
            "id" | "threadId" | "runId" | "sequence" | "occurredAt"
          >,
        ) =>
          ({
            ...body,
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
            id: `server-user-${runId}`,
            role: "user",
            status: "complete",
            parts: [{ type: "text", text: "Repeat this prompt" }],
            metadata: { custom: { submittedRunId: runId } },
          },
        });
        yield event(3, { type: "run.completed" });
      },
      async cancelRun() {},
    };
    let messageNumber = 0;
    const client = new AgentKitClient({
      transport,
      createId: () => `optimistic-${++messageNumber}`,
    });

    const firstRun = await client.sendMessage({
      threadId: "thread-1",
      text: "Repeat this prompt",
    });
    await firstRun.completed;
    const secondRun = await client.sendMessage({
      threadId: "thread-1",
      text: "Repeat this prompt",
    });
    await secondRun.completed;

    expect(client.getThread("thread-1").messages).toMatchObject([
      {
        id: "server-user-run-1",
        role: "user",
        parts: [{ type: "text", text: "Repeat this prompt" }],
      },
      {
        id: "server-user-run-2",
        role: "user",
        parts: [{ type: "text", text: "Repeat this prompt" }],
      },
    ]);
    expect(client.getThread("thread-1").messages).toHaveLength(2);
    await client.shutdown();
  });

  it("marks the local message failed if its acknowledgement callback throws", async () => {
    const startRun = vi.fn<AgentTransport["startRun"]>();
    const client = new AgentKitClient({
      transport: { ...createTransport([]), startRun },
    });
    const failure = new Error("Local acknowledgement failed");
    await expect(
      client.sendMessage({
        threadId: "thread-1",
        text: "Keep this message",
        onLocalSubmit: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(startRun).not.toHaveBeenCalled();
    expect(client.getThread("thread-1").messages).toEqual([
      expect.objectContaining({
        status: "error",
        parts: [{ type: "text", text: "Keep this message" }],
      }),
    ]);
    expect(client.getSnapshot().error).toMatchObject({
      code: "run_start_failed",
    });
    await client.shutdown();
  });

  it.each(["accepted", "rejected"])(
    "acknowledges a %s queue write only after the queued message is inserted",
    async (outcome) => {
      const queued = Promise.withResolvers<{ message: AgentQueuedMessage }>();
      const queueMessage = vi.fn<NonNullable<AgentTransport["queueMessage"]>>(
        () => queued.promise,
      );
      const client = new AgentKitClient({
        transport: { ...createTransport([]), queueMessage },
      });
      const message: AgentQueuedMessage = {
        id: "queued-1",
        threadId: "thread-1",
        text: "Next prompt",
        createdAt: "2026-09-29T00:00:00.000Z",
      };
      const onLocalSubmit = vi.fn(() => {
        expect(client.getThread("thread-1").queuedMessages).toEqual([message]);
      });
      const submission = client
        .queueMessage({
          threadId: "thread-1",
          text: message.text,
          onLocalSubmit,
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await vi.waitFor(() => expect(queueMessage).toHaveBeenCalledOnce());
      expect(onLocalSubmit).not.toHaveBeenCalled();
      expect(client.getThread("thread-1").queuedMessages).toEqual([]);
      const request = queueMessage.mock.calls[0]![0];
      expect(request).not.toHaveProperty("onLocalSubmit");
      expect(structuredClone(request)).toEqual(request);

      const failure = new Error("Queue write failed");
      if (outcome === "accepted") queued.resolve({ message });
      else queued.reject(failure);
      const result = await submission;
      if (outcome === "accepted") {
        expect(result).toEqual({ value: message });
        expect(onLocalSubmit).toHaveBeenCalledOnce();
      } else {
        expect(result).toEqual({ error: failure });
        expect(onLocalSubmit).not.toHaveBeenCalled();
        expect(client.getThread("thread-1").queuedMessages).toEqual([]);
      }
      await client.shutdown();
    },
  );

  it("persists completed run activity and assistant boundaries", async () => {
    const transport = createTransport([
      protocolEvent(1, { type: "run.started" }),
      protocolEvent(2, {
        type: "activity.started",
        activity: {
          id: "activity-1",
          kind: "tool",
          label: "Create release",
          status: "running",
          runId: "run-1",
        },
      }),
      protocolEvent(3, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [],
          status: "streaming",
        },
      }),
      protocolEvent(4, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "Release created.",
      }),
      protocolEvent(5, {
        type: "activity.completed",
        activity: {
          id: "activity-1",
          kind: "tool",
          label: "Create release",
          status: "completed",
          runId: "run-1",
        },
      }),
      protocolEvent(6, {
        type: "message.completed",
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Release created." }],
          status: "complete",
        },
      }),
      protocolEvent(7, {
        type: "suggestions.updated",
        suggestions: [
          { id: "release-summary", label: "Summarize this release" },
        ],
      }),
      protocolEvent(8, {
        type: "annotation.created",
        messageId: "assistant-1",
        annotation: {
          id: "annotation-1",
          kind: "source",
          label: "Release notes",
          url: "https://docs.example.test/release",
        },
      }),
      protocolEvent(9, { type: "run.completed" }),
    ]);
    let persistedSnapshot: AgentThreadSnapshot | undefined;
    const persistThreadSnapshot = vi.fn(
      async ({ snapshot }: { snapshot: AgentThreadSnapshot }) => {
        persistedSnapshot = {
          ...snapshot,
          events: snapshot.events
            ?.filter((event) => event.type !== "suggestions.updated")
            .map((event, index) => ({ ...event, sequence: index + 1 })),
        };
      },
    );
    transport.persistThreadSnapshot = persistThreadSnapshot;
    transport.getThreadSnapshot = async () =>
      persistedSnapshot ?? {
        id: "thread-1",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
        messages: [],
      };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await run.completed;

    expect(persistThreadSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        snapshot: expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({ type: "activity.completed" }),
            expect.objectContaining({ type: "message.completed" }),
            expect.objectContaining({ type: "run.completed" }),
          ]),
          runs: [expect.objectContaining({ id: "run-1", status: "completed" })],
          suggestions: [
            {
              id: "release-summary",
              label: "Summarize this release",
              runId: "run-1",
            },
          ],
          annotations: [
            {
              messageId: "assistant-1",
              annotation: {
                id: "annotation-1",
                kind: "source",
                label: "Release notes",
                url: "https://docs.example.test/release",
              },
            },
          ],
        }),
      }),
      expect.anything(),
    );
    expect(client.getThread("thread-1").suggestions).toEqual([
      {
        id: "release-summary",
        label: "Summarize this release",
        runId: "run-1",
      },
    ]);

    const restoredClient = new AgentKitClient({ transport });
    await restoredClient.loadThread("thread-1");
    expect(restoredClient.getThread("thread-1").annotations).toEqual({
      "annotation-1": {
        id: "annotation-1",
        kind: "source",
        label: "Release notes",
        url: "https://docs.example.test/release",
      },
    });
    expect(restoredClient.getThread("thread-1").annotationMessageIds).toEqual({
      "annotation-1": "assistant-1",
    });
  });

  it("reports snapshot persistence failures without failing the completed run", async () => {
    const transport = createTransport([
      protocolEvent(1, { type: "run.started" }),
      protocolEvent(2, { type: "run.completed" }),
    ]);
    const persistThreadSnapshot = vi.fn(async () => {
      throw new Error("History storage is unavailable.");
    });
    transport.persistThreadSnapshot = persistThreadSnapshot;
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      messages: [],
    });
    const onError = vi.fn();
    const client = new AgentKitClient({ transport, onError });

    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await run.completed;

    expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
      "completed",
    );
    expect(client.getSnapshot()).toMatchObject({
      connection: "error",
      error: {
        code: "thread_snapshot_persist_failed",
        message: "History storage is unavailable.",
      },
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "thread_snapshot_persist_failed",
        message: "History storage is unavailable.",
      }),
    );
  });

  it("promotes queued messages before terminal snapshot persistence settles", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Follow up",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const terminal = Promise.withResolvers<void>();
    const snapshotWrite = Promise.withResolvers<void>();
    const snapshotWriteStarted = Promise.withResolvers<void>();
    const promoted = vi.fn(async () => undefined);
    const transport: AgentTransport = {
      capabilities: { messageQueue: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun({ runId }) {
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        await terminal.promise;
        yield { ...protocolEvent(2, { type: "run.completed" }), runId };
      },
      async getThreadSnapshot() {
        return {
          id: "thread-1",
          createdAt: queued.createdAt,
          updatedAt: queued.createdAt,
          messages: [],
          queuedMessages: [queued],
        };
      },
      async persistThreadSnapshot() {
        snapshotWriteStarted.resolve();
        await snapshotWrite.promise;
      },
      steerQueuedMessage: promoted,
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    let runSettled = false;
    void run.completed.then(() => {
      runSettled = true;
    });
    terminal.resolve();
    await snapshotWriteStarted.promise;
    await vi.waitFor(() => expect(promoted).toHaveBeenCalledOnce());

    expect(runSettled).toBe(false);
    expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
      "completed",
    );

    snapshotWrite.resolve();
    await run.completed;
  });

  it("promotes preloaded queued work while the terminal snapshot read is stalled", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Follow up",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const terminal = Promise.withResolvers<void>();
    const stalledSnapshot = Promise.withResolvers<AgentThreadSnapshot>();
    let snapshotReads = 0;
    const promoted = vi.fn(async () => undefined);
    const transport: AgentTransport = {
      capabilities: { messageQueue: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun({ runId }) {
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        await terminal.promise;
        yield { ...protocolEvent(2, { type: "run.completed" }), runId };
      },
      async getThreadSnapshot({ threadId }) {
        snapshotReads += 1;
        if (snapshotReads > 1) return stalledSnapshot.promise;
        return {
          id: threadId,
          createdAt: queued.createdAt,
          updatedAt: queued.createdAt,
          messages: [],
          queuedMessages: [queued],
        };
      },
      steerQueuedMessage: promoted,
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    terminal.resolve();
    await vi.waitFor(() => expect(snapshotReads).toBe(2));
    await vi.waitFor(() => expect(promoted).toHaveBeenCalledOnce());

    expect(promoted).toHaveBeenCalledWith(
      { threadId: "thread-1", messageId: queued.id },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await client.dispose();
    await run.completed;
  });

  it("waits for a terminal snapshot write before refreshing completed messages", async () => {
    const timestamp = "2026-08-29T00:00:00.000Z";
    const queued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Follow up",
      createdAt: timestamp,
    };
    const previousMessage: AgentMessage = {
      id: "assistant-before",
      role: "assistant",
      status: "complete",
      parts: [{ type: "text", text: "Earlier reply." }],
    };
    const initialSnapshot: AgentThreadSnapshot = {
      id: "thread-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [previousMessage],
      queuedMessages: [queued],
    };
    let persistedSnapshot = initialSnapshot;
    let snapshotReads = 0;
    const snapshotWriteStarted = Promise.withResolvers<void>();
    const finishSnapshotWrite = Promise.withResolvers<void>();
    const promoted = vi.fn(async () => undefined);
    const transport: AgentTransport = {
      capabilities: { messageQueue: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun({ runId }) {
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        yield {
          ...protocolEvent(2, {
            type: "message.created",
            message: {
              id: "assistant-1",
              role: "assistant",
              parts: [],
              status: "streaming",
            },
          }),
          runId,
        };
        yield {
          ...protocolEvent(3, {
            type: "message.delta",
            messageId: "assistant-1",
            text: "Queued reply.",
          }),
          runId,
        };
        yield {
          ...protocolEvent(4, {
            type: "message.completed",
            message: {
              id: "assistant-1",
              role: "assistant",
              parts: [{ type: "text", text: "Queued reply." }],
              status: "complete",
            },
          }),
          runId,
        };
        yield { ...protocolEvent(5, { type: "run.completed" }), runId };
      },
      async getThreadSnapshot() {
        snapshotReads += 1;
        return persistedSnapshot;
      },
      async persistThreadSnapshot({ snapshot }) {
        snapshotWriteStarted.resolve();
        await finishSnapshotWrite.promise;
        persistedSnapshot = snapshot;
      },
      steerQueuedMessage: promoted,
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await snapshotWriteStarted.promise;
    await vi.waitFor(() => expect(promoted).toHaveBeenCalledOnce());
    expect(snapshotReads).toBe(1);

    finishSnapshotWrite.resolve();
    await run.completed;

    expect(snapshotReads).toBe(2);
    expect(client.getThread("thread-1").messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "assistant-1",
          parts: [{ type: "text", text: "Queued reply." }],
        }),
      ]),
    );
  });

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

  it("distinguishes a missing thread from a stored thread with no messages", async () => {
    const missingTransport = createTransport([]);
    missingTransport.getThreadSnapshot = async () => null;
    const emptyTransport = createTransport([]);
    emptyTransport.getThreadSnapshot = async () => ({
      id: "empty-thread",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      messages: [],
    });
    const missing = new AgentKitClient({ transport: missingTransport });
    const empty = new AgentKitClient({ transport: emptyTransport });

    const missingLease = await missing.openThread("missing-thread");
    const emptyLease = await empty.openThread("empty-thread");

    expect(missingLease.threadFound).toBe(false);
    expect(emptyLease.threadFound).toBe(true);
    expect(missingLease.getSnapshot().messages).toEqual([]);
    expect(emptyLease.getSnapshot().messages).toEqual([]);
    missingLease.release();
    emptyLease.release();
  });

  it("settles stale snapshot work when its run is already terminal", async () => {
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      runs: [
        {
          id: "run-1",
          threadId: "thread-1",
          status: "completed" as const,
          lastSequence: 2,
          completedAt: "2026-08-29T00:00:02.000Z",
        },
      ],
      events: [
        protocolEvent(1, { type: "run.started" }),
        protocolEvent(2, { type: "run.completed" }),
      ],
      activities: [
        {
          id: "activity-1",
          kind: "tool" as const,
          label: "Inspect workspace",
          status: "running" as const,
          runId: "run-1",
        },
      ],
      toolCalls: [
        {
          id: "tool-1",
          name: "Inspect workspace",
          status: "running" as const,
          runId: "run-1",
        },
      ],
    });
    const client = new AgentKitClient({ transport });

    const thread = await client.loadThread("thread-1");

    expect(thread.runs["run-1"]?.status).toBe("completed");
    expect(thread.activeRunIds).toEqual([]);
    expect(thread.activities["activity-1"]?.status).toBe("completed");
    expect(thread.tools["tool-1"]?.status).toBe("completed");
  });

  it("refreshes terminal status without advancing its cursor", async () => {
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      runs: [
        {
          id: "run-1",
          threadId: "thread-1",
          status: "running",
          lastSequence: 2,
        },
      ],
      activeRunIds: ["run-1"],
    });
    const getRun = vi.fn(async () => ({
      id: "run-1",
      threadId: "thread-1",
      status: "completed" as const,
      lastSequence: 2,
      completedAt: "2026-08-29T00:00:02.000Z",
    }));
    transport.getRun = getRun;
    const client = new AgentKitClient({ transport });

    const thread = await client.loadThread("thread-1");

    expect(getRun).toHaveBeenCalledOnce();
    expect(thread.runs["run-1"]?.status).toBe("completed");
    expect(thread.runs["run-1"]?.lastSequence).toBe(2);
    expect(thread.activeRunIds).toEqual([]);
  });

  it("prefers refreshed terminal status over a live run at the same cursor", async () => {
    let getRunCalls = 0;
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      runs: [
        {
          id: "run-1",
          threadId: "thread-1",
          status: "running",
          lastSequence: 2,
        },
      ],
      activeRunIds: ["run-1"],
    });
    transport.getRun = async () => {
      getRunCalls += 1;
      return getRunCalls === 1
        ? {
            id: "run-1",
            threadId: "thread-1",
            status: "running",
            lastSequence: 2,
          }
        : {
            id: "run-1",
            threadId: "thread-1",
            status: "completed",
            lastSequence: 2,
            completedAt: "2026-08-29T00:00:02.000Z",
          };
    };
    transport.subscribeToRun = async function* ({ signal }) {
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
    };
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    const thread = await client.loadThread("thread-1");

    expect(thread.runs["run-1"]?.status).toBe("completed");
    expect(thread.activeRunIds).toEqual([]);
    await client.dispose();
  });

  it("does not restore a refreshed run after its stream completes during load", async () => {
    const subscriptionStarted = Promise.withResolvers<void>();
    const allowCompletion = Promise.withResolvers<void>();
    const refreshRequested = Promise.withResolvers<void>();
    const refreshResponse = Promise.withResolvers<{
      id: string;
      threadId: string;
      status: "running";
      lastSequence: number;
    }>();
    let getRunCalls = 0;
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:01.000Z",
      messages: [],
      runs: [
        {
          id: "run-1",
          threadId: "thread-1",
          status: "running",
          lastSequence: 1,
        },
      ],
      activeRunIds: ["run-1"],
    });
    transport.getRun = async () => {
      getRunCalls += 1;
      if (getRunCalls === 1) {
        return {
          id: "run-1",
          threadId: "thread-1",
          status: "running",
          lastSequence: 1,
        };
      }
      refreshRequested.resolve();
      return refreshResponse.promise;
    };
    transport.subscribeToRun = async function* () {
      subscriptionStarted.resolve();
      await allowCompletion.promise;
      yield protocolEvent(2, { type: "run.completed" });
    };
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    await subscriptionStarted.promise;
    const loading = client.loadThread("thread-1");
    await refreshRequested.promise;
    allowCompletion.resolve();
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
        "completed",
      ),
    );
    refreshResponse.resolve({
      id: "run-1",
      threadId: "thread-1",
      status: "running",
      lastSequence: 2,
    });
    const thread = await loading;

    expect(thread.runs["run-1"]?.status).toBe("completed");
    expect(thread.activeRunIds).toEqual([]);
    await client.dispose();
  });

  it("preserves refreshed nonterminal runs omitted from the snapshot", async () => {
    const cursors: number[] = [];
    const events = [
      protocolEvent(1, { type: "run.started" }),
      protocolEvent(2, { type: "run.status", status: "awaiting_input" }),
    ];
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      return {
        id: "thread-1",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:02.000Z",
        messages: [],
        events,
        activeRunIds: ["run-1"],
      };
    };
    transport.getRun = async () => {
      return {
        id: "run-1",
        threadId: "thread-1",
        status: "awaiting_approval",
        lastSequence: 7,
        startedAt: "2026-08-29T00:00:00.000Z",
        activeMessageId: "assistant-1",
      };
    };
    transport.subscribeToRun = async function* ({ afterSequence }) {
      cursors.push(afterSequence ?? 0);
    };
    const client = new AgentKitClient({ transport });

    const thread = await client.loadThread("thread-1");

    expect(thread.runs["run-1"]).toMatchObject({
      status: "awaiting_approval",
      lastSequence: 2,
      startedAt: "2026-08-29T00:00:00.000Z",
      activeMessageId: "assistant-1",
    });
    expect(thread.activeRunIds).toEqual(["run-1"]);
    await vi.waitFor(() => expect(cursors).toEqual([2]));
    await client.dispose();
  });

  it("resumes from the local cursor when server status is terminal", async () => {
    const subscribed = Promise.withResolvers<number>();
    let snapshotReads = 0;
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      return {
        id: "thread-1",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:02.000Z",
        messages: [],
        runs: [
          {
            id: "run-1",
            threadId: "thread-1",
            status: snapshotReads === 1 ? "running" : "completed",
            lastSequence: snapshotReads === 1 ? 2 : 3,
          },
        ],
        activeRunIds: snapshotReads === 1 ? ["run-1"] : [],
      };
    };
    transport.getRun = async () => ({
      id: "run-1",
      threadId: "thread-1",
      status: "completed",
      lastSequence: 3,
      completedAt: "2026-08-29T00:00:02.000Z",
    });
    transport.subscribeToRun = async function* ({ afterSequence }) {
      subscribed.resolve(afterSequence ?? 0);
      yield protocolEvent(3, { type: "run.completed" });
    };
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    await expect(subscribed.promise).resolves.toBe(2);
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
        "completed",
      ),
    );

    expect(client.getThread("thread-1").runs["run-1"]?.lastSequence).toBe(3);
    await client.dispose();
  });

  it("keeps live messages across a stale snapshot during a tool wait", async () => {
    const atToolWait = Promise.withResolvers<void>();
    const resumeStream = Promise.withResolvers<void>();
    let snapshotReads = 0;
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      return {
        id: "thread-1",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:02.000Z",
        messages:
          snapshotReads === 1
            ? []
            : [
                {
                  id: "assistant-1",
                  role: "assistant",
                  status: "streaming",
                  parts: [
                    {
                      type: "reasoning",
                      text: "Thinking",
                      visibility: "summary",
                    },
                  ],
                },
              ],
        ...(snapshotReads > 1 ? { activeRunIds: [] } : {}),
      };
    };
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
        type: "reasoning.delta",
        messageId: "assistant-1",
        text: "Thinking",
      });
      yield protocolEvent(4, {
        type: "tool.started",
        toolCall: { id: "tool-1", name: "Search", status: "running" },
      });
      yield protocolEvent(5, {
        type: "tool.updated",
        toolCall: {
          id: "tool-1",
          name: "Search",
          status: "completed",
          output: "Found it",
        },
      });
      atToolWait.resolve();
      await resumeStream.promise;
      yield protocolEvent(6, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "Answer ",
      });
      yield protocolEvent(7, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "survives",
      });
      yield protocolEvent(8, {
        type: "message.completed",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "complete",
          parts: [
            {
              type: "reasoning",
              text: "Thinking",
              visibility: "summary",
            },
            { type: "text", text: "Answer survives" },
          ],
        },
      });
      yield protocolEvent(9, { type: "run.completed" });
    };
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    try {
      await atToolWait.promise;
      await client.loadThread("thread-1");

      const inFlightMessage = client
        .getThread("thread-1")
        .messages.find((item) => item.id === "assistant-1");
      expect(inFlightMessage).toMatchObject({
        status: "streaming",
        parts: [{ type: "reasoning", text: "Thinking", visibility: "summary" }],
      });

      resumeStream.resolve();
      await run.completed;

      const completedMessage = client
        .getThread("thread-1")
        .messages.find((item) => item.id === "assistant-1");
      expect(completedMessage).toMatchObject({
        status: "complete",
        parts: [
          { type: "reasoning", text: "Thinking", visibility: "summary" },
          { type: "text", text: "Answer survives" },
        ],
      });
    } finally {
      resumeStream.resolve();
      await client.dispose();
    }
  });

  it("keeps a locally completed answer when a stale snapshot omits it", async () => {
    const timestamp = "2026-08-29T00:00:00.000Z";
    const previousMessage: AgentMessage = {
      id: "assistant-before",
      role: "assistant",
      status: "complete",
      parts: [{ type: "text", text: "Earlier reply." }],
    };
    const initialSnapshot: AgentThreadSnapshot = {
      id: "thread-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [previousMessage],
    };
    const staleSnapshot: AgentThreadSnapshot = {
      ...initialSnapshot,
      activeRunIds: [],
    };
    const terminalSnapshot = Promise.withResolvers<AgentThreadSnapshot>();
    const terminalSnapshotRead = Promise.withResolvers<void>();
    let snapshotReads = 0;
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
        text: "Full answer.",
      }),
      protocolEvent(4, {
        type: "message.completed",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", text: "Full answer." }],
        },
      }),
      protocolEvent(5, { type: "run.completed" }),
    ]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      if (snapshotReads === 1) return initialSnapshot;
      terminalSnapshotRead.resolve();
      return terminalSnapshot.promise;
    };
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Question",
    });
    try {
      await terminalSnapshotRead.promise;
      expect(
        client
          .getThread("thread-1")
          .messages.find((message) => message.id === "assistant-1"),
      ).toMatchObject({
        status: "complete",
        parts: [{ type: "text", text: "Full answer." }],
      });

      terminalSnapshot.resolve(staleSnapshot);
      await run.completed;

      expect(
        client
          .getThread("thread-1")
          .messages.find((message) => message.id === "assistant-1"),
      ).toMatchObject({
        status: "complete",
        parts: [{ type: "text", text: "Full answer." }],
      });
    } finally {
      terminalSnapshot.resolve(staleSnapshot);
      await client.dispose();
    }
  });

  it("settles the snapshot message associated with a terminal run", async () => {
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [
        {
          id: "assistant-complete",
          role: "assistant",
          status: "streaming",
          parts: [{ type: "text", text: "Completed response" }],
        },
        {
          id: "assistant-active",
          role: "assistant",
          status: "streaming",
          parts: [{ type: "text", text: "Still working" }],
        },
      ],
      runs: [
        {
          id: "run-complete",
          threadId: "thread-1",
          status: "completed" as const,
          lastSequence: 4,
          completedAt: "2026-08-29T00:00:02.000Z",
          activeMessageId: "assistant-complete",
        },
        {
          id: "run-active",
          threadId: "thread-1",
          status: "running" as const,
          lastSequence: 2,
          activeMessageId: "assistant-active",
        },
      ],
      activeRunIds: ["run-active"],
    });
    const client = new AgentKitClient({ transport });

    const thread = await client.loadThread("thread-1");

    expect(thread.messages).toEqual([
      expect.objectContaining({ id: "assistant-complete", status: "complete" }),
      expect.objectContaining({ id: "assistant-active", status: "streaming" }),
    ]);
  });

  it("settles the only streaming assistant in a terminal snapshot without events", async () => {
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [
        {
          id: "assistant-complete",
          role: "assistant",
          status: "streaming",
          parts: [{ type: "text", text: "Completed response" }],
        },
      ],
      runs: [
        {
          id: "run-complete",
          threadId: "thread-1",
          status: "completed" as const,
          lastSequence: 4,
          completedAt: "2026-08-29T00:00:02.000Z",
        },
      ],
      activeRunIds: [],
    });
    const client = new AgentKitClient({ transport });

    const thread = await client.loadThread("thread-1");

    expect(thread.messages).toEqual([
      expect.objectContaining({ id: "assistant-complete", status: "complete" }),
    ]);
  });

  it("settles unassociated streaming messages conservatively for mixed terminals", async () => {
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [
        {
          id: "assistant-partial",
          role: "assistant",
          status: "streaming",
          parts: [{ type: "text", text: "Partial response" }],
        },
      ],
      runs: [
        {
          id: "run-complete",
          threadId: "thread-1",
          status: "completed" as const,
          lastSequence: 4,
        },
        {
          id: "run-failed",
          threadId: "thread-1",
          status: "failed" as const,
          lastSequence: 4,
        },
      ],
      activeRunIds: [],
    });
    const client = new AgentKitClient({ transport });

    const thread = await client.loadThread("thread-1");

    expect(thread.messages).toEqual([
      expect.objectContaining({ id: "assistant-partial", status: "error" }),
    ]);
  });

  it("uses durable message updates when a refresh has no live message changes", async () => {
    let snapshotReads = 0;
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      return {
        id: "thread-1",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: `2026-08-29T00:00:0${snapshotReads}.000Z`,
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            status: snapshotReads === 1 ? "streaming" : "complete",
            parts: [
              {
                type: "text",
                text: snapshotReads === 1 ? "Partial" : "Complete response",
              },
            ],
          },
        ],
      };
    };
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    const thread = await client.loadThread("thread-1");

    expect(thread.messages).toEqual([
      expect.objectContaining({
        id: "assistant-1",
        status: "complete",
        parts: [{ type: "text", text: "Complete response" }],
      }),
    ]);
  });

  it("lets a refresh remove a resolved runtime projection", async () => {
    let snapshotReads = 0;
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      return {
        id: "thread-1",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
        messages: [],
        toolCalls:
          snapshotReads === 1
            ? [
                {
                  id: "tool-1",
                  name: "Search",
                  status: "completed" as const,
                },
              ]
            : [],
      };
    };
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    expect(client.getThread("thread-1").tools["tool-1"]).toBeDefined();
    await client.loadThread("thread-1");

    expect(client.getThread("thread-1").tools).toEqual({});
  });

  it("settles a terminal snapshot again after reconciling a streamed message id", async () => {
    let snapshotReads = 0;
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      if (snapshotReads === 1) {
        return {
          id: "thread-1",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:01.000Z",
          messages: [
            {
              id: "assistant-transient",
              role: "assistant",
              status: "streaming",
              parts: [{ type: "text", text: "Completed response" }],
            },
          ],
        };
      }
      return {
        id: "thread-1",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:02.000Z",
        messages: [
          {
            id: "assistant-durable",
            role: "assistant",
            status: "streaming",
            parts: [{ type: "text", text: "Completed response" }],
          },
        ],
        runs: [
          {
            id: "run-complete",
            threadId: "thread-1",
            status: "completed" as const,
            lastSequence: 4,
            completedAt: "2026-08-29T00:00:02.000Z",
          },
        ],
        activeRunIds: [],
      };
    };
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    const thread = await client.loadThread("thread-1");

    expect(thread.messages).toEqual([
      expect.objectContaining({ id: "assistant-durable", status: "complete" }),
    ]);
  });

  it("resubscribes the same run after a connection continuation", async () => {
    let subscriptionCount = 0;
    const resolveConnectionRequest = vi.fn(async () => undefined);
    const connectionRequest = {
      id: "connection-1",
      provider: "slack",
      reason: "connect" as const,
      status: "requested" as const,
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const transport: AgentTransport = {
      capabilities: { connectionRequests: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {
        subscriptionCount += 1;
        if (subscriptionCount === 1) {
          yield protocolEvent(1, { type: "run.started" });
          yield protocolEvent(2, {
            type: "run.status",
            status: "awaiting_input",
          });
          yield protocolEvent(3, {
            type: "connection.requested",
            request: connectionRequest,
          });
          return;
        }
        yield protocolEvent(4, {
          type: "connection.updated",
          request: {
            ...connectionRequest,
            status: "connected",
            updatedAt: "2026-08-29T00:00:01.000Z",
          },
        });
        yield protocolEvent(5, { type: "run.status", status: "running" });
        yield protocolEvent(6, { type: "run.completed" });
      },
      resolveConnectionRequest,
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Verify Slack",
    });
    await run.completed;
    expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
      "awaiting_input",
    );

    await client.resolveConnectionRequest({
      threadId: "thread-1",
      runId: "run-1",
      requestId: "connection-1",
      response: {
        status: "connected",
        connectionId: "workspace-slack",
      },
    });

    await vi.waitFor(() =>
      expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
        "completed",
      ),
    );
    expect(subscriptionCount).toBe(2);
    expect(resolveConnectionRequest).toHaveBeenCalledOnce();
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
    expect(thread.suggestions).toEqual([
      { id: "next", label: "Run checks", runId: "run-1" },
    ]);
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

  it("preserves an approval interrupt across a dropped stream", async () => {
    let subscriptions = 0;
    const reports: AgentStreamIntegrityReport[] = [];
    const transport = createTransport([]);
    transport.subscribeToRun = async function* (input) {
      subscriptions += 1;
      if (subscriptions === 1) {
        yield protocolEvent(1, { type: "run.started" });
        yield protocolEvent(2, {
          type: "approval.requested",
          request: { id: "approval-1", title: "Continue?" },
        });
        throw new Error("connection dropped");
      }
      expect(input.afterSequence).toBe(2);
    };
    const client = new AgentKitClient({
      transport,
      reconnect: { attempts: 1, delayMs: () => 0 },
      onIntegrityReport: (report) => reports.push(report),
    });

    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await run.completed;

    expect(subscriptions).toBe(2);
    expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
      "awaiting_approval",
    );
    expect(reports).not.toContainEqual(
      expect.objectContaining({ code: "run_missing_terminal" }),
    );
    expect(client.getSnapshot().connection).toBe("connected");
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

  it("moves one queued message to the front while preserving the remaining order", async () => {
    const queued = ["one", "two", "three"].map((id, index) => ({
      id,
      threadId: "thread-1",
      text: id,
      createdAt: `2026-08-29T00:00:0${index}.000Z`,
    }));
    const moveQueuedMessageToTop = vi.fn(async () => undefined);
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: queued[0]!.createdAt,
      updatedAt: queued[0]!.createdAt,
      messages: [],
      queuedMessages: queued,
    });
    transport.moveQueuedMessageToTop = moveQueuedMessageToTop;
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    expect(client.supportsQueuedMessageReordering()).toBe(true);
    await client.moveQueuedMessageToTop("thread-1", "three");

    expect(moveQueuedMessageToTop).toHaveBeenCalledWith(
      { threadId: "thread-1", messageId: "three" },
      expect.anything(),
    );
    expect(
      client.getThread("thread-1").queuedMessages.map(({ id }) => id),
    ).toEqual(["three", "one", "two"]);
  });

  it("rolls queue order back when a durable move-to-top request fails", async () => {
    const queued = ["one", "two"].map((id, index) => ({
      id,
      threadId: "thread-1",
      text: id,
      createdAt: `2026-08-29T00:00:0${index}.000Z`,
    }));
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: queued[0]!.createdAt,
      updatedAt: queued[0]!.createdAt,
      messages: [],
      queuedMessages: queued,
    });
    transport.moveQueuedMessageToTop = async () => {
      throw new Error("write failed");
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    await expect(
      client.moveQueuedMessageToTop("thread-1", "two"),
    ).rejects.toThrow("write failed");
    expect(client.getThread("thread-1").queuedMessages).toEqual(queued);
  });

  it("preserves feedback trace identifiers and reason in the transport input", async () => {
    const submitFeedback = vi.fn(async () => undefined);
    const transport = createTransport([]);
    transport.capabilities = { ...transport.capabilities, feedback: true };
    transport.submitFeedback = submitFeedback;
    const client = new AgentKitClient({ transport });

    await client.submitFeedback("thread-1", "message-1", "negative", {
      runId: "run-1",
      messageSeq: 4,
      reason: "The response was incomplete.",
    });

    expect(submitFeedback).toHaveBeenCalledWith(
      {
        threadId: "thread-1",
        messageId: "message-1",
        value: "negative",
        runId: "run-1",
        messageSeq: 4,
        reason: "The response was incomplete.",
      },
      expect.anything(),
    );
  });

  it("serializes queue mutations so an earlier rollback preserves later intent", async () => {
    const firstQueued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Follow up",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const secondQueued: AgentQueuedMessage = {
      ...firstQueued,
      id: "queued-2",
      text: "Then announce it",
    };
    const firstRequest = Promise.withResolvers<void>();
    const removeQueuedMessage = vi.fn(
      async ({ messageId }: { messageId: string }) => {
        if (messageId === firstQueued.id) await firstRequest.promise;
      },
    );
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: firstQueued.createdAt,
      updatedAt: firstQueued.createdAt,
      messages: [],
      queuedMessages: [firstQueued, secondQueued],
    });
    transport.removeQueuedMessage = removeQueuedMessage;
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    const firstRemoval = client.removeQueuedMessage("thread-1", firstQueued.id);
    const secondRemoval = client.removeQueuedMessage(
      "thread-1",
      secondQueued.id,
    );
    await vi.waitFor(() => expect(removeQueuedMessage).toHaveBeenCalledOnce());
    expect(client.getThread("thread-1").queuedMessages).toEqual([secondQueued]);

    firstRequest.reject(new Error("first removal failed"));
    await expect(firstRemoval).rejects.toThrow("first removal failed");
    await secondRemoval;

    expect(removeQueuedMessage).toHaveBeenNthCalledWith(
      2,
      { threadId: "thread-1", messageId: secondQueued.id },
      expect.anything(),
    );
    expect(client.getThread("thread-1").queuedMessages).toEqual([firstQueued]);
  });

  it("keeps new durable queue entries while a removal snapshot is stale", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Follow up",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const laterQueued: AgentQueuedMessage = {
      ...queued,
      id: "queued-2",
      text: "Then announce it",
    };
    let snapshotReads = 0;
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      return {
        id: "thread-1",
        createdAt: queued.createdAt,
        updatedAt: queued.createdAt,
        messages: [],
        queuedMessages: snapshotReads === 1 ? [queued] : [queued, laterQueued],
      };
    };
    transport.removeQueuedMessage = async () => {};
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    await client.removeQueuedMessage("thread-1", queued.id);
    await client.loadThread("thread-1");

    expect(client.getThread("thread-1").queuedMessages).toEqual([laterQueued]);
  });

  it("keeps durable queue additions when the local queue did not change", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Follow up",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const laterQueued: AgentQueuedMessage = {
      ...queued,
      id: "queued-2",
      text: "Then announce it",
    };
    let snapshotReads = 0;
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      return {
        id: "thread-1",
        createdAt: queued.createdAt,
        updatedAt: queued.createdAt,
        messages: [],
        queuedMessages: snapshotReads === 1 ? [queued] : [queued, laterQueued],
      };
    };
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    await client.loadThread("thread-1");

    expect(client.getThread("thread-1").queuedMessages).toEqual([
      queued,
      laterQueued,
    ]);
  });

  it("does not resurrect a removal after a briefly current snapshot", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Follow up",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    let snapshotReads = 0;
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      return {
        id: "thread-1",
        createdAt: queued.createdAt,
        updatedAt: queued.createdAt,
        messages: [],
        queuedMessages:
          snapshotReads === 1 ? [queued] : snapshotReads === 2 ? [] : [queued],
      };
    };
    transport.removeQueuedMessage = async () => {};
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    await client.removeQueuedMessage("thread-1", queued.id);
    await client.loadThread("thread-1");
    await client.loadThread("thread-1");

    expect(client.getThread("thread-1").queuedMessages).toEqual([]);
  });

  it("promotes hydrated queued work into a subscribed run", async () => {
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
          id: "confirmed-user-1",
          role: "user",
          status: "complete",
          parts: [{ type: "text", text: "Continue with the release" }],
        },
      });
      yield protocolEvent(3, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: [],
        },
      });
      yield protocolEvent(4, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "Release continued.",
      });
      yield protocolEvent(5, { type: "run.completed" });
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");
    await vi.waitFor(() =>
      expect(client.getThread("thread-1")).toMatchObject({
        queuedMessages: [],
        messages: [
          { id: "confirmed-user-1", role: "user" },
          { id: "assistant-1", role: "assistant" },
        ],
      }),
    );
  });

  it("treats steering a queue item already promoted into history as success", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Steer now",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const steeringResult = Promise.withResolvers<void>();
    const steerQueuedMessage = vi.fn(() => steeringResult.promise);
    const client = new AgentKitClient({
      transport: {
        ...createTransport([]),
        capabilities: { messageQueue: true },
        async queueMessage() {
          return { message: queued };
        },
        steerQueuedMessage,
      },
    });

    await client.queueMessage({ threadId: "thread-1", text: queued.text });
    const firstSteer = client.steerQueuedMessage("thread-1", queued.id);
    await vi.waitFor(() => expect(steerQueuedMessage).toHaveBeenCalledOnce());
    const duplicateSteer = client.steerQueuedMessage("thread-1", queued.id);
    expect(duplicateSteer).toBe(firstSteer);
    steeringResult.resolve();
    await Promise.all([firstSteer, duplicateSteer]);
    await client.steerQueuedMessage("thread-1", queued.id);

    expect(steerQueuedMessage).toHaveBeenCalledOnce();
    expect(client.getThread("thread-1").queuedMessages).toEqual([]);
    expect(client.getThread("thread-1").messages).toContainEqual(
      expect.objectContaining({ id: queued.id, role: "user" }),
    );
    await client.shutdown();
  });

  it("queues server-rejected sends without marking their optimistic message failed", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-after-conflict",
      threadId: "thread-1",
      text: "Do this after the current run",
      createdAt: "2026-10-01T00:00:00.000Z",
      metadata: { contextItems: [{ key: "selection", text: "full context" }] },
    };
    const startRun = vi.fn(async () => {
      throw Object.assign(new Error("Run already in progress"), {
        code: "run_slot_busy",
        retryable: true,
        activeRunId: "run-active",
      });
    });
    const queueMessage = vi.fn(async () => ({ message: queued }));
    const onLocalSubmit = vi.fn();
    const client = new AgentKitClient({
      transport: {
        ...createTransport([]),
        capabilities: { messageQueue: true },
        startRun,
        queueMessage,
        async *subscribeToRun({ signal }) {
          yield protocolEvent(1, { type: "run.started" });
          await new Promise<void>((resolve) =>
            signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
        },
      },
    });

    const handle = await client.sendMessage({
      threadId: "thread-1",
      text: queued.text,
      metadata: queued.metadata,
      onLocalSubmit,
    });

    expect(handle.runId).toBe("run-active");
    expect(startRun).toHaveBeenCalledOnce();
    expect(queueMessage).toHaveBeenCalledOnce();
    expect(queueMessage.mock.calls[0]?.[0]).toMatchObject({
      threadId: "thread-1",
      text: queued.text,
      metadata: queued.metadata,
    });
    expect(onLocalSubmit).toHaveBeenCalledOnce();
    expect(client.getThread("thread-1")).toMatchObject({
      activeRunIds: ["run-active"],
      queuedMessages: [queued],
      messages: [],
    });

    await client.shutdown();
  });

  it("preserves interrupt intent when a server-rejected send is steered", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-steered-conflict",
      threadId: "thread-1",
      text: "Interrupt with this",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const cancelRun = vi.fn(async () => undefined);
    const steerQueuedMessage = vi.fn(async () => ({ runId: "run-steered" }));
    const client = new AgentKitClient({
      transport: {
        ...createTransport([]),
        capabilities: { messageQueue: true },
        async startRun() {
          throw Object.assign(new Error("Run already in progress"), {
            code: "run_slot_busy",
            retryable: true,
            activeRunId: "run-active",
          });
        },
        async queueMessage() {
          return { message: queued };
        },
        async *subscribeToRun({ signal }) {
          yield protocolEvent(1, { type: "run.started" });
          await new Promise<void>((resolve) =>
            signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
        },
        cancelRun,
        steerQueuedMessage,
      },
    });

    const handle = await client.sendMessage({
      threadId: "thread-1",
      text: queued.text,
      interruptActiveRun: true,
    });

    expect(handle.runId).toBe("run-steered");
    expect(cancelRun).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", runId: "run-active" }),
      expect.anything(),
    );
    expect(steerQueuedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        messageId: queued.id,
      }),
      expect.anything(),
    );
    expect(client.getThread("thread-1")).toMatchObject({
      messages: [expect.objectContaining({ id: queued.id })],
      queuedMessages: [],
    });

    await client.shutdown();
  });

  it("treats an item missing at promotion as already claimed by another tab", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-claimed-elsewhere",
      threadId: "thread-1",
      text: "Run once",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const onError = vi.fn();
    const client = new AgentKitClient({
      transport: {
        ...createTransport([]),
        capabilities: { messageQueue: true },
        async queueMessage() {
          return { message: queued };
        },
        async steerQueuedMessage() {
          throw new Error(`Unknown queued message: ${queued.id}`);
        },
      },
      onError,
    });

    await client.queueMessage({ threadId: "thread-1", text: queued.text });
    await client.steerQueuedMessage("thread-1", queued.id);

    expect(client.getThread("thread-1").queuedMessages).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
    await client.shutdown();
  });

  it("rolls rejected steering back without reporting a connection outage", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Continue with the release",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const laterQueued: AgentQueuedMessage = {
      ...queued,
      id: "queued-2",
      text: "Then announce it",
    };
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: queued.createdAt,
      updatedAt: queued.createdAt,
      messages: [],
      queuedMessages: [queued, laterQueued],
    });
    transport.steerQueuedMessage = async () => {
      throw new Error("Steering rejected");
    };
    const onError = vi.fn();
    const client = new AgentKitClient({ transport, onError });
    await client.loadThread("thread-1");

    await expect(
      client.steerQueuedMessage("thread-1", "queued-2"),
    ).rejects.toThrow("Steering rejected");

    expect(client.getThread("thread-1")).toMatchObject({
      queuedMessages: [queued, laterQueued],
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

  it("retries queued promotion after approval without relying on a terminal event", async () => {
    const runCompletion = Promise.withResolvers<void>();
    const promotionRetried = Promise.withResolvers<void>();
    let serverSlotBusy = true;
    let promotionAttempts = 0;
    const queued: AgentQueuedMessage = {
      id: "queued-during-run",
      threadId: "thread-1",
      text: "Run after the current response",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const transport: AgentTransport = {
      capabilities: { approvals: true, messageQueue: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async queueMessage() {
        return { message: queued };
      },
      async resolveApproval() {},
      async steerQueuedMessage() {
        promotionAttempts += 1;
        if (serverSlotBusy) throw new AgentKitRunSlotBusyError();
        promotionRetried.resolve();
        return { runId: "run-2" };
      },
      async *subscribeToRun({ runId }) {
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        if (runId === "run-1") await runCompletion.promise;
        yield { ...protocolEvent(2, { type: "run.completed" }), runId };
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const firstRun = await client.sendMessage({
      threadId: "thread-1",
      text: "Finish this response first",
    });
    await client.queueMessage({ threadId: "thread-1", text: queued.text });

    expect(promotionAttempts).toBe(0);
    await client.resolveApproval({
      threadId: "thread-1",
      runId: "run-1",
      approvalId: "approval-1",
      response: { decision: "approve" },
    });
    await vi.waitFor(() => expect(promotionAttempts).toBe(1));
    expect(client.getThread("thread-1")).toMatchObject({
      queuedMessages: [queued],
      messages: [{ role: "user" }],
    });

    serverSlotBusy = false;
    await promotionRetried.promise;
    expect(promotionAttempts).toBe(2);
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").runs["run-2"]?.status).toBe(
        "completed",
      ),
    );
    runCompletion.resolve();
    await firstRun.completed;

    expect(client.getThread("thread-1")).toMatchObject({
      activeRunIds: [],
      queuedMessages: [],
      messages: [{ role: "user" }, { id: queued.id, role: "user" }],
    });
  });

  it("promotes a queued write that settles after the previous run completes", async () => {
    const runCompletion = Promise.withResolvers<void>();
    const queueWriteStarted = Promise.withResolvers<void>();
    const finishQueueWrite = Promise.withResolvers<void>();
    const promoted = vi.fn(async () => ({ runId: "run-2" }));
    const transport: AgentTransport = {
      capabilities: { messageQueue: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async queueMessage(input) {
        queueWriteStarted.resolve();
        await finishQueueWrite.promise;
        return {
          message: {
            id: "queued-after-completion",
            threadId: input.threadId,
            text: input.text,
            createdAt: "2026-08-29T00:00:00.000Z",
          },
        };
      },
      steerQueuedMessage: promoted,
      async *subscribeToRun({ runId }) {
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        if (runId === "run-1") await runCompletion.promise;
        yield { ...protocolEvent(2, { type: "run.completed" }), runId };
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const firstRun = await client.sendMessage({
      threadId: "thread-1",
      text: "Complete before the follow-up write settles",
    });
    const queuedMessage = client.queueMessage({
      threadId: "thread-1",
      text: "Run after completion",
    });
    await queueWriteStarted.promise;

    runCompletion.resolve();
    await firstRun.completed;
    expect(promoted).not.toHaveBeenCalled();

    finishQueueWrite.resolve();
    await queuedMessage;
    await vi.waitFor(() => expect(promoted).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").runs["run-2"]?.status).toBe(
        "completed",
      ),
    );

    expect(client.getThread("thread-1")).toMatchObject({
      activeRunIds: [],
      queuedMessages: [],
      messages: [
        { id: expect.any(String), role: "user" },
        { id: "queued-after-completion", role: "user" },
      ],
    });
  });

  it("promotes a queued write when a run starts and completes during the write", async () => {
    const queueWriteStarted = Promise.withResolvers<void>();
    const finishQueueWrite = Promise.withResolvers<void>();
    const runStarted = Promise.withResolvers<void>();
    const runCompletion = Promise.withResolvers<void>();
    const promoted = vi.fn(async () => ({ runId: "run-2" }));
    const transport: AgentTransport = {
      capabilities: { messageQueue: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async queueMessage(input) {
        queueWriteStarted.resolve();
        await finishQueueWrite.promise;
        return {
          message: {
            id: "queued-during-run-write",
            threadId: input.threadId,
            text: input.text,
            createdAt: "2026-08-29T00:00:00.000Z",
          },
        };
      },
      steerQueuedMessage: promoted,
      async *subscribeToRun({ runId }) {
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        if (runId === "run-1") {
          runStarted.resolve();
          await runCompletion.promise;
        }
        yield { ...protocolEvent(2, { type: "run.completed" }), runId };
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const queuedMessage = client.queueMessage({
      threadId: "thread-1",
      text: "Run after the slot clears",
    });
    await queueWriteStarted.promise;

    const activeRun = await client.sendMessage({
      threadId: "thread-1",
      text: "Finish before the queue write",
    });
    await runStarted.promise;
    runCompletion.resolve();
    await activeRun.completed;
    expect(promoted).not.toHaveBeenCalled();

    finishQueueWrite.resolve();
    await queuedMessage;
    await vi.waitFor(() => expect(promoted).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").runs["run-2"]?.status).toBe(
        "completed",
      ),
    );

    expect(client.getThread("thread-1")).toMatchObject({
      activeRunIds: [],
      queuedMessages: [],
      messages: [
        { id: expect.any(String), role: "user" },
        { id: "queued-during-run-write", role: "user" },
      ],
    });
  });

  it("delegates promotion when the reloaded snapshot still reports an active run", async () => {
    const queued = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Run after approval",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const promoted = vi.fn(async () => ({ runId: "run-2" }));
    const transport: AgentTransport = {
      capabilities: { messageQueue: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async queueMessage() {
        return { message: queued };
      },
      steerQueuedMessage: promoted,
      async *subscribeToRun({ runId }) {
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        yield { ...protocolEvent(2, { type: "run.completed" }), runId };
      },
      async getThreadSnapshot() {
        return {
          id: "thread-1",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:01.000Z",
          messages: [],
          queuedMessages: [queued],
          runs: [
            {
              id: "server-continuation",
              threadId: "thread-1",
              status: "running",
              lastSequence: 0,
            },
          ],
          activeRunIds: ["server-continuation"],
        };
      },
      async cancelRun() {},
    };
    const reports: AgentStreamIntegrityReport[] = [];
    const client = new AgentKitClient({
      transport,
      onIntegrityReport: (report) => reports.push(report),
    });
    await client.queueMessage({ threadId: "thread-1", text: queued.text });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Start release review",
    });
    await run.completed;
    await vi.waitFor(() => expect(promoted).toHaveBeenCalledOnce());

    expect(reports).not.toContainEqual(
      expect.objectContaining({
        code: "queue_promotion_dropped",
        reason: "run-still-active",
      }),
    );
  });

  it("rearms queued promotion from an idle hydrated thread", async () => {
    const queued = {
      id: "queued-1",
      threadId: "thread-1",
      text: "Run after the reload",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const promoted = vi.fn(async () => undefined);
    const transport = createTransport([]);
    transport.capabilities = { messageQueue: true };
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:01.000Z",
      messages: [],
      queuedMessages: [queued],
      runs: [],
      activeRunIds: [],
    });
    transport.steerQueuedMessage = promoted;
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    await vi.waitFor(() => expect(promoted).toHaveBeenCalledOnce());

    expect(promoted).toHaveBeenCalledWith(
      { threadId: "thread-1", messageId: queued.id },
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
      async discoverCapabilities() {
        calls.push("capabilities");
        return {
          protocol: negotiateAgentKitProtocolVersion(
            createAgentKitProtocolVersionOffer(),
          ),
          capabilities: [
            { id: "approvals" as const, state: "available" as const },
            { id: "widgets" as const, state: "available" as const },
            {
              id: "resumableRuns" as const,
              state: "unsupported" as const,
              error: createCapabilityUnsupportedError("resumableRuns"),
            },
          ],
          discoveredAt: "2026-08-29T00:00:00.000Z",
        };
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
      async discoverCapabilities(_input, context) {
        preflightCorrelationId = context?.correlationId;
        return {
          protocol: negotiateAgentKitProtocolVersion(
            createAgentKitProtocolVersionOffer(),
          ),
          capabilities: [],
          discoveredAt: "2026-08-29T00:00:00.000Z",
        };
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
    expect(client.getThread("thread-1").runs["run-1"]?.status).toBe("failed");
    expect(client.getThread("thread-1").activeRunIds).toEqual([]);
    expect(
      (client as unknown as { submittedUserMessages: Map<string, string> })
        .submittedUserMessages.size,
    ).toBe(0);
  });

  it("releases submitted-message reconciliation after a non-retryable run failure", async () => {
    const failStream = Promise.withResolvers<void>();
    let subscriptions = 0;
    const transport = createTransport([]);
    transport.subscribeToRun = async function* () {
      subscriptions += 1;
      await failStream.promise;
      throw new AgentProtocolValidationError("stream", "invalid event");
    };
    const client = new AgentKitClient({ transport });
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Keep this message",
    });
    const submittedUserMessages = Reflect.get(
      client,
      "submittedUserMessages",
    ) as Map<string, string>;

    expect(submittedUserMessages.size).toBe(1);
    failStream.resolve();
    await expect(run.completed).rejects.toThrow("invalid event");

    expect(client.getThread("thread-1").runs[run.runId]?.status).toBe("failed");
    expect(submittedUserMessages.size).toBe(0);
    expect(subscriptions).toBe(1);
    await client.shutdown();
  });

  it.each(["stream failure", "cancellation"])(
    "promotes queued work after a run ends by %s",
    async (outcome) => {
      const subscribed = Promise.withResolvers<void>();
      const failStream = Promise.withResolvers<void>();
      const queued: AgentQueuedMessage = {
        id: "queued-1",
        threadId: "thread-1",
        text: "Run next",
        createdAt: "2026-08-29T00:00:00.000Z",
      };
      const promoted = vi.fn(async () => undefined);
      const transport: AgentTransport = {
        capabilities: { messageQueue: true },
        async startRun() {
          return { runId: "run-1" };
        },
        async queueMessage() {
          return { message: queued };
        },
        async *subscribeToRun({ signal }) {
          yield protocolEvent(1, { type: "run.started" });
          subscribed.resolve();
          if (outcome === "stream failure") {
            await failStream.promise;
            throw new Error("stream unavailable");
          }
          await new Promise<void>((resolve) =>
            signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
        },
        async cancelRun() {},
        steerQueuedMessage: promoted,
      };
      const client = new AgentKitClient({
        transport,
        reconnect: { attempts: 0 },
      });
      const run = await client.sendMessage({
        threadId: "thread-1",
        text: "Go",
      });
      await subscribed.promise;
      await client.queueMessage({ threadId: "thread-1", text: queued.text });

      if (outcome === "stream failure") {
        failStream.resolve();
        await expect(run.completed).rejects.toThrow("stream unavailable");
      } else {
        await run.cancel();
        await expect(run.completed).resolves.toBeUndefined();
      }

      await vi.waitFor(() => expect(promoted).toHaveBeenCalledOnce());
      expect(promoted).toHaveBeenCalledWith(
        { threadId: "thread-1", messageId: queued.id },
        expect.objectContaining({
          correlationId: expect.any(String),
          signal: expect.any(AbortSignal),
        }),
      );
    },
  );

  it("does not roll an accepted stream cursor back during a stale refresh", async () => {
    const refresh = Promise.withResolvers<{
      id: string;
      createdAt: string;
      updatedAt: string;
      messages: AgentMessage[];
      activeRunIds: string[];
      runs: Array<{
        id: string;
        threadId: string;
        status: "running";
        lastSequence: number;
      }>;
      events: AgentEvent[];
    }>();
    let subscriptions = 0;
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async getThreadSnapshot() {
        return subscriptions === 0
          ? {
              id: "thread-1",
              createdAt: "2026-08-29T00:00:00.000Z",
              updatedAt: "2026-08-29T00:00:00.000Z",
              messages: [],
            }
          : refresh.promise;
      },
      async *subscribeToRun({ signal }) {
        subscriptions += 1;
        yield protocolEvent(1, { type: "run.started" });
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else
            signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");
    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").runs["run-1"]?.lastSequence).toBe(1),
    );

    const loading = client.loadThread("thread-1");
    refresh.resolve({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      messages: [],
      activeRunIds: ["run-1"],
      runs: [
        {
          id: "run-1",
          threadId: "thread-1",
          status: "running",
          lastSequence: 0,
        },
      ],
      events: [],
    });
    await loading;

    expect(client.getThread("thread-1").runs["run-1"]?.lastSequence).toBe(1);
    await client.dispose();
    await expect(run.completed).resolves.toBeUndefined();
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
    expect(
      (client as unknown as { submittedUserMessages: Map<string, string> })
        .submittedUserMessages.size,
    ).toBe(0);
  });

  it("clears submitted-message reconciliation when a thread is deleted", async () => {
    const subscribed = Promise.withResolvers<void>();
    const transport: AgentTransport = {
      ...createTransport([]),
      async *subscribeToRun({ signal }) {
        subscribed.resolve();
        await new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      async deleteThread() {},
    };
    const client = new AgentKitClient({ transport });
    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await subscribed.promise;

    expect(
      (client as unknown as { submittedUserMessages: Map<string, string> })
        .submittedUserMessages.size,
    ).toBe(1);
    await client.deleteThread("thread-1");
    await expect(run.completed).resolves.toBeUndefined();
    expect(
      (client as unknown as { submittedUserMessages: Map<string, string> })
        .submittedUserMessages.size,
    ).toBe(0);
  });

  it("settles projected work when cancellation stops the stream before its terminal event", async () => {
    const subscribed = Promise.withResolvers<void>();
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun({ signal }) {
        yield protocolEvent(1, { type: "run.started" });
        yield protocolEvent(2, {
          type: "message.created",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "streaming",
            parts: [{ type: "text", text: "Partial" }],
          },
        });
        yield protocolEvent(3, {
          type: "activity.started",
          activity: {
            id: "activity-1",
            kind: "tool",
            label: "Search",
            status: "running",
          },
        });
        yield protocolEvent(4, {
          type: "tool.started",
          toolCall: { id: "tool-1", name: "Search", status: "running" },
        });
        subscribed.resolve();
        await new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await subscribed.promise;

    await run.cancel();
    await expect(run.completed).resolves.toBeUndefined();

    const thread = client.getThread("thread-1");
    expect(thread.runs["run-1"]?.status).toBe("cancelled");
    expect(thread.messages).toContainEqual(
      expect.objectContaining({ id: "assistant-1", status: "error" }),
    );
    expect(thread.activities["activity-1"]?.status).toBe("cancelled");
    expect(thread.tools["tool-1"]?.status).toBe("cancelled");
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

  it("retires an interrupted run when approval resumes on a new run", async () => {
    let persistedSnapshot: AgentThreadSnapshot | undefined;
    const transport: AgentTransport = {
      capabilities: { approvals: true },
      async startRun() {
        return { runId: "run-interrupted" };
      },
      async *subscribeToRun({ runId }) {
        if (runId === "run-interrupted") {
          yield { ...protocolEvent(1, { type: "run.started" }), runId };
          yield {
            ...protocolEvent(2, {
              type: "approval.requested",
              request: { id: "approval-1", title: "Continue?" },
            }),
            runId,
          };
          return;
        }
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        yield {
          ...protocolEvent(2, {
            type: "approval.resolved",
            approvalId: "approval-1",
            response: { decision: "approve" },
          }),
          runId,
        };
        yield { ...protocolEvent(3, { type: "run.completed" }), runId };
      },
      async cancelRun() {},
      async resumeRun() {
        return { runId: "run-resumed" };
      },
      async persistThreadSnapshot({ snapshot }) {
        persistedSnapshot = snapshot;
      },
      async getThreadSnapshot() {
        return persistedSnapshot ?? null;
      },
    };
    const client = new AgentKitClient({ transport });
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Start",
    });
    await run.completed;

    expect(client.getThread("thread-1").activeRunIds).toEqual([
      "run-interrupted",
    ]);
    expect(client.getThread("thread-1").runs["run-interrupted"]?.status).toBe(
      "awaiting_approval",
    );

    await client.resolveApproval({
      threadId: "thread-1",
      runId: "run-interrupted",
      approvalId: "approval-1",
      response: { decision: "approve" },
    });

    await vi.waitFor(() =>
      expect(client.getThread("thread-1").activeRunIds).toEqual([]),
    );
    expect(client.getThread("thread-1").runs["run-resumed"]?.status).toBe(
      "completed",
    );
    await vi.waitFor(() =>
      expect(
        persistedSnapshot?.runs?.find((run) => run.id === "run-interrupted")
          ?.status,
      ).toBe("completed"),
    );

    const restoredClient = new AgentKitClient({ transport });
    await restoredClient.loadThread("thread-1");
    expect(
      restoredClient.getThread("thread-1").runs["run-interrupted"]?.status,
    ).toBe("completed");
    expect(restoredClient.getThread("thread-1").activeRunIds).toEqual([]);
  });

  it("reattaches after approval when the interrupted reader is still closing", async () => {
    const closeApprovalStream = Promise.withResolvers<void>();
    const queued: AgentQueuedMessage = {
      id: "queued-after-approval",
      threadId: "thread-1",
      text: "Continue after approval",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    let subscriptions = 0;
    const promoted = vi.fn(async () => undefined);
    const transport: AgentTransport = {
      capabilities: { approvals: true, messageQueue: true },
      async startRun() {
        return { runId: "run-approval" };
      },
      async queueMessage() {
        return { message: queued };
      },
      steerQueuedMessage: promoted,
      async *subscribeToRun({ runId }) {
        subscriptions += 1;
        if (subscriptions === 1) {
          yield { ...protocolEvent(1, { type: "run.started" }), runId };
          yield {
            ...protocolEvent(2, {
              type: "approval.requested",
              request: { id: "approval-1", title: "Continue?" },
            }),
            runId,
          };
          await closeApprovalStream.promise;
          return;
        }
        yield {
          ...protocolEvent(3, {
            type: "approval.resolved",
            approvalId: "approval-1",
            response: { decision: "approve" },
          }),
          runId,
        };
        yield { ...protocolEvent(4, { type: "run.completed" }), runId };
      },
      async cancelRun() {},
      async resumeRun() {
        return { runId: "run-approval" };
      },
    };
    const client = new AgentKitClient({ transport });
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Wait for approval",
    });
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").runs["run-approval"]?.status).toBe(
        "awaiting_approval",
      ),
    );
    await client.queueMessage({ threadId: "thread-1", text: queued.text });

    await client.resolveApproval({
      threadId: "thread-1",
      runId: "run-approval",
      approvalId: "approval-1",
      response: { decision: "approve" },
    });
    closeApprovalStream.resolve();
    await run.completed;
    await vi.waitFor(() => {
      expect(promoted).toHaveBeenCalledOnce();
      expect(client.getThread("thread-1").queuedMessages).toEqual([]);
    });
    expect(subscriptions).toBe(2);
  });

  it("reports replacement-run failures and permits an explicit reattach", async () => {
    const onError = vi.fn();
    let replacementSubscriptions = 0;
    const transport: AgentTransport = {
      capabilities: { approvals: true },
      async startRun() {
        return { runId: "run-interrupted" };
      },
      async *subscribeToRun({ runId }) {
        if (runId === "run-interrupted") {
          yield { ...protocolEvent(1, { type: "run.started" }), runId };
          yield {
            ...protocolEvent(2, {
              type: "approval.requested",
              request: { id: "approval-1", title: "Continue?" },
            }),
            runId,
          };
          return;
        }
        replacementSubscriptions += 1;
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        throw new AgentProtocolValidationError("replacement", "stream failed");
      },
      async cancelRun() {},
      async resumeRun() {
        return { runId: "run-resumed" };
      },
    };
    const client = new AgentKitClient({
      transport,
      reconnect: { attempts: 0 },
      onError,
    });
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Start",
    });
    await run.completed;

    await client.resolveApproval({
      threadId: "thread-1",
      runId: "run-interrupted",
      approvalId: "approval-1",
      response: { decision: "approve" },
    });

    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: "run_stream_failed" }),
      ),
    );
    expect(client.getSnapshot().error).toMatchObject({
      code: "run_stream_failed",
    });
    await expect(
      client.resubscribeRun("thread-1", "run-resumed"),
    ).rejects.toThrow("replacement: stream failed");
    expect(replacementSubscriptions).toBe(2);
  });

  it("keeps the deprecated approval transport bridge operational", async () => {
    const resolveApproval = vi.fn(async () => undefined);
    const client = new AgentKitClient({
      transport: {
        capabilities: { approvals: true },
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun() {},
        async cancelRun() {},
        resolveApproval,
      },
    });
    const input = {
      threadId: "thread-1",
      runId: "run-1",
      approvalId: "approval-1",
      response: { decision: "approve" as const },
    };

    await client.resolveApproval(input);

    expect(resolveApproval).toHaveBeenCalledWith(input, expect.any(Object));
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

  it("promotes queued work after the run it followed finishes during preparation", async () => {
    const terminal = Promise.withResolvers<void>();
    const capabilityDiscovery =
      Promise.withResolvers<
        Awaited<ReturnType<NonNullable<AgentTransport["discoverCapabilities"]>>>
      >();
    const capabilityDiscoveryStarted = Promise.withResolvers<void>();
    let currentTime = "2026-09-30T00:00:00.000Z";
    let discoveryCount = 0;
    const steerQueuedMessage = vi.fn(async () => undefined);
    const transport: AgentTransport = {
      async discoverCapabilities() {
        discoveryCount += 1;
        if (discoveryCount === 1) {
          return {
            protocol: negotiateAgentKitProtocolVersion(
              createAgentKitProtocolVersionOffer(),
            ),
            capabilities: [{ id: "messageQueue", state: "available" }],
            discoveredAt: currentTime,
            expiresAt: "2026-09-30T00:01:00.000Z",
          };
        }
        capabilityDiscoveryStarted.resolve();
        return capabilityDiscovery.promise;
      },
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun({ runId }) {
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
            createdAt: "2026-09-30T00:00:00.000Z",
          },
        };
      },
      steerQueuedMessage,
    };
    const client = new AgentKitClient({ transport, now: () => currentTime });
    const run = await client.sendMessage({ threadId: "thread-1", text: "Run" });
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").activeRunIds).toEqual(["run-1"]),
    );

    currentTime = "2026-09-30T00:02:00.000Z";
    const queuedMessage = client.queueMessage({
      threadId: "thread-1",
      text: "Run next",
    });
    await capabilityDiscoveryStarted.promise;
    terminal.resolve();
    await run.completed;
    capabilityDiscovery.resolve({
      protocol: negotiateAgentKitProtocolVersion(
        createAgentKitProtocolVersionOffer(),
      ),
      capabilities: [{ id: "messageQueue", state: "available" }],
      discoveredAt: currentTime,
    });
    await queuedMessage;

    await vi.waitFor(() => expect(steerQueuedMessage).toHaveBeenCalledOnce());
  });

  it("retries automatic queue promotion after the run slot becomes free", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const client = new AgentKitClient({
      transport: {
        capabilities: { messageQueue: true },
        async startRun() {
          return { runId: "run-1" };
        },
        async *subscribeToRun({ threadId, runId }) {
          yield {
            ...protocolEvent(1, { type: "run.started" }),
            threadId,
            runId,
          };
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
              id: "queued-1",
              threadId: input.threadId,
              text: input.text,
              createdAt: "2026-08-29T00:00:00.000Z",
            },
          };
        },
        async steerQueuedMessage() {
          attempts += 1;
          if (attempts < 8) throw new AgentKitRunSlotBusyError();
        },
      },
    });
    try {
      await client.queueMessage({ threadId: "thread-1", text: "Run next" });
      const run = await client.sendMessage({
        threadId: "thread-1",
        text: "Go",
      });
      await run.completed;

      const retryDelays = [500, 1_000, 2_000, 2_000, 2_000, 2_000, 2_000];
      for (const [index, delay] of retryDelays.entries()) {
        await vi.advanceTimersByTimeAsync(delay);
        expect(attempts).toBe(index + 2);
      }
      expect(client.getThread("thread-1").queuedMessages).toEqual([]);
    } finally {
      await client.dispose();
      vi.useRealTimers();
    }
  });

  it("expedites a busy queued promotion when run completion arrives in flight", async () => {
    vi.useFakeTimers();
    const runCompletion = Promise.withResolvers<void>();
    const runStarted = Promise.withResolvers<void>();
    const firstPromotionStarted = Promise.withResolvers<void>();
    const finishFirstPromotion = Promise.withResolvers<void>();
    const secondPromotionStarted = Promise.withResolvers<void>();
    let attempts = 0;
    const transport: AgentTransport = {
      capabilities: { approvals: true, messageQueue: true },
      async startRun() {
        return { runId: "run-1" };
      },
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
      async resolveApproval() {},
      async steerQueuedMessage() {
        attempts += 1;
        if (attempts === 1) {
          firstPromotionStarted.resolve();
          await finishFirstPromotion.promise;
          throw new AgentKitRunSlotBusyError();
        }
        secondPromotionStarted.resolve();
      },
      async *subscribeToRun({ runId }) {
        yield { ...protocolEvent(1, { type: "run.started" }), runId };
        if (runId === "run-1") {
          runStarted.resolve();
          await runCompletion.promise;
        }
        yield { ...protocolEvent(2, { type: "run.completed" }), runId };
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    try {
      const run = await client.sendMessage({
        threadId: "thread-1",
        text: "Finish this response first",
      });
      await runStarted.promise;
      await client.queueMessage({ threadId: "thread-1", text: "Run next" });
      await client.resolveApproval({
        threadId: "thread-1",
        runId: "run-1",
        approvalId: "approval-1",
        response: { decision: "approve" },
      });
      await firstPromotionStarted.promise;

      runCompletion.resolve();
      await run.completed;
      finishFirstPromotion.resolve();
      await secondPromotionStarted.promise;

      expect(attempts).toBe(2);
    } finally {
      await client.dispose();
      vi.useRealTimers();
    }
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

describe("stream integrity reports", () => {
  it("reports a replayed event without advancing the projection", async () => {
    const reports: AgentStreamIntegrityReport[] = [];
    const transport = createTransport([
      protocolEvent(1, { type: "run.started" }),
      protocolEvent(1, { type: "run.started" }),
      protocolEvent(2, { type: "run.completed" }),
    ]);
    const client = new AgentKitClient({
      transport,
      onIntegrityReport: (report) => reports.push(report),
    });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Review it",
    });
    await run.completed;

    expect(reports).toEqual([
      {
        code: "duplicate_event",
        threadId: "thread-1",
        runId: "run-1",
        expectedSequence: 2,
        receivedSequence: 1,
      },
    ]);
  });

  it("reports a sequence gap before the reducer rejects it", async () => {
    const reports: AgentStreamIntegrityReport[] = [];
    const transport = createTransport([
      protocolEvent(1, { type: "run.started" }),
      protocolEvent(4, { type: "run.completed" }),
    ]);
    const client = new AgentKitClient({
      transport,
      reconnect: { attempts: 0 },
      onIntegrityReport: (report) => reports.push(report),
    });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Review it",
    });
    await run.completed.catch(() => undefined);

    expect(reports).toContainEqual({
      code: "sequence_gap",
      threadId: "thread-1",
      runId: "run-1",
      expectedSequence: 2,
      receivedSequence: 4,
    });
  });

  it("reports a stream that closed without a terminal event", async () => {
    const reports: AgentStreamIntegrityReport[] = [];
    const transport = createTransport([
      protocolEvent(1, { type: "run.started" }),
    ]);
    const client = new AgentKitClient({
      transport,
      reconnect: { attempts: 0 },
      onIntegrityReport: (report) => reports.push(report),
    });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Review it",
    });
    await run.completed.catch(() => undefined);

    expect(reports).toContainEqual({
      code: "run_missing_terminal",
      threadId: "thread-1",
      runId: "run-1",
    });
  });

  it("reports a queued follow-up the transport can never promote", async () => {
    const reports: AgentStreamIntegrityReport[] = [];
    const transport = createTransport([
      protocolEvent(1, { type: "run.started" }),
      protocolEvent(2, {
        type: "queue.updated",
        messages: [
          {
            id: "queued-1",
            threadId: "thread-1",
            text: "And then deploy",
            createdAt: "2026-08-29T00:00:00.000Z",
          },
        ],
      }),
      protocolEvent(3, { type: "run.completed" }),
    ]);
    delete transport.steerQueuedMessage;
    const client = new AgentKitClient({
      transport,
      onIntegrityReport: (report) => reports.push(report),
    });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Review it",
    });
    await run.completed;

    expect(reports).toContainEqual({
      code: "queue_promotion_dropped",
      threadId: "thread-1",
      reason: "transport-cannot-steer",
    });
  });

  it("never lets a failing counter break the stream", async () => {
    const transport = createTransport([
      protocolEvent(1, { type: "run.started" }),
      protocolEvent(1, { type: "run.started" }),
      protocolEvent(2, { type: "run.completed" }),
    ]);
    const client = new AgentKitClient({
      transport,
      onIntegrityReport: () => {
        throw new Error("counter exploded");
      },
    });

    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Review it",
    });

    await expect(run.completed).resolves.toBeUndefined();
  });
});
