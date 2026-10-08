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
  AgentRunHandle,
  AgentKitRunSlotBusyError,
} from "./client.js";
import { hasActiveAgentRuns, type AgentThreadState } from "./state.js";

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

type AgentEventBody = Omit<
  AgentEvent,
  "id" | "threadId" | "runId" | "sequence" | "occurredAt"
>;

async function assistantPartsAfterToolHistory(input: {
  beforeToolEvents?: AgentEventBody[];
  afterToolEvents?: AgentEventBody[];
  createdParts?: AgentMessage["parts"];
  omitToolStarted?: boolean;
  toolInput?: unknown;
  toolOutput?: unknown;
  beforeFollowup?: (client: AgentKitClient) => void;
  beforeStartRun?: (client: AgentKitClient) => void;
  finalParts: AgentMessage["parts"];
}): Promise<AgentMessage[]> {
  const toolInput = Object.prototype.hasOwnProperty.call(input, "toolInput")
    ? input.toolInput
    : { query: "release" };
  const toolOutput = Object.prototype.hasOwnProperty.call(input, "toolOutput")
    ? input.toolOutput
    : "The release is ready.";
  let client!: AgentKitClient;
  let runNumber = 0;
  const startRun = vi.fn<AgentTransport["startRun"]>(async () => {
    const nextRunNumber = ++runNumber;
    if (nextRunNumber > 1) input.beforeStartRun?.(client);
    return { runId: `run-${nextRunNumber}` };
  });
  const transport: AgentTransport = {
    ...createTransport([]),
    startRun,
    async *subscribeToRun({ runId }) {
      const event = (sequence: number, body: AgentEventBody): AgentEvent =>
        ({
          ...body,
          id: `${runId}-event-${sequence}`,
          threadId: "thread-1",
          runId,
          sequence,
          occurredAt: "2026-08-29T00:00:00.000Z",
        }) as AgentEvent;
      if (runId !== "run-1") {
        yield event(1, { type: "run.started" });
        yield event(2, { type: "run.completed" });
        return;
      }

      let sequence = 1;
      yield event(sequence++, { type: "run.started" });
      yield event(sequence++, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: input.createdParts ?? [],
        },
      });
      for (const body of input.beforeToolEvents ?? []) {
        yield event(sequence++, body);
      }
      if (!input.omitToolStarted) {
        yield event(sequence++, {
          type: "tool.started",
          toolCall: {
            id: "call-search",
            name: "search",
            input: toolInput,
            messageId: "assistant-1",
            status: "running",
          },
        });
      }
      yield event(sequence++, {
        type: "tool.updated",
        toolCall: {
          id: "call-search",
          name: "search",
          input: toolInput,
          output: toolOutput,
          messageId: "assistant-1",
          status: "completed",
        },
      });
      for (const body of input.afterToolEvents ?? []) {
        yield event(sequence++, body);
      }
      yield event(sequence++, {
        type: "message.completed",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "complete",
          parts: input.finalParts,
        },
      });
      yield event(sequence, { type: "run.completed" });
    },
  };
  client = new AgentKitClient({ transport });

  await (
    await client.sendMessage({ threadId: "thread-1", text: "Search" })
  ).completed;
  input.beforeFollowup?.(client);
  await (
    await client.sendMessage({
      threadId: "thread-1",
      text: "What did you find?",
    })
  ).completed;

  const messages = startRun.mock.calls[1]![0].messages;
  await client.shutdown();
  return messages;
}

describe("AgentKitClient", () => {
  it("bounds nested tool-history values before serializing them", async () => {
    const messages = await assistantPartsAfterToolHistory({
      toolInput: { nested: { text: "x".repeat(1024 * 1024) } },
      toolOutput: { nested: { text: "\u0000".repeat(12_000) } },
      createdParts: [{ type: "text", text: "Search" }],
      finalParts: [{ type: "text", text: "Search" }],
    });
    const assistantMessage = messages.find(
      (message) => message.id === "assistant-1",
    );

    expect(assistantMessage?.parts).toEqual(
      expect.arrayContaining([
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-call",
          data: {
            id: "call-search",
            name: "search",
            inputText:
              "Tool input omitted from history because it exceeds 64 KiB.",
          },
        },
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-result",
          data: {
            id: "call-search",
            name: "search",
            resultText:
              "Tool output omitted from history because it exceeds 64 KiB.",
          },
        },
      ]),
    );
  });

  it("fails closed for cyclic and BigInt tool-history values", async () => {
    const cyclicInput: Record<string, unknown> = {};
    cyclicInput.self = cyclicInput;
    const messages = await assistantPartsAfterToolHistory({
      beforeFollowup(client) {
        const thread = client.getThread("thread-1");
        const toolCall = {
          id: "call-search",
          name: "search",
          messageId: "assistant-1",
          input: cyclicInput,
          output: { value: 1n },
          status: "completed" as const,
        };
        thread.events = [
          protocolEvent(1, { type: "run.started" }),
          protocolEvent(2, {
            type: "message.created",
            message: {
              id: "assistant-1",
              role: "assistant",
              status: "streaming",
              parts: [{ type: "text", text: "Search" }],
            },
          }),
          protocolEvent(3, {
            type: "tool.started",
            toolCall: { ...toolCall, status: "running" },
          }),
          protocolEvent(4, {
            type: "tool.updated",
            toolCall,
          }),
        ];
        thread.tools = { [toolCall.id]: toolCall };
      },
      beforeStartRun(client) {
        const thread = client.getThread("thread-1");
        thread.events = [];
        thread.tools = {};
      },
      finalParts: [{ type: "text", text: "Search" }],
    });
    const assistantMessage = messages.find(
      (message) => message.id === "assistant-1",
    );

    expect(assistantMessage?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mediaType: "application/x-agent-native-tool-call",
          data: {
            id: "call-search",
            name: "search",
            inputText:
              "Tool input omitted from history because it could not be serialized.",
          },
        }),
        expect.objectContaining({
          mediaType: "application/x-agent-native-tool-result",
          data: {
            id: "call-search",
            name: "search",
            resultText:
              "Tool output omitted from history because it could not be serialized.",
          },
        }),
      ]),
    );
  });

  it("shares a bounded work budget across nested omitted properties", async () => {
    let propertyReads = 0;
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 80; depth += 1) {
      const value: Record<string, unknown> = {};
      if (depth > 0) value.child = nested;
      for (let index = 0; index < 1_000; index += 1) {
        value[`omitted-${index}`] = undefined;
      }
      nested = new Proxy(value, {
        getOwnPropertyDescriptor(target, property) {
          propertyReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
    }

    const messages = await assistantPartsAfterToolHistory({
      beforeFollowup(client) {
        const thread = client.getThread("thread-1");
        const toolCall = {
          id: "call-search",
          name: "search",
          messageId: "assistant-1",
          input: nested,
          output: "The release is ready.",
          status: "completed" as const,
        };
        thread.events = [
          protocolEvent(1, { type: "run.started" }),
          protocolEvent(2, {
            type: "message.created",
            message: {
              id: "assistant-1",
              role: "assistant",
              status: "streaming",
              parts: [{ type: "text", text: "Search" }],
            },
          }),
          protocolEvent(3, {
            type: "tool.started",
            toolCall: { ...toolCall, status: "running" },
          }),
          protocolEvent(4, { type: "tool.updated", toolCall }),
        ];
        thread.tools = { [toolCall.id]: toolCall };
      },
      beforeStartRun(client) {
        const thread = client.getThread("thread-1");
        thread.events = [];
        thread.tools = {};
      },
      finalParts: [{ type: "text", text: "Search" }],
    });
    const assistantMessage = messages.find(
      (message) => message.id === "assistant-1",
    );

    expect(propertyReads).toBeLessThan(150_000);
    expect(assistantMessage?.parts).toContainEqual({
      type: "data",
      mediaType: "application/x-agent-native-tool-call",
      data: {
        id: "call-search",
        name: "search",
        inputText:
          "Tool input omitted from history because it could not be serialized.",
      },
    });
  });

  it("caps source reads for retained tool events", async () => {
    let eventReads = 0;
    let eventTypeReads = 0;
    let originalEvents: AgentEvent[] = [];
    let originalMessages: AgentMessage[] = [];
    const messages = await assistantPartsAfterToolHistory({
      beforeFollowup(client) {
        const thread = client.getThread("thread-1");
        originalEvents = thread.events;
        originalMessages = thread.messages;
        thread.messages = [
          {
            id: "assistant-first",
            role: "assistant",
            status: "complete",
            parts: [{ type: "text", text: "Earlier answer." }],
          },
          ...thread.messages,
        ];
        const instrument = (event: AgentEvent) =>
          new Proxy(event, {
            get(target, property, receiver) {
              if (property === "type") eventTypeReads += 1;
              return Reflect.get(target, property, receiver);
            },
          });
        const filler = instrument(protocolEvent(1, { type: "run.started" }));
        const toolCall = {
          id: "call-search",
          name: "search",
          input: { query: "release" },
          messageId: "assistant-1",
          status: "completed" as const,
          output: "The release is ready.",
        };
        const started = instrument(
          protocolEvent(1, {
            type: "tool.started",
            toolCall: { ...toolCall, status: "running" },
          }),
        );
        const updated = instrument(
          protocolEvent(1, { type: "tool.updated", toolCall }),
        );
        const assistantCreated = instrument(
          protocolEvent(1, {
            type: "message.created",
            message: {
              id: "assistant-1",
              role: "assistant",
              status: "streaming",
              parts: [{ type: "text", text: "Search" }],
            },
          }),
        );
        thread.events = new Proxy([] as AgentEvent[], {
          get(target, property, receiver) {
            if (property === "length") return 100_000;
            if (typeof property === "string" && /^\d+$/.test(property)) {
              eventReads += 1;
              if (property === "99999") return updated;
              if (property === "99998") return started;
              if (property === "99997") return assistantCreated;
              return filler;
            }
            return Reflect.get(target, property, receiver);
          },
        });
      },
      beforeStartRun(client) {
        client.getThread("thread-1").events = originalEvents;
        client.getThread("thread-1").messages = originalMessages;
      },
      finalParts: [{ type: "text", text: "Search" }],
    });

    expect(eventReads).toBeLessThanOrEqual(2_048);
    expect(eventTypeReads).toBeLessThanOrEqual(4_096);
    expect(
      messages.find((message) => message.id === "assistant-first")?.parts,
    ).toContainEqual({
      type: "text",
      text: "Some tool-call history was omitted to keep the added history under 256 KiB and 64 calls.",
    });
  });

  it("keeps an omission notice when no assistant history boundary remains", async () => {
    let originalEvents: AgentEvent[] = [];
    let originalMessages: AgentMessage[] = [];
    const messages = await assistantPartsAfterToolHistory({
      beforeFollowup(client) {
        const thread = client.getThread("thread-1");
        originalEvents = thread.events;
        originalMessages = thread.messages;
        thread.messages = [];
        const filler = protocolEvent(1, { type: "run.started" });
        thread.events = new Proxy([] as AgentEvent[], {
          get(target, property, receiver) {
            if (property === "length") return 100_000;
            if (typeof property === "string" && /^\d+$/.test(property)) {
              return filler;
            }
            return Reflect.get(target, property, receiver);
          },
        });
      },
      beforeStartRun(client) {
        const thread = client.getThread("thread-1");
        thread.events = originalEvents;
        thread.messages = originalMessages;
      },
      finalParts: [{ type: "text", text: "Search" }],
    });
    const omissionIndex = messages.findIndex(
      (message) =>
        message.role === "assistant" &&
        message.parts.some(
          (part) =>
            part.type === "text" &&
            part.text ===
              "Some tool-call history was omitted to keep the added history under 256 KiB and 64 calls.",
        ),
    );
    const userMessageIndex = messages.findIndex(
      (message) => message.role === "user",
    );

    expect(omissionIndex).toBeGreaterThanOrEqual(0);
    expect(omissionIndex).toBeLessThan(userMessageIndex);
  });

  it("caps source reads for retained tool entries", async () => {
    let statusReads = 0;
    const tools: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (let index = 0; index < 5_000; index += 1) {
      const id = `call-${index}`;
      Object.defineProperty(tools, id, {
        enumerable: true,
        value: {
          id,
          name: "search",
          messageId: "assistant-1",
          input: { index },
          output: { found: true },
          get status() {
            statusReads += 1;
            return "completed";
          },
        },
      });
    }
    let originalEvents: AgentEvent[] = [];
    let originalTools: AgentThreadState["tools"];
    const messages = await assistantPartsAfterToolHistory({
      beforeFollowup(client) {
        const thread = client.getThread("thread-1");
        originalEvents = thread.events;
        originalTools = thread.tools;
        thread.events = [];
        thread.tools = tools as typeof thread.tools;
      },
      beforeStartRun(client) {
        const thread = client.getThread("thread-1");
        thread.events = originalEvents;
        thread.tools = originalTools;
      },
      finalParts: [{ type: "text", text: "Search" }],
    });

    expect(statusReads).toBeLessThanOrEqual(4_096);
    expect(messages.at(-2)?.parts).toContainEqual({
      type: "text",
      text: "Some tool-call history was omitted to keep the added history under 256 KiB and 64 calls.",
    });
  });

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

  it("sends completed tool activity with its assistant message on the next turn", async () => {
    let runNumber = 0;
    const startRun = vi.fn<AgentTransport["startRun"]>(async () => ({
      runId: `run-${++runNumber}`,
    }));
    const transport: AgentTransport = {
      ...createTransport([]),
      startRun,
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
        if (runId !== "run-1") {
          yield event(1, { type: "run.started" });
          yield event(2, { type: "run.completed" });
          return;
        }

        let sequence = 0;
        const events: AgentEvent[] = [];
        const push = (
          body: Omit<
            AgentEvent,
            "id" | "threadId" | "runId" | "sequence" | "occurredAt"
          >,
        ) => events.push(event(++sequence, body));
        push({ type: "run.started" });
        push({
          type: "message.created",
          message: {
            id: "assistant-old",
            role: "assistant",
            status: "complete",
            parts: [{ type: "text", text: "An earlier answer." }],
          },
        });
        push({
          type: "message.created",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "streaming",
            parts: [{ type: "text", text: "I checked the document." }],
          },
        });
        const calls = [
          ...Array.from({ length: 70 }, (_, index) => ({
            id: `call-history-${index}`,
            name: "docs-search",
            input: { index },
            output: "Found one result.",
            status: "completed" as const,
          })),
          {
            id: "call-document",
            name: "get_document",
            input: { documentId: "doc-1" },
            output: { found: true },
            status: "completed" as const,
          },
          {
            id: "call-search-1",
            name: "docs-search",
            input: { query: "brief" },
            output: { found: true },
            status: "completed" as const,
          },
          {
            id: "call-search-2",
            name: "docs-search",
            input: { query: "roadmap" },
            error: { code: "tool_error", message: "Provider timed out." },
            status: "failed" as const,
          },
          {
            id: "call-large-input",
            name: "docs-search",
            input: "x".repeat(65 * 1024),
            output: "Search completed.",
            status: "completed" as const,
          },
          {
            id: "call-large-error",
            name: "docs-search",
            error: {
              code: "tool_error",
              message: "x".repeat(65 * 1024),
            },
            status: "failed" as const,
          },
          {
            id: "call-partial-error",
            name: "docs-search",
            input: { query: "partial" },
            output: { matches: ["first page"] },
            error: {
              code: "tool_error",
              message: "Second page timed out.",
            },
            status: "failed" as const,
          },
          {
            id: "call-void",
            name: "delete_draft",
            input: { draftId: "draft-1" },
            status: "completed" as const,
          },
          {
            id: "call-pending",
            name: "docs-search",
            input: { query: "not finished" },
            status: "running" as const,
          },
        ];
        for (const call of calls) {
          const { output, error, status, ...toolCall } = call;
          const messageId =
            call.id === "call-history-0" ? "assistant-old" : "assistant-1";
          push({
            type: "tool.started",
            toolCall: {
              ...toolCall,
              status: "running",
              messageId,
            },
          });
          if (status !== "running") {
            push({
              type: "tool.updated",
              toolCall: {
                ...toolCall,
                ...(output === undefined ? {} : { output }),
                ...(error === undefined ? {} : { error }),
                status,
                messageId,
              },
            });
          }
        }
        push({
          type: "message.completed",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "complete",
            parts: [{ type: "text", text: "I checked the document." }],
          },
        });
        push({ type: "run.completed" });
        yield* events;
      },
    };
    const client = new AgentKitClient({ transport });

    const firstRun = await client.sendMessage({
      threadId: "thread-1",
      text: "Check the document",
    });
    await firstRun.completed;
    const secondRun = await client.sendMessage({
      threadId: "thread-1",
      text: "Which tools did you call?",
    });
    await secondRun.completed;

    const secondRequest = startRun.mock.calls[1]![0];
    const assistantMessage = secondRequest.messages.find(
      (message) => message.id === "assistant-1",
    );
    const earlierAssistantMessage = secondRequest.messages.find(
      (message) => message.id === "assistant-old",
    );
    expect(assistantMessage?.parts).toEqual(
      expect.arrayContaining([
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-call",
          data: {
            id: "call-document",
            name: "get_document",
            input: { documentId: "doc-1" },
          },
        },
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-result",
          data: {
            id: "call-document",
            name: "get_document",
            result: { found: true },
          },
        },
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-call",
          data: {
            id: "call-search-1",
            name: "docs-search",
            input: { query: "brief" },
          },
        },
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-call",
          data: {
            id: "call-search-2",
            name: "docs-search",
            input: { query: "roadmap" },
          },
        },
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-call",
          data: {
            id: "call-large-input",
            name: "docs-search",
            inputText:
              "Tool input omitted from history because it exceeds 64 KiB.",
          },
        },
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-result",
          data: {
            id: "call-search-2",
            name: "docs-search",
            resultText: "Tool error: Provider timed out.",
            isError: true,
          },
        },
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-result",
          data: {
            id: "call-large-error",
            name: "docs-search",
            resultText:
              "Tool error omitted from history because it exceeds 64 KiB.",
            isError: true,
          },
        },
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-call",
          data: {
            id: "call-partial-error",
            name: "docs-search",
            input: { query: "partial" },
          },
        },
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-result",
          data: {
            id: "call-partial-error",
            name: "docs-search",
            result: { matches: ["first page"] },
            resultText: "Tool error: Second page timed out.",
            isError: true,
          },
        },
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-call",
          data: {
            id: "call-void",
            name: "delete_draft",
            input: { draftId: "draft-1" },
          },
        },
        {
          type: "data",
          mediaType: "application/x-agent-native-tool-result",
          data: {
            id: "call-void",
            name: "delete_draft",
            resultText: "Tool call completed without a recorded result.",
          },
        },
      ]),
    );
    expect(
      assistantMessage?.parts.filter((part) => part.type === "data"),
    ).toHaveLength(64 * 2);
    expect(earlierAssistantMessage?.parts).toContainEqual({
      type: "text",
      text: "Some tool-call history was omitted to keep the added history under 256 KiB and 64 calls.",
    });
    expect(assistantMessage?.parts).not.toContainEqual({
      type: "text",
      text: "Some tool-call history was omitted to keep the added history under 256 KiB and 64 calls.",
    });
    expect(assistantMessage?.parts).not.toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({ id: "call-pending" }),
      }),
    );
    expect(secondRequest.messages.at(-1)).toMatchObject({
      role: "user",
      parts: [{ type: "text", text: "Which tools did you call?" }],
    });
    expect(client.getThread("thread-1").messages).toContainEqual(
      expect.objectContaining({
        id: "assistant-1",
        parts: [{ type: "text", text: "I checked the document." }],
      }),
    );
    await client.shutdown();
  });

  it("keeps post-tool assistant text after the supporting result in history", async () => {
    let runNumber = 0;
    const startRun = vi.fn<AgentTransport["startRun"]>(async () => ({
      runId: `run-${++runNumber}`,
    }));
    const transport: AgentTransport = {
      ...createTransport([]),
      startRun,
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
        if (runId !== "run-1") {
          yield event(1, { type: "run.started" });
          yield event(2, { type: "run.completed" });
          return;
        }

        yield event(1, { type: "run.started" });
        yield event(2, {
          type: "message.created",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "streaming",
            parts: [],
          },
        });
        yield event(3, {
          type: "message.delta",
          messageId: "assistant-1",
          text: "I will search first. ",
        });
        yield event(4, {
          type: "tool.started",
          toolCall: {
            id: "call-search",
            name: "search",
            input: { query: "release" },
            messageId: "assistant-1",
            status: "running",
          },
        });
        yield event(5, {
          type: "tool.updated",
          toolCall: {
            id: "call-search",
            name: "search",
            input: { query: "release" },
            output: "The release is ready.",
            messageId: "assistant-1",
            status: "completed",
          },
        });
        yield event(6, {
          type: "message.delta",
          messageId: "assistant-1",
          text: "The release is ready to publish.",
        });
        yield event(7, {
          type: "tool.updated",
          toolCall: {
            id: "call-search",
            name: "search",
            input: { query: "release" },
            output: "The release is ready.",
            messageId: "assistant-1",
            status: "completed",
          },
        });
        yield event(8, {
          type: "message.completed",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "complete",
            parts: [
              { type: "text", text: "I will search first. " },
              { type: "text", text: "The release is ready to publish." },
            ],
          },
        });
        yield event(9, { type: "run.completed" });
      },
    };
    const client = new AgentKitClient({ transport });

    await (
      await client.sendMessage({ threadId: "thread-1", text: "Search" })
    ).completed;
    await (
      await client.sendMessage({
        threadId: "thread-1",
        text: "What did you find?",
      })
    ).completed;

    const assistantMessage = startRun.mock.calls[1]![0].messages.find(
      (message) => message.id === "assistant-1",
    );
    expect(assistantMessage?.parts).toEqual([
      { type: "text", text: "I will search first. " },
      {
        type: "data",
        mediaType: "application/x-agent-native-tool-call",
        data: {
          id: "call-search",
          name: "search",
          input: { query: "release" },
        },
      },
      {
        type: "data",
        mediaType: "application/x-agent-native-tool-result",
        data: {
          id: "call-search",
          name: "search",
          result: "The release is ready.",
        },
      },
      { type: "text", text: "The release is ready to publish." },
    ]);
    await client.shutdown();
  });

  it.each([
    {
      name: "reasoning visibility differs",
      afterToolEvents: [
        {
          type: "reasoning.delta",
          messageId: "assistant-1",
          text: "Check the release notes.",
        },
      ],
      finalParts: [
        {
          type: "reasoning",
          text: "Check the release notes.",
          visibility: "hidden",
        },
      ],
    },
    {
      name: "text format differs",
      afterToolEvents: [
        {
          type: "message.delta",
          messageId: "assistant-1",
          text: "The release is ready.",
          format: "markdown",
        },
      ],
      finalParts: [
        {
          type: "text",
          text: "The release is ready.",
          format: "plain",
        },
      ],
    },
    {
      name: "mixed content includes a citation",
      beforeToolEvents: [
        {
          type: "message.delta",
          messageId: "assistant-1",
          text: "Before the search. ",
        },
      ],
      afterToolEvents: [
        {
          type: "message.delta",
          messageId: "assistant-1",
          text: "After the search.",
        },
      ],
      finalParts: [
        { type: "text", text: "Before the search. " },
        { type: "citation", title: "Release notes" },
        { type: "text", text: "After the search." },
      ],
    },
    {
      name: "tool call event order is missing",
      omitToolStarted: true,
      afterToolEvents: [
        {
          type: "message.delta",
          messageId: "assistant-1",
          text: "The release is ready.",
        },
      ],
      finalParts: [{ type: "text", text: "The release is ready." }],
    },
  ])(
    "preserves final content and omits tool history when reconstruction is unsafe: $name",
    async ({
      beforeToolEvents,
      afterToolEvents,
      omitToolStarted,
      finalParts,
    }) => {
      const messages = await assistantPartsAfterToolHistory({
        beforeToolEvents,
        afterToolEvents,
        omitToolStarted,
        finalParts,
      });

      expect(
        messages.find((message) => message.id === "assistant-1")?.parts,
      ).toEqual(finalParts);
      expect(messages.at(-1)).toMatchObject({
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Tool-call history was omitted because its position could not be reconstructed safely.",
          },
        ],
      });
      expect(messages.at(-1)?.id).not.toBe("assistant-1");
    },
  );

  it("bounds inspection of reserved tool-history signatures", async () => {
    let descriptorReads = 0;
    const payload = Object.fromEntries([
      ["id", "existing-call"],
      ...Array.from({ length: 6_000 }, (_, index) => [`field-${index}`, index]),
    ]);
    const data = new Proxy(payload, {
      getOwnPropertyDescriptor(target, property) {
        descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const historyPart: AgentMessage["parts"][number] = {
      type: "data",
      mediaType: "application/x-agent-native-tool-call",
      data,
    };
    const finalParts: AgentMessage["parts"] = [historyPart];
    const messages = await assistantPartsAfterToolHistory({
      createdParts: finalParts,
      finalParts,
    });

    expect(descriptorReads).toBeLessThan(5 * 6_001);
    expect(
      messages
        .find((message) => message.id === "assistant-1")
        ?.parts.some(
          (part) =>
            part.type === "data" &&
            part.mediaType === "application/x-agent-native-tool-call" &&
            (part.data as Record<string, unknown>).id === "call-search",
        ),
    ).toBe(false);
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Tool-call history was omitted because its position could not be reconstructed safely.",
        },
      ],
    });
  });

  it.each([
    {
      name: "serialized bytes",
      data: { id: "existing-call", payload: "x".repeat(64 * 1024) },
    },
    {
      name: "nested depth",
      data: (() => {
        let nested: Record<string, unknown> = {};
        for (let depth = 0; depth < 300; depth += 1) {
          nested = { child: nested };
        }
        return { id: "existing-call", nested };
      })(),
    },
  ])(
    "fails closed when reserved history signatures exceed the $name budget",
    async ({ data }) => {
      const hasNestedValue = "nested" in data;
      const historyPart: AgentMessage["parts"][number] = {
        type: "data",
        mediaType: "application/x-agent-native-tool-call",
        data,
      };
      const finalParts: AgentMessage["parts"] = hasNestedValue
        ? []
        : [historyPart];
      const messages = await assistantPartsAfterToolHistory({
        createdParts: finalParts,
        finalParts,
        beforeFollowup(client) {
          if (!hasNestedValue) return;
          const thread = client.getThread("thread-1");
          const assistantMessage = thread.messages.find(
            (message) => message.id === "assistant-1",
          );
          expect(assistantMessage).toBeDefined();
          const parts = [historyPart];
          const message = {
            ...assistantMessage!,
            parts,
          };
          const toolCall = {
            id: "call-search",
            name: "search",
            messageId: "assistant-1",
            status: "completed" as const,
          };
          thread.messages = thread.messages.map((entry) =>
            entry.id === "assistant-1" ? message : entry,
          );
          thread.events = [
            protocolEvent(1, { type: "run.started" }),
            protocolEvent(2, {
              type: "message.created",
              message: {
                id: "assistant-1",
                role: "assistant",
                status: "streaming",
                parts,
              },
            }),
            protocolEvent(3, {
              type: "tool.started",
              toolCall: { ...toolCall, status: "running" },
            }),
            protocolEvent(4, { type: "tool.updated", toolCall }),
            protocolEvent(5, {
              type: "message.completed",
              message: {
                id: "assistant-1",
                role: "assistant",
                status: "complete",
                parts,
              },
            }),
            protocolEvent(6, { type: "run.completed" }),
          ];
          thread.tools = { [toolCall.id]: toolCall };
        },
      });

      expect(
        messages
          .find((message) => message.id === "assistant-1")
          ?.parts.some(
            (part) =>
              part.type === "data" &&
              part.mediaType === "application/x-agent-native-tool-call" &&
              (part.data as Record<string, unknown>).id === "call-search",
          ),
      ).toBe(false);
      expect(messages.at(-1)).toMatchObject({
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Tool-call history was omitted because its position could not be reconstructed safely.",
          },
        ],
      });
    },
  );

  it("preserves format across adjacent streamed text parts", async () => {
    const finalParts: AgentMessage["parts"] = [
      { type: "text", text: "**Ready**", format: "markdown" },
      { type: "text", text: " as plain text", format: "plain" },
    ];
    const messages = await assistantPartsAfterToolHistory({
      afterToolEvents: [
        {
          type: "message.delta",
          messageId: "assistant-1",
          text: "**Ready**",
          format: "markdown",
        },
        {
          type: "message.delta",
          messageId: "assistant-1",
          text: " as plain text",
          format: "plain",
        },
      ],
      finalParts,
    });

    expect(
      messages.find((message) => message.id === "assistant-1")?.parts,
    ).toEqual([
      {
        type: "data",
        mediaType: "application/x-agent-native-tool-call",
        data: {
          id: "call-search",
          name: "search",
          input: { query: "release" },
        },
      },
      {
        type: "data",
        mediaType: "application/x-agent-native-tool-result",
        data: {
          id: "call-search",
          name: "search",
          result: "The release is ready.",
        },
      },
      ...finalParts,
    ]);
  });

  it("preserves visibility and label across adjacent reasoning parts", async () => {
    const finalParts: AgentMessage["parts"] = [
      {
        type: "reasoning",
        text: "Visible analysis",
        visibility: "summary",
        label: "Summary",
      },
      {
        type: "reasoning",
        text: "Private analysis",
        visibility: "hidden",
        label: "Internal",
      },
    ];
    const messages = await assistantPartsAfterToolHistory({
      createdParts: finalParts,
      finalParts,
    });

    expect(
      messages.find((message) => message.id === "assistant-1")?.parts,
    ).toEqual([
      ...finalParts,
      {
        type: "data",
        mediaType: "application/x-agent-native-tool-call",
        data: {
          id: "call-search",
          name: "search",
          input: { query: "release" },
        },
      },
      {
        type: "data",
        mediaType: "application/x-agent-native-tool-result",
        data: {
          id: "call-search",
          name: "search",
          result: "The release is ready.",
        },
      },
    ]);
  });

  it("fails closed when created and completed tool-history payloads differ", async () => {
    const createdParts: AgentMessage["parts"] = [
      {
        type: "data",
        mediaType: "application/x-agent-native-tool-call",
        data: {
          id: "call-search",
          name: "search",
          input: { query: "stale" },
        },
      },
    ];
    const finalParts: AgentMessage["parts"] = [
      {
        type: "data",
        mediaType: "application/x-agent-native-tool-call",
        data: {
          id: "call-search",
          name: "search",
          input: { query: "authoritative" },
        },
      },
    ];
    const messages = await assistantPartsAfterToolHistory({
      createdParts,
      finalParts,
    });

    expect(
      messages.find((message) => message.id === "assistant-1")?.parts,
    ).toEqual(finalParts);
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Tool-call history was omitted because its position could not be reconstructed safely.",
        },
      ],
    });
  });

  it("caps object-result history after structured-history serialization", async () => {
    const startRun = vi.fn<AgentTransport["startRun"]>(async () => ({
      runId: "run-1",
    }));
    const transport: AgentTransport = {
      ...createTransport([]),
      startRun,
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
        if (runId !== "run-1") {
          yield event(1, { type: "run.started" });
          yield event(2, { type: "run.completed" });
          return;
        }

        let sequence = 0;
        const push = (
          body: Omit<
            AgentEvent,
            "id" | "threadId" | "runId" | "sequence" | "occurredAt"
          >,
        ) => event(++sequence, body);
        yield push({ type: "run.started" });
        yield push({
          type: "message.created",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "streaming",
            parts: [{ type: "text", text: "I searched four sources." }],
          },
        });
        for (let index = 0; index < 4; index++) {
          const toolCall = {
            id: `call-${index}`,
            name: "search",
            input: { query: "small query" },
            messageId: "assistant-1",
          };
          yield push({
            type: "tool.started",
            toolCall: { ...toolCall, status: "running" },
          });
          yield push({
            type: "tool.updated",
            toolCall: {
              ...toolCall,
              output: { value: "\\".repeat(31 * 1024) },
              status: "completed",
            },
          });
        }
        yield push({
          type: "message.completed",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "complete",
            parts: [{ type: "text", text: "I searched four sources." }],
          },
        });
        yield push({ type: "run.completed" });
      },
    };
    const client = new AgentKitClient({ transport });

    await (
      await client.sendMessage({
        threadId: "thread-1",
        text: "Search four sources",
      })
    ).completed;
    await (
      await client.sendMessage({
        threadId: "thread-1",
        text: "What did you find?",
      })
    ).completed;

    const assistantMessage = startRun.mock.calls[1]![0].messages.find(
      (message) => message.id === "assistant-1",
    );
    const dataParts = assistantMessage?.parts.filter(
      (part) => part.type === "data",
    );
    expect(dataParts).toHaveLength(2 * 2);
    expect(dataParts?.[0]).toMatchObject({ data: { id: "call-2" } });
    expect(assistantMessage?.parts).toContainEqual({
      type: "text",
      text: "Some tool-call history was omitted to keep the added history under 256 KiB and 64 calls.",
    });
    await client.shutdown();
  });

  it("fails closed for stateful JSON serialization hooks", async () => {
    const statefulJsonValue = (projection: Record<string, unknown>) => {
      let calls = 0;
      const toJSON = vi.fn(() => {
        calls += 1;
        if (calls > 1) throw new Error("toJSON was called more than once.");
        return projection;
      });
      const value = { original: true };
      Object.defineProperty(value, "toJSON", { value: toJSON });
      return { value, toJSON };
    };
    const input = statefulJsonValue({ safe: "input" });
    const output = statefulJsonValue({ safe: "output" });
    let runNumber = 0;
    const startRun = vi.fn<AgentTransport["startRun"]>(async () => ({
      runId: `run-${++runNumber}`,
    }));
    const transport: AgentTransport = {
      ...createTransport([]),
      startRun,
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
        if (runId !== "run-1") {
          yield event(1, { type: "run.started" });
          yield event(2, { type: "run.completed" });
          return;
        }

        yield event(1, { type: "run.started" });
        yield event(2, {
          type: "message.created",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "streaming",
            parts: [{ type: "text", text: "I searched the document." }],
          },
        });
        const toolCall = {
          id: "call-stateful",
          name: "search",
          input: input.value,
          messageId: "assistant-1",
        };
        yield event(3, {
          type: "tool.started",
          toolCall: { ...toolCall, status: "running" },
        });
        yield event(4, {
          type: "tool.updated",
          toolCall: {
            ...toolCall,
            output: output.value,
            status: "completed",
          },
        });
        yield event(5, {
          type: "message.completed",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "complete",
            parts: [{ type: "text", text: "I searched the document." }],
          },
        });
        yield event(6, { type: "run.completed" });
      },
    };
    const client = new AgentKitClient({ transport });

    await (
      await client.sendMessage({ threadId: "thread-1", text: "Search" })
    ).completed;
    await (
      await client.sendMessage({
        threadId: "thread-1",
        text: "What did you find?",
      })
    ).completed;

    const secondRequest = startRun.mock.calls[1]![0];
    const assistantMessage = secondRequest.messages.find(
      (message) => message.id === "assistant-1",
    );
    expect(assistantMessage?.parts).toContainEqual({
      type: "data",
      mediaType: "application/x-agent-native-tool-call",
      data: {
        id: "call-stateful",
        name: "search",
        inputText:
          "Tool input omitted from history because it could not be serialized.",
      },
    });
    expect(assistantMessage?.parts).toContainEqual({
      type: "data",
      mediaType: "application/x-agent-native-tool-result",
      data: {
        id: "call-stateful",
        name: "search",
        resultText:
          "Tool output omitted from history because it could not be serialized.",
      },
    });
    expect(input.toJSON).not.toHaveBeenCalled();
    expect(output.toJSON).not.toHaveBeenCalled();
    await client.shutdown();
  });

  it("deduplicates full history and supplies a missing history counterpart", async () => {
    let runNumber = 0;
    const startRun = vi.fn<AgentTransport["startRun"]>(async () => ({
      runId: `run-${++runNumber}`,
    }));
    const historyParts: AgentMessage["parts"] = [
      { type: "text", text: "I searched the document." },
      {
        type: "data",
        mediaType: "application/x-agent-native-tool-call",
        data: {
          id: "call-existing",
          name: "search",
          input: { query: "report" },
        },
      },
      {
        type: "data",
        mediaType: "application/x-agent-native-tool-result",
        data: { id: "call-existing", name: "search", result: "Found it." },
      },
      {
        type: "data",
        mediaType: "application/x-agent-native-tool-call",
        data: {
          id: "call-missing-result",
          name: "search",
          input: { query: "summary" },
        },
      },
    ];
    const transport: AgentTransport = {
      ...createTransport([]),
      startRun,
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
        if (runId !== "run-1") {
          yield event(1, { type: "run.started" });
          yield event(2, { type: "run.completed" });
          return;
        }

        yield event(1, { type: "run.started" });
        yield event(2, {
          type: "message.created",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "streaming",
            parts: historyParts,
          },
        });
        let sequence = 3;
        for (const toolCall of [
          {
            id: "call-existing",
            name: "search",
            input: { query: "report" },
            output: "Found it.",
            messageId: "assistant-1",
          },
          {
            id: "call-missing-result",
            name: "search",
            input: { query: "summary" },
            output: "Found the summary.",
            messageId: "assistant-1",
          },
        ]) {
          yield event(sequence++, {
            type: "tool.started",
            toolCall: {
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.input,
              messageId: toolCall.messageId,
              status: "running",
            },
          });
          yield event(sequence++, {
            type: "tool.updated",
            toolCall: { ...toolCall, status: "completed" },
          });
        }
        yield event(sequence++, {
          type: "message.completed",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "complete",
            parts: historyParts,
          },
        });
        yield event(sequence, { type: "run.completed" });
      },
    };
    const client = new AgentKitClient({ transport });

    await (
      await client.sendMessage({ threadId: "thread-1", text: "Search" })
    ).completed;
    await (
      await client.sendMessage({
        threadId: "thread-1",
        text: "What did you find?",
      })
    ).completed;

    const assistantMessage = startRun.mock.calls[1]![0].messages.find(
      (message) => message.id === "assistant-1",
    );
    const findHistoryParts = (mediaType: string, id: string) =>
      assistantMessage?.parts.filter((part) => {
        if (part.type !== "data" || part.mediaType !== mediaType) return false;
        const data = part.data;
        return (
          typeof data === "object" &&
          data !== null &&
          !Array.isArray(data) &&
          (data as Record<string, unknown>).id === id
        );
      }) ?? [];
    expect(
      findHistoryParts("application/x-agent-native-tool-call", "call-existing"),
    ).toHaveLength(1);
    expect(
      findHistoryParts(
        "application/x-agent-native-tool-result",
        "call-existing",
      ),
    ).toHaveLength(1);
    expect(
      findHistoryParts(
        "application/x-agent-native-tool-call",
        "call-missing-result",
      ),
    ).toHaveLength(1);
    expect(
      findHistoryParts(
        "application/x-agent-native-tool-result",
        "call-missing-result",
      ),
    ).toMatchObject([
      {
        data: { id: "call-missing-result", result: "Found the summary." },
      },
    ]);
    await client.shutdown();
  });

  it("caps serialized prior tool history by aggregate bytes", async () => {
    let runNumber = 0;
    const startRun = vi.fn<AgentTransport["startRun"]>(async () => ({
      runId: `run-${++runNumber}`,
    }));
    const transport: AgentTransport = {
      ...createTransport([]),
      startRun,
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
        if (runId !== "run-1") {
          yield event(1, { type: "run.started" });
          yield event(2, { type: "run.completed" });
          return;
        }

        let sequence = 0;
        const push = (
          body: Omit<
            AgentEvent,
            "id" | "threadId" | "runId" | "sequence" | "occurredAt"
          >,
        ) => event(++sequence, body);
        yield push({ type: "run.started" });
        yield push({
          type: "message.created",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "streaming",
            parts: [{ type: "text", text: "I searched four sources." }],
          },
        });
        for (let index = 0; index < 4; index++) {
          const toolCall = {
            id: `call-${index}`,
            name: "search",
            input: { query: "i".repeat(40 * 1024) },
            messageId: "assistant-1",
          };
          yield push({
            type: "tool.started",
            toolCall: { ...toolCall, status: "running" },
          });
          yield push({
            type: "tool.updated",
            toolCall: {
              ...toolCall,
              output: "o".repeat(40 * 1024),
              status: "completed",
            },
          });
        }
        yield push({
          type: "message.completed",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "complete",
            parts: [{ type: "text", text: "I searched four sources." }],
          },
        });
        yield push({ type: "run.completed" });
      },
    };
    const client = new AgentKitClient({ transport });

    await (
      await client.sendMessage({
        threadId: "thread-1",
        text: "Search four sources",
      })
    ).completed;
    await (
      await client.sendMessage({
        threadId: "thread-1",
        text: "What did you find?",
      })
    ).completed;

    const assistantMessage = startRun.mock.calls[1]![0].messages.find(
      (message) => message.id === "assistant-1",
    );
    const dataParts = assistantMessage?.parts.filter(
      (part) => part.type === "data",
    );
    expect(dataParts).toHaveLength(3 * 2);
    expect(dataParts?.[0]).toMatchObject({ data: { id: "call-1" } });
    expect(assistantMessage?.parts).toContainEqual({
      type: "text",
      text: "Some tool-call history was omitted to keep the added history under 256 KiB and 64 calls.",
    });
    await client.shutdown();
  });

  it("sizes added tool history without rescanning the prior transcript", async () => {
    let roleReads = 0;
    const priorMessages = Array.from(
      { length: 96 },
      (_, index) =>
        new Proxy<AgentMessage>(
          {
            id: `prior-${index}`,
            role: "user",
            status: "complete",
            parts: [{ type: "text", text: "Earlier conversation." }],
          },
          {
            get(target, property, receiver) {
              if (property === "role") roleReads += 1;
              return Reflect.get(target, property, receiver);
            },
          },
        ),
    );
    const messages = await assistantPartsAfterToolHistory({
      beforeFollowup(client) {
        const thread = client.getThread("thread-1");
        const assistantMessage = thread.messages.find(
          (message) => message.id === "assistant-1",
        );
        expect(assistantMessage).toBeDefined();

        let sequence = 0;
        const events: AgentEvent[] = [];
        const addEvent = (event: AgentEventBody) =>
          events.push(protocolEvent(++sequence, event));
        addEvent({ type: "run.started" });
        const parts: AgentMessage["parts"] = [
          { type: "text", text: "I searched the sources." },
        ];
        addEvent({
          type: "message.created",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "streaming",
            parts,
          },
        });
        const toolCalls = Array.from({ length: 64 }, (_, index) => ({
          id: `bounded-${index}`,
          name: "search",
          input: { query: `query-${index}` },
          output: { result: `result-${index}` },
          messageId: "assistant-1",
          status: "completed" as const,
        }));
        for (const toolCall of toolCalls) {
          addEvent({
            type: "tool.started",
            toolCall: { ...toolCall, status: "running" },
          });
          addEvent({ type: "tool.updated", toolCall });
        }
        addEvent({
          type: "message.completed",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "complete",
            parts,
          },
        });
        addEvent({ type: "run.completed" });

        thread.messages = [...priorMessages, assistantMessage!];
        thread.events = events;
        thread.tools = Object.fromEntries(
          toolCalls.map((toolCall) => [toolCall.id, toolCall]),
        );
      },
      finalParts: [{ type: "text", text: "I searched the sources." }],
    });
    const assistantMessage = messages.find(
      (message) => message.id === "assistant-1",
    );

    expect(roleReads).toBeLessThan(priorMessages.length * 8);
    expect(
      assistantMessage?.parts.filter(
        (part) =>
          part.type === "data" &&
          part.mediaType === "application/x-agent-native-tool-call",
      ),
    ).toHaveLength(64);
  });

  it("keeps projected tool history within its byte budget across messages", async () => {
    const byteLimit = 256 * 1024;
    const calls = Array.from({ length: 5 }, (_, index) => ({
      id: `bounded-${index}`,
      name: "search",
    }));
    const projectedHistory = (lastOutput: string) => {
      const outputs = [
        "x".repeat(63_000),
        "x".repeat(63_000),
        "x".repeat(63_000),
        "x".repeat(63_000),
        lastOutput,
      ];
      return calls.flatMap((call, index) => [
        {
          role: "assistant",
          content: [{ type: "tool-call", id: call.id, name: call.name }],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: call.id,
              toolName: call.name,
              content: outputs[index],
            },
          ],
        },
      ]);
    };
    const emptyProjectionBytes = JSON.stringify(projectedHistory("")).length;
    const lastOutput = "x".repeat(byteLimit + 1 - emptyProjectionBytes);
    expect(JSON.stringify(projectedHistory(lastOutput)).length).toBe(
      byteLimit + 1,
    );

    const messages = await assistantPartsAfterToolHistory({
      beforeFollowup(client) {
        const thread = client.getThread("thread-1");
        const assistantMessages = calls.map((call) => ({
          id: `assistant-${call.id}`,
          role: "assistant" as const,
          status: "complete" as const,
          parts: [{ type: "text" as const, text: "I searched the sources." }],
        }));
        const outputs = [
          "x".repeat(63_000),
          "x".repeat(63_000),
          "x".repeat(63_000),
          "x".repeat(63_000),
          lastOutput,
        ];
        let sequence = 0;
        const events: AgentEvent[] = [];
        const addEvent = (event: AgentEventBody) =>
          events.push(protocolEvent(++sequence, event));
        addEvent({ type: "run.started" });
        const toolCalls = calls.map((call, index) => ({
          ...call,
          output: outputs[index],
          messageId: `assistant-${call.id}`,
          status: "completed" as const,
        }));
        for (const [index, toolCall] of toolCalls.entries()) {
          const message = assistantMessages[index]!;
          addEvent({
            type: "message.created",
            message: { ...message, status: "streaming" },
          });
          addEvent({
            type: "tool.started",
            toolCall: { ...toolCall, status: "running" },
          });
          addEvent({ type: "tool.updated", toolCall });
          addEvent({
            type: "message.completed",
            message,
          });
        }
        addEvent({ type: "run.completed" });

        thread.messages = [
          ...thread.messages.filter((message) => message.role === "user"),
          ...assistantMessages,
        ];
        thread.events = events;
        thread.tools = Object.fromEntries(
          toolCalls.map((toolCall) => [toolCall.id, toolCall]),
        );
      },
      finalParts: [{ type: "text", text: "I searched the sources." }],
    });
    const historyCallParts = messages
      .flatMap((message) => message.parts)
      .filter(
        (part) =>
          part.type === "data" &&
          part.mediaType === "application/x-agent-native-tool-call",
      );

    expect(historyCallParts).toHaveLength(4);
    expect(
      messages.some((message) =>
        message.parts.some(
          (part) =>
            part.type === "text" &&
            part.text.includes("Some tool-call history was omitted"),
        ),
      ),
    ).toBe(true);
  });

  it.each(["id", "name"] as const)(
    "keeps an omission notice when every tool %s is too large for history",
    async (field) => {
      let runNumber = 0;
      const startRun = vi.fn<AgentTransport["startRun"]>(async () => ({
        runId: `run-${++runNumber}`,
      }));
      const transport: AgentTransport = {
        ...createTransport([]),
        startRun,
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
          if (runId !== "run-1") {
            yield event(1, { type: "run.started" });
            yield event(2, { type: "run.completed" });
            return;
          }

          const toolCall = {
            id: field === "id" ? "x".repeat(64 * 1024 + 1) : "call-1",
            name: field === "name" ? "x".repeat(64 * 1024 + 1) : "search",
            messageId: "assistant-1",
          };
          yield event(1, { type: "run.started" });
          yield event(2, {
            type: "message.created",
            message: {
              id: "assistant-1",
              role: "assistant",
              status: "streaming",
              parts: [{ type: "text", text: "I searched the document." }],
            },
          });
          yield event(3, {
            type: "tool.started",
            toolCall: { ...toolCall, status: "running" },
          });
          yield event(4, {
            type: "tool.updated",
            toolCall: {
              ...toolCall,
              output: "Found one result.",
              status: "completed",
            },
          });
          yield event(5, {
            type: "message.completed",
            message: {
              id: "assistant-1",
              role: "assistant",
              status: "complete",
              parts: [{ type: "text", text: "I searched the document." }],
            },
          });
          yield event(6, { type: "run.completed" });
        },
      };
      const client = new AgentKitClient({ transport });

      await (
        await client.sendMessage({
          threadId: "thread-1",
          text: "Search the document",
        })
      ).completed;
      await (
        await client.sendMessage({
          threadId: "thread-1",
          text: "What did you find?",
        })
      ).completed;

      const assistantMessage = startRun.mock.calls[1]![0].messages.find(
        (message) => message.id === "assistant-1",
      );
      expect(assistantMessage?.parts).toContainEqual({
        type: "text",
        text: "Some tool-call history was omitted to keep the added history under 256 KiB and 64 calls.",
      });
      expect(
        assistantMessage?.parts.filter((part) => part.type === "data"),
      ).toHaveLength(0);
      await client.shutdown();
    },
  );

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
    "parks the queue item before its %s durable append settles",
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
        expect(client.getThread("thread-1").queuedMessages).toEqual([
          expect.objectContaining({ text: message.text }),
        ]);
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
      expect(onLocalSubmit).toHaveBeenCalledOnce();
      const parked = client.getThread("thread-1").queuedMessages[0]!;
      expect(parked.text).toBe(message.text);
      const request = queueMessage.mock.calls[0]![0];
      expect(request.id).toBe(parked.id);
      expect(request).not.toHaveProperty("onLocalSubmit");
      expect(structuredClone(request)).toEqual(request);

      const failure = new Error("Queue write failed");
      if (outcome === "accepted") queued.resolve({ message });
      else queued.reject(failure);
      const result = await submission;
      if (outcome === "accepted") {
        expect(result).toEqual({ value: message });
        expect(onLocalSubmit).toHaveBeenCalledOnce();
        expect(client.getThread("thread-1").queuedMessages).toEqual([message]);
      } else {
        expect(result).toEqual({ error: failure });
        expect(onLocalSubmit).toHaveBeenCalledOnce();
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

  it("lets the host persist a filtered message snapshot", async () => {
    const persistThreadSnapshot = vi.fn(async () => undefined);
    const transport = createTransport([]);
    transport.persistThreadSnapshot = persistThreadSnapshot;
    const client = new AgentKitClient({ transport });
    const transcript: AgentMessage = {
      id: "voice-transcript-1",
      role: "user",
      parts: [{ type: "text", text: "Voice transcript" }],
      status: "complete",
    };

    await client.persistThreadSnapshot("thread-1", [transcript]);

    expect(persistThreadSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        snapshot: expect.objectContaining({ messages: [transcript] }),
      }),
      expect.anything(),
    );
    await client.shutdown();
  });

  it("reloads the durable annotation after a concurrent snapshot update", async () => {
    const original = {
      id: "annotation-1",
      kind: "source",
      label: "Original source",
    };
    const snapshotEdit = {
      id: "annotation-1",
      kind: "source",
      label: "Snapshot edit",
    };
    const concurrentEdit = {
      id: "annotation-1",
      kind: "source",
      label: "Concurrent edit",
    };
    let persistedSnapshot: AgentThreadSnapshot = {
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      messages: [],
      annotations: [{ messageId: "assistant-1", annotation: original }],
    };
    const transport = createTransport([
      protocolEvent(1, { type: "run.started" }),
      protocolEvent(2, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [],
          status: "streaming",
        },
      }),
      protocolEvent(3, {
        type: "annotation.updated",
        messageId: "assistant-1",
        annotation: snapshotEdit,
      }),
      protocolEvent(4, {
        type: "message.completed",
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Answer." }],
          status: "complete",
        },
      }),
      protocolEvent(5, { type: "run.completed" }),
    ]);
    const observedAnnotations: string[] = [];
    const getThreadSnapshot = vi.fn(async () => {
      observedAnnotations.push(
        persistedSnapshot.annotations?.[0]?.annotation.label ?? "",
      );
      return persistedSnapshot;
    });
    transport.getThreadSnapshot = getThreadSnapshot;
    let persistedAnnotations: AgentThreadSnapshot["annotations"];
    transport.persistThreadSnapshot = async ({ snapshot }) => {
      persistedAnnotations = snapshot.annotations;
      // Simulate the server preserving a later annotation edit on CAS retry.
      persistedSnapshot = {
        ...snapshot,
        annotations: [{ messageId: "assistant-1", annotation: concurrentEdit }],
      };
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    const run = await client.sendMessage({ threadId: "thread-1", text: "Go" });
    await run.completed;

    expect(persistedAnnotations).toEqual([
      { messageId: "assistant-1", annotation: snapshotEdit },
    ]);
    expect(getThreadSnapshot).toHaveBeenCalledTimes(2);
    expect(observedAnnotations).toEqual(["Original source", "Concurrent edit"]);
    expect(client.getThread("thread-1").annotations).toEqual({
      "annotation-1": concurrentEdit,
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

  it("keeps snapshot approval runs active when activeRunIds is missing", async () => {
    const subscriptionStarted = Promise.withResolvers<void>();
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      approvals: [
        {
          request: { id: "approval-1", title: "Continue?" },
          status: "pending",
          runId: "run-approval",
        },
      ],
    });
    transport.subscribeToRun = async function* ({ signal }) {
      subscriptionStarted.resolve();
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    };
    const client = new AgentKitClient({ transport });

    try {
      const thread = await client.loadThread("thread-1");

      expect(thread.activeRunIds).toEqual(["run-approval"]);
      expect(thread.approvalRunIds["approval-1"]).toBe("run-approval");
      expect(thread.approvals["approval-1"]).toMatchObject({
        title: "Continue?",
      });
      expect(hasActiveAgentRuns(thread)).toBe(true);
      await subscriptionStarted.promise;
    } finally {
      await client.dispose();
    }
  });

  it("does not reactivate a completed run from a stale approval snapshot", async () => {
    const transport = createTransport([]);
    const getRun = vi.fn(async () => ({
      id: "run-approval",
      threadId: "thread-1",
      status: "completed" as const,
      lastSequence: 1,
      completedAt: "2026-08-29T00:00:01.000Z",
    }));
    transport.getRun = getRun;
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      events: [
        {
          ...protocolEvent(1, {
            type: "approval.requested",
            request: { id: "approval-1", title: "Continue?" },
          }),
          runId: "run-approval",
        },
      ],
      approvals: [
        {
          request: { id: "approval-1", title: "Continue?" },
          status: "pending",
          runId: "run-approval",
        },
      ],
    });
    const client = new AgentKitClient({ transport });

    try {
      const thread = await client.loadThread("thread-1");

      expect(getRun).toHaveBeenCalledOnce();
      expect(thread.activeRunIds).toEqual([]);
      expect(hasActiveAgentRuns(thread)).toBe(false);
    } finally {
      await client.dispose();
    }
  });

  it("honors an empty active-run snapshot over an incomplete run event log", async () => {
    const subscribeToRun = vi.fn(async function* () {});
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      events: [protocolEvent(1, { type: "run.started" })],
      activeRunIds: [],
    });
    transport.subscribeToRun = subscribeToRun;
    const client = new AgentKitClient({ transport });

    try {
      const thread = await client.loadThread("thread-1");

      expect(thread.runs["run-1"]?.status).toBe("running");
      expect(thread.activeRunIds).toEqual([]);
      expect(hasActiveAgentRuns(thread)).toBe(false);
      expect(subscribeToRun).not.toHaveBeenCalled();
    } finally {
      await client.dispose();
    }
  });

  it("lets an authoritative empty active-run refresh retire a stale baseline run", async () => {
    const subscriptionStarted = Promise.withResolvers<void>();
    let snapshotReads = 0;
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      return {
        id: "thread-1",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:02.000Z",
        messages: [],
        events: [protocolEvent(1, { type: "run.started" })],
        runs: [
          {
            id: "run-1",
            threadId: "thread-1",
            status: "running",
            lastSequence: 1,
          },
        ],
        activeRunIds: snapshotReads === 1 ? ["run-1"] : [],
      };
    };
    transport.getRun = async () => ({
      id: "run-1",
      threadId: "thread-1",
      status: "running",
      lastSequence: 1,
    });
    transport.subscribeToRun = async function* ({ signal }) {
      subscriptionStarted.resolve();
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
    };
    const client = new AgentKitClient({ transport });

    try {
      await client.loadThread("thread-1");
      await subscriptionStarted.promise;
      expect(client.getThread("thread-1").activeRunIds).toEqual(["run-1"]);

      const refreshed = await client.loadThread("thread-1");

      expect(refreshed.activeRunIds).toEqual([]);
      expect(hasActiveAgentRuns(refreshed)).toBe(false);
    } finally {
      await client.dispose();
    }
  });

  it("preserves a run started locally during an authoritative empty refresh", async () => {
    const refreshRequested = Promise.withResolvers<void>();
    const refresh = Promise.withResolvers<AgentThreadSnapshot>();
    const subscriptionStarted = Promise.withResolvers<void>();
    let snapshotReads = 0;
    let completion: Promise<void> | undefined;
    const emptySnapshot: AgentThreadSnapshot = {
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      events: [],
      activeRunIds: [],
    };
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      if (snapshotReads === 2) {
        refreshRequested.resolve();
        return refresh.promise;
      }
      return emptySnapshot;
    };
    transport.subscribeToRun = async function* ({ signal }) {
      subscriptionStarted.resolve();
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
    };
    const client = new AgentKitClient({ transport });

    try {
      await client.loadThread("thread-1");
      const loading = client.loadThread("thread-1");
      await refreshRequested.promise;

      const run = await client.sendMessage({
        threadId: "thread-1",
        text: "Start while refreshing",
        queueWhileRunning: false,
      });
      completion = run.completed;
      await subscriptionStarted.promise;
      refresh.resolve(emptySnapshot);
      const refreshed = await loading;

      expect(refreshed.activeRunIds).toEqual(["run-1"]);
      expect(hasActiveAgentRuns(refreshed)).toBe(true);
    } finally {
      refresh.resolve(emptySnapshot);
      await client.dispose();
      await completion?.catch(() => undefined);
    }
  });

  it("preserves an approval run resumed during an authoritative empty refresh", async () => {
    const refreshRequested = Promise.withResolvers<void>();
    const refresh = Promise.withResolvers<AgentThreadSnapshot>();
    const resumedSubscription = Promise.withResolvers<void>();
    let subscriptions = 0;
    let completion: Promise<void> | undefined;
    const emptySnapshot: AgentThreadSnapshot = {
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      activeRunIds: [],
    };
    const transport: AgentTransport = {
      ...createTransport([]),
      capabilities: {
        resumableRuns: true,
        messageQueue: true,
        approvals: true,
      },
      async *subscribeToRun({ runId, signal }) {
        subscriptions += 1;
        if (subscriptions === 1) {
          yield {
            ...protocolEvent(1, { type: "run.started" }),
            runId,
          };
          yield {
            ...protocolEvent(2, {
              type: "approval.requested",
              request: { id: "approval-1", title: "Continue?" },
            }),
            runId,
          };
          return;
        }
        resumedSubscription.resolve();
        await new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      async resumeRun() {
        return { runId: "run-1" };
      },
      async getThreadSnapshot() {
        refreshRequested.resolve();
        return refresh.promise;
      },
    };
    const client = new AgentKitClient({ transport });

    try {
      const initialRun = await client.sendMessage({
        threadId: "thread-1",
        text: "Wait for approval",
      });
      completion = initialRun.completed;
      await completion;
      expect(client.getThread("thread-1")).toMatchObject({
        activeRunIds: ["run-1"],
        runs: { "run-1": { status: "awaiting_approval" } },
      });

      const loading = client.loadThread("thread-1");
      await refreshRequested.promise;

      await client.resolveApproval({
        threadId: "thread-1",
        runId: "run-1",
        approvalId: "approval-1",
        response: { decision: "approve" },
      });
      await resumedSubscription.promise;
      expect(client.getThread("thread-1").runs["run-1"]?.status).toBe(
        "running",
      );

      refresh.resolve(emptySnapshot);
      const refreshed = await loading;

      expect(refreshed.activeRunIds).toEqual(["run-1"]);
      expect(refreshed.runs["run-1"]?.status).toBe("running");
      expect(hasActiveAgentRuns(refreshed)).toBe(true);
    } finally {
      refresh.resolve(emptySnapshot);
      await client.dispose();
      await completion?.catch(() => undefined);
    }
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

  it("replays an active getRun from accepted events when its cursor is stale", async () => {
    const subscribed = Promise.withResolvers<number>();
    const replay = Promise.withResolvers<void>();
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      events: [
        protocolEvent(1, { type: "run.started" }),
        protocolEvent(2, {
          type: "approval.requested",
          request: { id: "approval-1", title: "Continue?" },
        }),
      ],
      runs: [
        {
          id: "run-1",
          threadId: "thread-1",
          status: "running",
          lastSequence: 7,
        },
      ],
      activeRunIds: ["run-1"],
    });
    transport.getRun = async () => ({
      id: "run-1",
      threadId: "thread-1",
      status: "running",
      lastSequence: 1,
    });
    transport.subscribeToRun = async function* ({ afterSequence }) {
      subscribed.resolve(afterSequence ?? 0);
      await replay.promise;
      yield protocolEvent(3, { type: "run.completed" });
    };
    const client = new AgentKitClient({ transport });

    try {
      const thread = await client.loadThread("thread-1");
      await expect(subscribed.promise).resolves.toBe(2);
      expect(thread.runs["run-1"]).toMatchObject({
        status: "awaiting_approval",
        lastSequence: 2,
        startedAt: "2026-08-29T00:00:00.000Z",
      });
      expect(thread.activeRunIds).toEqual(["run-1"]);

      replay.resolve();
      await vi.waitFor(() =>
        expect(client.getThread("thread-1").runs["run-1"]).toMatchObject({
          status: "completed",
          lastSequence: 3,
        }),
      );
      expect(client.getThread("thread-1").activeRunIds).toEqual([]);
    } finally {
      replay.resolve();
      await client.dispose();
    }
  });

  it("replays from accepted events when a pending snapshot run cursor is stale", async () => {
    const subscribed = Promise.withResolvers<number>();
    const replayEvents = [
      protocolEvent(3, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "Recovered",
      }),
      protocolEvent(4, {
        type: "message.delta",
        messageId: "assistant-1",
        text: " response.",
      }),
      protocolEvent(5, {
        type: "message.completed",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", text: "Recovered response." }],
        },
      }),
      protocolEvent(6, {
        type: "run.status",
        status: "awaiting_input",
      }),
      protocolEvent(7, { type: "run.completed" }),
    ];
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          createdAt: "2026-08-29T00:00:01.000Z",
          parts: [],
        },
      ],
      events: [
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
      ],
      runs: [
        {
          id: "run-1",
          threadId: "thread-1",
          status: "running",
          lastSequence: 7,
        },
      ],
      activeRunIds: ["run-1"],
    });
    transport.getRun = async () => ({
      id: "run-1",
      threadId: "thread-1",
      status: "completed",
      lastSequence: 7,
      completedAt: "2026-08-29T00:00:07.000Z",
    });
    transport.subscribeToRun = async function* ({ afterSequence }) {
      subscribed.resolve(afterSequence ?? 0);
      yield* replayEvents;
    };
    const client = new AgentKitClient({ transport });

    try {
      const thread = await client.loadThread("thread-1");
      await expect(subscribed.promise).resolves.toBe(2);
      expect(thread.runs["run-1"]).toMatchObject({
        status: "completed",
        lastSequence: 2,
      });
      expect(thread.activeRunIds).toEqual([]);

      await vi.waitFor(() =>
        expect(client.getThread("thread-1").runs["run-1"]?.lastSequence).toBe(
          7,
        ),
      );
      expect(client.getThread("thread-1").messages).toContainEqual(
        expect.objectContaining({
          id: "assistant-1",
          status: "complete",
          parts: [{ type: "text", text: "Recovered response." }],
        }),
      );
      expect(client.getThread("thread-1").activeRunIds).toEqual([]);
    } finally {
      await client.dispose();
    }
  });

  it("catches up a terminal run already present in the thread snapshot", async () => {
    const subscribed = Promise.withResolvers<number>();
    const replay = Promise.withResolvers<void>();
    const getRun = vi.fn(async () => null);
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      events: [protocolEvent(1, { type: "run.started" })],
      runs: [
        {
          id: "run-1",
          threadId: "thread-1",
          status: "completed",
          lastSequence: 3,
        },
      ],
      activeRunIds: [],
    });
    transport.getRun = getRun;
    transport.subscribeToRun = async function* ({ afterSequence }) {
      subscribed.resolve(afterSequence ?? 0);
      await replay.promise;
      yield protocolEvent(2, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: [],
        },
      });
      yield protocolEvent(3, { type: "run.completed" });
    };
    const client = new AgentKitClient({ transport });

    try {
      await client.loadThread("thread-1");
      await expect(subscribed.promise).resolves.toBe(1);
      expect(getRun).not.toHaveBeenCalled();
      expect(client.getThread("thread-1").runs["run-1"]).toMatchObject({
        status: "completed",
        lastSequence: 1,
      });
      expect(client.getThread("thread-1").activeRunIds).toEqual([]);

      replay.resolve();
      await vi.waitFor(() =>
        expect(client.getThread("thread-1").runs["run-1"]?.lastSequence).toBe(
          3,
        ),
      );
      expect(client.getThread("thread-1").messages).toContainEqual(
        expect.objectContaining({
          id: "assistant-1",
          status: "complete",
        }),
      );
    } finally {
      replay.resolve();
      await client.dispose();
    }
  });

  it("keeps the newest catch-up target across held replay refreshes", async () => {
    const subscribed = Promise.withResolvers<number>();
    const replay = Promise.withResolvers<void>();
    let snapshotReads = 0;
    let subscriptions = 0;
    const event = (sequence: number, body: AgentEventBody): AgentEvent => ({
      ...protocolEvent(sequence, body),
      runId: "run-approval",
    });
    const replayEvents = [
      event(3, {
        type: "approval.resolved",
        approvalId: "approval-1",
        response: { decision: "approve", optionIds: ["approve"] },
      }),
      event(4, {
        type: "message.created",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "streaming",
          parts: [],
        },
      }),
      event(5, {
        type: "message.delta",
        messageId: "assistant-1",
        text: "Recovered response.",
      }),
      event(6, {
        type: "message.completed",
        message: {
          id: "assistant-1",
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", text: "Recovered response." }],
        },
      }),
      event(7, { type: "run.status", status: "awaiting_input" }),
      event(8, { type: "run.status", status: "awaiting_input" }),
      event(9, { type: "run.completed" }),
    ];
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => {
      snapshotReads += 1;
      const hasStaleTerminalRow = snapshotReads === 4;
      return {
        id: "thread-1",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:02.000Z",
        messages: hasStaleTerminalRow
          ? [
              {
                id: "assistant-1",
                role: "assistant",
                status: "complete",
                parts: [{ type: "text", text: "Recovered response." }],
              },
            ]
          : [],
        events: [
          event(1, { type: "run.started" }),
          event(2, {
            type: "approval.requested",
            request: { id: "approval-1", title: "Continue?" },
          }),
          ...(hasStaleTerminalRow ? replayEvents.slice(0, -1) : []),
        ],
        ...(hasStaleTerminalRow
          ? {
              runs: [
                {
                  id: "run-approval",
                  threadId: "thread-1",
                  status: "completed" as const,
                  lastSequence: 7,
                },
              ],
            }
          : {}),
        activeRunIds: [],
        ...(hasStaleTerminalRow
          ? {}
          : {
              approvals: [
                {
                  request: { id: "approval-1", title: "Continue?" },
                  status: "pending" as const,
                  runId: "run-approval",
                },
              ],
            }),
      };
    };
    transport.getRun = vi.fn(async () => ({
      id: "run-approval",
      threadId: "thread-1",
      status: "completed",
      lastSequence: snapshotReads === 2 ? 9 : 7,
      completedAt: `2026-08-29T00:00:0${snapshotReads === 2 ? 9 : 7}.000Z`,
    }));
    transport.subscribeToRun = async function* ({ afterSequence }) {
      subscriptions += 1;
      subscribed.resolve(afterSequence ?? 0);
      await replay.promise;
      yield* replayEvents;
    };
    const client = new AgentKitClient({ transport });

    try {
      await client.loadThread("thread-1");
      await expect(subscribed.promise).resolves.toBe(2);
      expect(client.getThread("thread-1").runs["run-approval"]).toMatchObject({
        status: "completed",
        lastSequence: 2,
      });
      expect(client.getThread("thread-1").activeRunIds).toEqual([]);
      expect(hasActiveAgentRuns(client.getThread("thread-1"))).toBe(false);

      await client.loadThread("thread-1");
      expect(snapshotReads).toBe(2);
      expect(subscriptions).toBe(1);
      expect(client.getThread("thread-1").runs["run-approval"]).toMatchObject({
        status: "completed",
        lastSequence: 2,
      });

      await client.loadThread("thread-1");
      expect(snapshotReads).toBe(3);
      expect(subscriptions).toBe(1);
      expect(client.getThread("thread-1").runs["run-approval"]).toMatchObject({
        status: "completed",
        lastSequence: 2,
      });

      await client.loadThread("thread-1");
      expect(snapshotReads).toBe(4);
      expect(transport.getRun).toHaveBeenCalledTimes(3);
      expect(subscriptions).toBe(1);
      expect(client.getThread("thread-1").runs["run-approval"]).toMatchObject({
        status: "completed",
        lastSequence: 8,
      });

      replay.resolve();
      await vi.waitFor(() =>
        expect(
          client.getThread("thread-1").runs["run-approval"]?.lastSequence,
        ).toBe(9),
      );

      const thread = client.getThread("thread-1");
      expect(snapshotReads).toBe(4);
      expect(thread.runs["run-approval"]).toMatchObject({
        status: "completed",
        lastSequence: 9,
      });
      expect(thread.activeRunIds).toEqual([]);
      expect(hasActiveAgentRuns(thread)).toBe(false);
      expect(thread.approvals).toEqual({});
      expect(thread.messages).toContainEqual(
        expect.objectContaining({
          id: "assistant-1",
          status: "complete",
          parts: [{ type: "text", text: "Recovered response." }],
        }),
      );
    } finally {
      replay.resolve();
      await client.dispose();
    }
  });

  it("keeps terminal status when catch-up ends before its terminal event", async () => {
    const reports: AgentStreamIntegrityReport[] = [];
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      events: [
        {
          ...protocolEvent(1, { type: "run.started" }),
          runId: "run-approval",
        },
        {
          ...protocolEvent(2, {
            type: "approval.requested",
            request: { id: "approval-1", title: "Continue?" },
          }),
          runId: "run-approval",
        },
      ],
      activeRunIds: [],
      approvals: [
        {
          request: { id: "approval-1", title: "Continue?" },
          status: "pending",
          runId: "run-approval",
        },
      ],
    });
    transport.getRun = async () => ({
      id: "run-approval",
      threadId: "thread-1",
      status: "completed",
      lastSequence: 7,
    });
    transport.subscribeToRun = async function* ({ afterSequence }) {
      expect(afterSequence).toBe(2);
      yield {
        ...protocolEvent(3, {
          type: "approval.resolved",
          approvalId: "approval-1",
          response: { decision: "approve", optionIds: ["approve"] },
        }),
        runId: "run-approval",
      };
    };
    const client = new AgentKitClient({
      transport,
      onIntegrityReport: (report) => reports.push(report),
    });

    try {
      await client.loadThread("thread-1");
      await vi.waitFor(() =>
        expect(client.getSnapshot().connection).toBe("error"),
      );

      expect(client.getThread("thread-1").runs["run-approval"]).toMatchObject({
        status: "completed",
        lastSequence: 3,
      });
      expect(client.getThread("thread-1").activeRunIds).toEqual([]);
      expect(hasActiveAgentRuns(client.getThread("thread-1"))).toBe(false);
      expect(reports).toContainEqual(
        expect.objectContaining({ code: "run_missing_terminal" }),
      );
    } finally {
      await client.dispose();
    }
  });

  it("keeps terminal status and the accepted cursor when catch-up has a sequence gap", async () => {
    const reports: AgentStreamIntegrityReport[] = [];
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      messages: [],
      events: [
        {
          ...protocolEvent(1, { type: "run.started" }),
          runId: "run-approval",
        },
        {
          ...protocolEvent(2, {
            type: "approval.requested",
            request: { id: "approval-1", title: "Continue?" },
          }),
          runId: "run-approval",
        },
      ],
      activeRunIds: [],
      approvals: [
        {
          request: { id: "approval-1", title: "Continue?" },
          status: "pending",
          runId: "run-approval",
        },
      ],
    });
    transport.getRun = async () => ({
      id: "run-approval",
      threadId: "thread-1",
      status: "completed",
      lastSequence: 7,
    });
    transport.subscribeToRun = async function* ({ afterSequence }) {
      expect(afterSequence).toBe(2);
      yield {
        ...protocolEvent(4, {
          type: "message.created",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "streaming",
            parts: [],
          },
        }),
        runId: "run-approval",
      };
    };
    const client = new AgentKitClient({
      transport,
      onIntegrityReport: (report) => reports.push(report),
    });

    try {
      await client.loadThread("thread-1");
      await vi.waitFor(() =>
        expect(client.getSnapshot().connection).toBe("error"),
      );

      expect(client.getThread("thread-1").runs["run-approval"]).toMatchObject({
        status: "completed",
        lastSequence: 2,
      });
      expect(client.getThread("thread-1").activeRunIds).toEqual([]);
      expect(hasActiveAgentRuns(client.getThread("thread-1"))).toBe(false);
      expect(reports).toContainEqual(
        expect.objectContaining({ code: "sequence_gap" }),
      );
    } finally {
      await client.dispose();
    }
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
      events: [
        {
          ...protocolEvent(1, { type: "run.completed" }),
          runId: "run-complete",
        },
      ],
      runs: [
        {
          id: "run-complete",
          threadId: "thread-1",
          status: "completed" as const,
          lastSequence: 1,
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

  it("settles the only streaming assistant from a terminal snapshot", async () => {
    const transport = createTransport([]);
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:02.000Z",
      events: [
        {
          ...protocolEvent(1, { type: "run.completed" }),
          runId: "run-complete",
        },
      ],
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
          lastSequence: 1,
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
      events: [
        {
          ...protocolEvent(1, { type: "run.completed" }),
          runId: "run-complete",
        },
        {
          ...protocolEvent(1, {
            type: "run.failed",
            error: { code: "run_failed", message: "Run failed." },
          }),
          runId: "run-failed",
        },
      ],
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
          lastSequence: 1,
        },
        {
          id: "run-failed",
          threadId: "thread-1",
          status: "failed" as const,
          lastSequence: 1,
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
        events: [
          {
            ...protocolEvent(1, { type: "run.completed" }),
            runId: "run-complete",
          },
        ],
        runs: [
          {
            id: "run-complete",
            threadId: "thread-1",
            status: "completed" as const,
            lastSequence: 1,
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
    const options = {
      model: "queued-model",
      reasoningEffort: "high" as const,
    };
    const queued: AgentQueuedMessage = {
      id: "queued-after-conflict",
      threadId: "thread-1",
      text: "Do this after the current run",
      createdAt: "2026-10-01T00:00:00.000Z",
      metadata: { contextItems: [{ key: "selection", text: "full context" }] },
      options,
    };
    const startRun = vi.fn(async () => {
      throw Object.assign(new Error("Run already in progress"), {
        code: "run_slot_busy",
        retryable: true,
        activeRunId: "run-active",
      });
    });
    const queueMessage = vi.fn(async () => ({ message: queued }));
    const removeQueuedMessage = vi.fn(async () => undefined);
    const cancelRun = vi.fn(async () => undefined);
    const onLocalSubmit = vi.fn();
    const client = new AgentKitClient({
      transport: {
        ...createTransport([]),
        capabilities: { messageQueue: true },
        startRun,
        queueMessage,
        removeQueuedMessage,
        cancelRun,
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
      options,
      onLocalSubmit,
    });

    expect(handle.runId).toBe("run-active");
    expect(startRun).toHaveBeenCalledOnce();
    expect(queueMessage).toHaveBeenCalledOnce();
    expect(queueMessage.mock.calls[0]?.[0]).toMatchObject({
      threadId: "thread-1",
      text: queued.text,
      metadata: queued.metadata,
      options,
    });
    expect(onLocalSubmit).toHaveBeenCalledOnce();
    expect(client.getThread("thread-1")).toMatchObject({
      activeRunIds: ["run-active"],
      queuedMessages: [queued],
      messages: [],
    });

    await handle.cancel();
    expect(removeQueuedMessage).toHaveBeenCalledWith(
      { threadId: "thread-1", messageId: queued.id },
      expect.anything(),
    );
    expect(cancelRun).not.toHaveBeenCalled();

    await client.shutdown();
  });

  it("keeps a queued send parked through a stale snapshot while append is pending", async () => {
    const append = Promise.withResolvers<{ message: AgentQueuedMessage }>();
    const queuedAt = "2026-10-01T00:00:00.000Z";
    const queueMessage = vi.fn<NonNullable<AgentTransport["queueMessage"]>>(
      () => append.promise,
    );
    const transport: AgentTransport = {
      ...createTransport([]),
      capabilities: { messageQueue: true },
      async getThreadSnapshot({ threadId }) {
        return {
          id: threadId,
          createdAt: queuedAt,
          updatedAt: queuedAt,
          messages: [],
          activeRunIds: ["run-active"],
          runs: [
            {
              id: "run-active",
              threadId,
              status: "running",
              lastSequence: 0,
            },
          ],
          queuedMessages: [],
        };
      },
      queueMessage,
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    const onLocalSubmit = vi.fn();
    const submission = client.queueMessage({
      threadId: "thread-1",
      text: "Keep this as the queued prompt",
      onLocalSubmit,
    });
    await vi.waitFor(() => expect(queueMessage).toHaveBeenCalledOnce());

    const parked = client.getThread("thread-1").queuedMessages[0];
    expect(parked).toMatchObject({
      id: queueMessage.mock.calls[0]?.[0].id,
      text: "Keep this as the queued prompt",
    });
    expect(onLocalSubmit).toHaveBeenCalledOnce();

    await client.loadThread("thread-1");
    expect(client.getThread("thread-1").queuedMessages).toEqual([parked]);

    append.resolve({ message: parked! });
    await expect(submission).resolves.toEqual(parked);
    expect(client.getThread("thread-1").queuedMessages).toEqual([parked]);
    await client.shutdown();
  });

  it("cancels a queued send without cancelling the active run", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-cancel-send",
      threadId: "thread-1",
      text: "Keep this out of the queue",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const cancelRun = vi.fn(async () => undefined);
    const removeQueuedMessage = vi.fn(async () => undefined);
    const client = new AgentKitClient({
      transport: {
        ...createTransport([]),
        capabilities: { messageQueue: true },
        async startRun() {
          return { runId: "run-active" };
        },
        async queueMessage() {
          return { message: queued };
        },
        removeQueuedMessage,
        async *subscribeToRun({ runId, signal }) {
          yield { ...protocolEvent(1, { type: "run.started" }), runId };
          await new Promise<void>((resolve) =>
            signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
        },
        cancelRun,
      },
    });
    await client.sendMessage({ threadId: "thread-1", text: "Keep running" });

    const queuedHandle = await client.sendMessage({
      threadId: "thread-1",
      text: queued.text,
    });
    await queuedHandle.cancel();

    expect(removeQueuedMessage).toHaveBeenCalledWith(
      { threadId: "thread-1", messageId: queued.id },
      expect.anything(),
    );
    expect(cancelRun).not.toHaveBeenCalled();
    expect(client.getThread("thread-1").queuedMessages).toEqual([]);
    await client.shutdown();
  });

  it("queues an idless server conflict without leaving a failed optimistic message", async () => {
    const queued: AgentQueuedMessage = {
      id: "queued-idless-conflict",
      threadId: "thread-1",
      text: "Keep this queued",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const queueMessage = vi.fn(async () => ({ message: queued }));
    const onError = vi.fn();
    const client = new AgentKitClient({
      transport: {
        ...createTransport([]),
        capabilities: { messageQueue: true },
        async startRun() {
          throw new AgentKitRunSlotBusyError();
        },
        queueMessage,
        async steerQueuedMessage() {
          throw new AgentKitRunSlotBusyError();
        },
      },
      onError,
    });

    const handle = await client.sendMessage({
      threadId: "thread-1",
      text: queued.text,
    });

    expect(handle.runId).toBe(queued.id);
    expect(queueMessage).toHaveBeenCalledOnce();
    expect(client.getThread("thread-1")).toMatchObject({
      messages: [],
      queuedMessages: [queued],
      activeRunIds: [],
    });
    expect(client.getSnapshot()).toMatchObject({
      connection: "connected",
      error: undefined,
    });
    expect(onError).not.toHaveBeenCalled();

    await client.shutdown();
  });

  it("does not synthesize active-run state when persisting a conflicted send fails", async () => {
    const client = new AgentKitClient({
      transport: {
        ...createTransport([]),
        capabilities: { messageQueue: true },
        async startRun() {
          throw new AgentKitRunSlotBusyError("run-active");
        },
        async queueMessage() {
          throw new Error("Queue persistence failed");
        },
      },
    });

    await expect(
      client.sendMessage({ threadId: "thread-1", text: "Do not lose me" }),
    ).rejects.toThrow("Queue persistence failed");
    expect(client.getThread("thread-1")).toMatchObject({
      activeRunIds: [],
      queuedMessages: [],
      messages: [expect.objectContaining({ status: "error" })],
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
    expect(cancelRun).not.toHaveBeenCalled();
    expect(steerQueuedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        messageId: queued.id,
        interruptActiveRun: true,
      }),
      expect.anything(),
    );
    expect(client.getThread("thread-1")).toMatchObject({
      messages: [expect.objectContaining({ id: queued.id })],
      queuedMessages: [],
    });

    await client.shutdown();
  });

  it("allows explicit steer to escalate an automatic promotion", async () => {
    const finishAutomaticSteer = Promise.withResolvers<void>();
    const queued: AgentQueuedMessage = {
      id: "queued-steer-escalation",
      threadId: "thread-1",
      text: "Interrupt with this",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    let steerCalls = 0;
    const steerQueuedMessage = vi.fn(async (input) => {
      steerCalls += 1;
      if (steerCalls === 1) {
        await finishAutomaticSteer.promise;
        throw new AgentKitRunSlotBusyError("run-active");
      }
      expect(input.interruptActiveRun).toBe(true);
      return { runId: "run-steered" };
    });
    const client = new AgentKitClient({
      transport: {
        ...createTransport([]),
        capabilities: { messageQueue: true },
        async queueMessage() {
          return { message: queued };
        },
        steerQueuedMessage,
      },
      onError: vi.fn(),
    });

    await client.queueMessage({
      threadId: "thread-1",
      text: queued.text,
      queuedWhileRunActive: true,
    });
    await vi.waitFor(() => expect(steerQueuedMessage).toHaveBeenCalledOnce());
    const explicit = client.steerQueuedMessage(
      "thread-1",
      queued.id,
      undefined,
      { interruptActiveRun: true },
    );

    finishAutomaticSteer.resolve();
    await expect(explicit).resolves.toMatchObject({ runId: "run-steered" });
    expect(steerQueuedMessage).toHaveBeenCalledTimes(2);

    await client.shutdown();
  });

  it("keeps an unproven queue claim visible without adding it to history", async () => {
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
    await expect(
      client.steerQueuedMessage("thread-1", queued.id),
    ).rejects.toThrow(`Unknown queued message: ${queued.id}`);

    expect(client.getThread("thread-1").queuedMessages).toEqual([queued]);
    expect(client.getThread("thread-1").messages).toEqual([]);
    expect(onError).toHaveBeenCalledOnce();
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
      text: "Already promoted in another tab",
      createdAt: "2026-08-29T00:00:00.000Z",
    };
    const laterQueued = {
      ...queued,
      id: "queued-2",
      text: "Run after reconciling the first item",
    };
    const promoted = vi.fn(
      async (
        _input: Parameters<
          NonNullable<AgentTransport["steerQueuedMessage"]>
        >[0],
      ) => undefined,
    );
    const transport = createTransport([]);
    transport.capabilities = { messageQueue: true };
    transport.getThreadSnapshot = async () => ({
      id: "thread-1",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:01.000Z",
      messages: [],
      queuedMessages: [queued, laterQueued],
      runs: [],
      activeRunIds: [],
    });
    transport.steerQueuedMessage = promoted;
    const client = new AgentKitClient({ transport });

    await client.loadThread("thread-1");
    await vi.waitFor(() => expect(promoted).toHaveBeenCalledTimes(2));

    expect(promoted.mock.calls.map(([input]) => input.messageId)).toEqual([
      queued.id,
      laterQueued.id,
    ]);
    expect(client.getThread("thread-1").queuedMessages).toEqual([]);
    await client.shutdown();
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

  it("queues follow-up messages by default while a run is active", async () => {
    let runCount = 0;
    const terminals = new Map<
      string,
      ReturnType<typeof Promise.withResolvers<void>>
    >();
    const steerQueuedMessage = vi.fn(async () => {
      runCount += 1;
      return { runId: `run-${runCount}` };
    });
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
    const first = await client.sendMessage({ threadId: "thread-1", text: "A" });
    const second = await client.sendMessage({
      threadId: "thread-1",
      text: "B",
    });
    expect(second.runId).toBe("run-1");
    expect(runCount).toBe(1);
    expect(client.getThread("thread-1").activeRunIds).toEqual(["run-1"]);
    expect(client.getThread("thread-1").queuedMessages).toMatchObject([
      { text: "B" },
    ]);

    terminals.get("run-1")?.resolve();
    await first.completed;
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").activeRunIds).toEqual(["run-2"]),
    );
    expect(steerQueuedMessage).toHaveBeenCalledOnce();
    expect(client.getThread("thread-1").queuedMessages).toEqual([]);
    terminals.get("run-2")?.resolve();
    await vi.waitFor(() =>
      expect(client.getThread("thread-1").activeRunIds).toEqual([]),
    );
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

  it("uses durable history when another tab already promoted a queue item", async () => {
    const client = new AgentKitClient({
      transport: {
        capabilities: { messageQueue: true },
        async queueMessage({ threadId, text }) {
          return {
            message: {
              id: "queued-1",
              threadId,
              text,
              createdAt: "2026-09-30T00:00:00.000Z",
            },
          };
        },
        async steerQueuedMessage() {
          return { runId: "run-1", alreadySubmitted: true };
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
        async getThreadSnapshot({ threadId }) {
          return {
            id: threadId,
            createdAt: "2026-09-30T00:00:00.000Z",
            updatedAt: "2026-09-30T00:00:01.000Z",
            activeRunIds: ["run-1"],
            messages: [
              {
                id: "server-user-run-1",
                threadId,
                role: "user",
                createdAt: "2026-09-30T00:00:00.000Z",
                status: "complete",
                parts: [{ type: "text", text: "Run once" }],
                metadata: {
                  custom: {
                    agentNativeQueuedMessageId: "queued-1",
                    submittedRunId: "run-1",
                  },
                },
              },
            ],
            queuedMessages: [],
          };
        },
      },
    });

    try {
      await client.queueMessage({ threadId: "thread-1", text: "Run once" });
      const run = await client.steerQueuedMessage("thread-1", "queued-1");
      await run?.completed;

      expect(client.getThread("thread-1").messages.map(({ id }) => id)).toEqual(
        ["server-user-run-1"],
      );
      expect(client.getThread("thread-1").queuedMessages).toEqual([]);
    } finally {
      await client.dispose();
    }
  });

  it("reconciles a queue item removed in another tab without adding history", async () => {
    const client = new AgentKitClient({
      transport: {
        capabilities: { messageQueue: true },
        async queueMessage({ threadId, text }) {
          return {
            message: {
              id: "queued-removed",
              threadId,
              text,
              createdAt: "2026-10-01T00:00:00.000Z",
            },
          };
        },
        async steerQueuedMessage() {
          return { alreadyRemoved: true };
        },
        async getThreadSnapshot({ threadId }) {
          return {
            id: threadId,
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:01.000Z",
            messages: [],
            queuedMessages: [],
          };
        },
      },
    });

    try {
      await client.queueMessage({
        threadId: "thread-1",
        text: "Removed elsewhere",
      });
      await expect(
        client.steerQueuedMessage("thread-1", "queued-removed"),
      ).resolves.toBeUndefined();
      expect(client.getThread("thread-1").queuedMessages).toEqual([]);
      expect(client.getThread("thread-1").messages).toEqual([]);
    } finally {
      await client.dispose();
    }
  });

  it("honors queueWhileRunning=false when the server reports a busy slot", async () => {
    const finishRun = Promise.withResolvers<void>();
    const runStarted = Promise.withResolvers<void>();
    const queueMessage = vi.fn(async () => ({
      message: {
        id: "queued-1",
        threadId: "thread-1",
        text: "Direct send",
        createdAt: "2026-08-29T00:00:00.000Z",
      },
    }));
    let startCount = 0;
    const client = new AgentKitClient({
      transport: {
        capabilities: { messageQueue: true },
        async startRun() {
          startCount += 1;
          if (startCount > 1) throw new AgentKitRunSlotBusyError("run-1");
          return { runId: "run-1" };
        },
        async *subscribeToRun({ threadId, runId }) {
          yield {
            ...protocolEvent(1, { type: "run.started" }),
            threadId,
            runId,
          };
          runStarted.resolve();
          await finishRun.promise;
          yield {
            ...protocolEvent(2, { type: "run.completed" }),
            threadId,
            runId,
          };
        },
        async cancelRun() {},
        queueMessage,
      },
    });
    let activeRun: AgentRunHandle | undefined;

    try {
      activeRun = await client.sendMessage({
        threadId: "thread-1",
        text: "Go",
      });
      await runStarted.promise;
      await expect(
        client.sendMessage({
          threadId: "thread-1",
          text: "Direct send",
          queueWhileRunning: false,
        }),
      ).rejects.toBeInstanceOf(AgentKitRunSlotBusyError);

      expect(startCount).toBe(2);
      expect(queueMessage).not.toHaveBeenCalled();
      expect(client.getThread("thread-1").messages.at(-1)).toMatchObject({
        role: "user",
        status: "error",
        parts: [{ type: "text", text: "Direct send" }],
      });
    } finally {
      finishRun.resolve();
      await activeRun?.completed.catch(() => undefined);
      await client.dispose();
    }
  });

  it("retries automatic queue promotion after run or claim contention clears", async () => {
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
          if (attempts < 8) {
            throw attempts % 2 === 0
              ? new AgentKitRunSlotBusyError()
              : Object.assign(new Error("Queue item is being promoted"), {
                  code: "queue_item_busy",
                  retryable: true,
                });
          }
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
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(attempts).toBe(index + 1);
        await vi.advanceTimersByTimeAsync(1);
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
