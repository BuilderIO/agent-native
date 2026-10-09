import { AgentKitClient } from "@agent-native/agentkit/client";
import { resumeEntryFromApproval } from "@agent-native/agentkit/protocol";
import type { AgentEvent } from "@agent-native/agentkit/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  buildUserMessage,
  foldUnstartedTurnFailure,
  mergeThreadDataForClientSave,
  upsertUserMessage,
} from "../../agent/thread-data-builder.js";
import { agentTroubleCauseForCode } from "../../shared/analytics-events.js";
import { resetAgentEngineReadinessForTests } from "../agent-engine-readiness.js";
import { createAgentNativeAgentKitTransport as createAgentNativeAgentKitTransportImplementation } from "./agentkit-agent-native.js";
import { AGENT_NATIVE_PROTOCOL_METADATA_KEY } from "./agentkit-protocol.js";
import type { RunOutcomeReport } from "./run-outcome.js";
import {
  createAgentNativeChatRuntime,
  createHttpAgentChatRuntime,
  type AgentChatRuntime,
  type AgentChatRuntimeKnownEvent,
} from "./runtime.js";

const runStateMocks = vi.hoisted(() => ({
  dispatchAgentChatRunning: vi.fn(),
}));

vi.mock("../use-agent-chat-running-threads.js", () => runStateMocks);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createAgentNativeAgentKitTransport(
  options: Parameters<
    typeof createAgentNativeAgentKitTransportImplementation
  >[0],
) {
  const fetchImpl = options.fetch ?? fetch;
  return createAgentNativeAgentKitTransportImplementation({
    ...options,
    fetch: (async (input, init) => {
      if (String(input).includes("/_agent-native/agent-engine/status")) {
        return json({ configured: true, chatEligible: true });
      }
      return fetchImpl(input, init);
    }) as typeof fetch,
  });
}

function resumableNativeRuntime(
  events: AgentChatRuntimeKnownEvent[],
): AgentChatRuntime {
  const runtime = createAgentNativeChatRuntime();
  runtime.readRunState = async (input) => ({
    status: "running",
    runId: input.runId ?? "run-test",
  });
  runtime.subscribe = async () =>
    (async function* () {
      yield* events;
    })();
  return runtime;
}

describe("createAgentNativeAgentKitTransport", () => {
  it("uses the transport engine when checking AI readiness", async () => {
    resetAgentEngineReadinessForTests();
    const localFetch = vi.fn(async () => json({ chatEligible: true }));
    const localTransport = createAgentNativeAgentKitTransportImplementation({
      apiUrl: "https://mobile.example.test/_agent-native/agent-chat",
      engine: "codex-cli",
      fetch: localFetch as typeof fetch,
    });

    await expect(
      localTransport.assertAiSetupReady?.({}),
    ).resolves.toBeUndefined();
    expect(localFetch).not.toHaveBeenCalled();

    const providerFetch = vi.fn(async () => json({ chatEligible: true }));
    const providerTransport = createAgentNativeAgentKitTransportImplementation({
      apiUrl: "https://provider.example.test/_agent-native/agent-chat",
      engine: "openai",
      fetch: providerFetch as typeof fetch,
    });
    await expect(
      providerTransport.assertAiSetupReady?.({}),
    ).resolves.toBeUndefined();
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(String(providerFetch.mock.calls[0]?.[0])).toBe(
      "https://provider.example.test/_agent-native/agent-engine/status",
    );
    resetAgentEngineReadinessForTests();
  });

  it("creates a missing thread when its first snapshot races the user-message save", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    let created = false;
    let savedThreadData: string | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({
          url,
          method,
          ...(typeof init?.body === "string" ? { body: init.body } : {}),
        });
        if (url.startsWith("/_agent-native/agent-chat/threads/first-save")) {
          if (method === "GET" && !created) {
            return json({ error: "Thread not found" }, 404);
          }
          if (method === "PUT") {
            savedThreadData = JSON.parse(String(init?.body)).threadData;
            return json({ ok: true });
          }
          return json({
            id: "first-save",
            title: "First prompt",
            threadData: JSON.stringify({}),
          });
        }
        if (
          url ===
            "/_agent-native/agent-chat/threads?scopeType=workspace-app&scopeId=app-one" &&
          method === "POST"
        ) {
          created = true;
          expect(JSON.parse(String(init?.body))).toEqual({
            id: "first-save",
            title: "First prompt",
          });
          return json({
            id: "first-save",
            title: "First prompt",
            threadData: JSON.stringify({}),
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
      scope: { type: "workspace-app", id: "app-one" },
      isolateHistoryByScope: true,
    });

    await transport.persistThreadSnapshot?.({
      threadId: "first-save",
      snapshot: {
        id: "first-save",
        title: "First prompt",
        createdAt: "2026-09-30T00:00:00.000Z",
        updatedAt: "2026-09-30T00:00:00.000Z",
        messages: [
          {
            id: "prompt-1",
            role: "user",
            parts: [{ type: "text", text: "Make a launch deck" }],
          },
        ],
      },
    });

    expect(requests.map(({ method }) => method)).toEqual([
      "GET",
      "POST",
      "PUT",
    ]);
    expect(requests[1]?.url).toBe(
      "/_agent-native/agent-chat/threads?scopeType=workspace-app&scopeId=app-one",
    );
    expect(JSON.parse(savedThreadData ?? "{}").agentKit.messages).toEqual([
      expect.objectContaining({ id: "prompt-1", role: "user" }),
    ]);
  });

  it("merges raced snapshot widgets by their globally unique ID", async () => {
    const threadId = "snapshot-widget-race";
    const previousWidget = {
      messageId: "assistant-before-continuation",
      widget: {
        id: "tool-1:chat-ui",
        kind: "release.summary",
        data: { toolCallId: "tool-1", toolName: "publish" },
      },
    };
    const incomingWidget = {
      messageId: "assistant-after-continuation",
      widget: {
        id: "tool-1:chat-ui",
        kind: "release.summary",
        data: { toolCallId: "tool-1", toolName: "publish" },
      },
    };
    let threadReads = 0;
    let savedThreadData: string | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          threadReads += 1;
          if (threadReads === 1)
            return json({ error: "Thread not found" }, 404);
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [],
              agentKit: {
                messages: [
                  {
                    id: "assistant-before-continuation",
                    role: "assistant",
                    status: "complete",
                    parts: [{ type: "text", text: "Publishing." }],
                  },
                ],
                widgets: [previousWidget],
              },
            }),
          });
        }
        if (url.endsWith("/threads") && method === "POST") {
          return json({ error: "Already exists" }, 409);
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          savedThreadData = JSON.parse(String(init?.body)).threadData;
          return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.persistThreadSnapshot?.({
      threadId,
      snapshot: {
        id: threadId,
        title: "Publish summary",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        messages: [
          {
            id: "assistant-after-continuation",
            role: "assistant",
            status: "complete",
            parts: [{ type: "text", text: "Published." }],
          },
        ],
        widgets: [incomingWidget],
      },
    });

    const persistedWidgets = JSON.parse(savedThreadData ?? "{}").agentKit
      .widgets;
    expect(persistedWidgets).toHaveLength(1);
    expect(persistedWidgets[0]).toMatchObject({
      messageId: "assistant-after-continuation",
      widget: { id: "tool-1:chat-ui", kind: "release.summary" },
    });
    await transport.dispose();
  });

  it("hides a folded durable reply while its AgentKit run is active", async () => {
    const threadId = "thread-folded-active-reply";
    const activeRunId = "run-continuation";
    let active = true;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/threads/${threadId}`)) {
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "server-folded-answer",
                  role: "assistant",
                  content: [{ type: "text", text: "The final answer." }],
                  status: { type: "complete", reason: "stop" },
                  createdAt: "2026-10-01T00:00:01.000Z",
                  metadata: {
                    runId: "run-initial",
                    custom: { foldedRunIds: ["run-initial", activeRunId] },
                  },
                },
              },
            ],
            agentKit: { messages: [] },
          }),
        });
      }
      if (url.includes(`/runs/active?threadId=${threadId}`)) {
        return json(
          active
            ? { active: true, status: "running", runId: activeRunId }
            : { active: false, status: "completed", runId: activeRunId },
        );
      }
      return json({ error: "Not found" }, 404);
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    const activeSnapshot = await transport.getThreadSnapshot?.({ threadId });
    expect(activeSnapshot?.activeRunIds).toContain(activeRunId);
    expect(activeSnapshot?.messages.map((message) => message.id)).not.toContain(
      "server-folded-answer",
    );

    active = false;
    const completedSnapshot = await transport.getThreadSnapshot?.({ threadId });
    expect(completedSnapshot?.messages.map((message) => message.id)).toContain(
      "server-folded-answer",
    );
    await transport.dispose();
  });

  it("associates a terminal run with its durable assistant message", async () => {
    const threadId = "thread-terminal-assistant";
    const runId = "run-terminal-assistant";
    const assistantMessage = {
      id: "assistant-terminal",
      role: "assistant",
      status: "complete",
      parts: [{ type: "text", text: "Recovered response." }],
    };
    const occurredAt = "2026-10-01T00:00:00.000Z";
    const runEvent = (
      sequence: number,
      type: string,
      message?: Record<string, unknown>,
    ) => ({
      id: `event-${sequence}`,
      threadId,
      runId,
      sequence,
      occurredAt,
      type,
      ...(message ? { message } : {}),
    });
    const threadData = JSON.stringify({
      messages: [],
      agentKit: {
        messages: [assistantMessage],
        events: [
          runEvent(1, "run.started"),
          runEvent(2, "message.created", {
            ...assistantMessage,
            status: "streaming",
          }),
          runEvent(3, "message.completed", assistantMessage),
          runEvent(4, "run.completed"),
        ],
        runs: [
          {
            id: runId,
            threadId,
            status: "completed",
            lastSequence: 4,
          },
        ],
        activeRunIds: [],
      },
    });
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/threads/${threadId}`)) {
        return json({
          id: threadId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
          threadData,
        });
      }
      if (url.includes(`/runs/active?threadId=${threadId}`)) {
        return json({ active: false, status: "completed", runId });
      }
      if (url.includes(`/runs/${runId}?threadId=${threadId}`)) {
        return json({
          id: runId,
          threadId,
          status: "completed",
          lastSequence: 4,
        });
      }
      return json({ error: "Not found" }, 404);
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.runs?.find((run) => run.id === runId)).toMatchObject({
      status: "completed",
      activeMessageId: assistantMessage.id,
    });
    await transport.dispose();
  });

  it("persists bounded snapshot deltas and retries smaller chunks after a 413", async () => {
    const largeResult = "x".repeat(60_000);
    const previousToolCalls = Array.from({ length: 50 }, (_, index) => ({
      id: "previous-tool-" + index,
      name: "stored-result",
      output: largeResult,
      status: "completed" as const,
    }));
    const incomingToolCalls = Array.from({ length: 72 }, (_, index) => ({
      id: "new-tool-" + index,
      name: "new-result",
      output: largeResult,
      status: "completed" as const,
    }));
    const runId = "completed-run";
    const suggestions = Array.from({ length: 3 }, (_, index) => ({
      id: `suggestion-${index}`,
      runId,
      label: `Suggestion ${index}`,
      prompt: "p".repeat(60_000),
    }));
    let repository: Record<string, any> = {
      messages: [],
      agentKit: { toolCalls: previousToolCalls },
    };
    const attemptedSizes: number[] = [];
    const acceptedSizes: number[] = [];
    const acceptedRequests: Array<Record<string, any>> = [];
    const sentToolCallIds = new Set<string>();
    const responseLimit = 250_000;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/threads/large-history") && method === "GET") {
          return json({
            id: "large-history",
            title: "Large history",
            threadData: JSON.stringify(repository),
          });
        }
        if (url.endsWith("/threads/large-history") && method === "PUT") {
          const body = String(init?.body);
          const byteLength = new TextEncoder().encode(body).byteLength;
          attemptedSizes.push(byteLength);
          const incoming = JSON.parse(JSON.parse(body).threadData);
          for (const toolCall of incoming.agentKit.toolCalls ?? []) {
            sentToolCallIds.add(toolCall.id);
          }
          if (byteLength > responseLimit) {
            return json({ error: "Request too large" }, 413);
          }
          acceptedSizes.push(byteLength);
          acceptedRequests.push(incoming.agentKit);
          repository = mergeThreadDataForClientSave(repository, incoming);
          return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.persistThreadSnapshot?.({
      threadId: "large-history",
      snapshot: {
        id: "large-history",
        title: "Large history",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:01.000Z",
        messages: [
          {
            id: "new-answer",
            role: "assistant",
            parts: [{ type: "text", text: "The run completed." }],
          },
        ],
        toolCalls: incomingToolCalls,
        runs: [
          {
            id: runId,
            threadId: "large-history",
            status: "completed" as const,
            startedAt: "2026-10-01T00:00:00.000Z",
            completedAt: "2026-10-01T00:00:01.000Z",
            lastSequence: 1,
          },
        ],
        suggestions,
      },
    });

    expect(attemptedSizes.length).toBeGreaterThan(2);
    expect(Math.max(...attemptedSizes)).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(Math.max(...acceptedSizes)).toBeLessThanOrEqual(responseLimit);
    expect(sentToolCallIds.size).toBe(incomingToolCalls.length);
    expect([...sentToolCallIds].every((id) => id.startsWith("new-tool-"))).toBe(
      true,
    );
    expect(repository.agentKit.toolCalls).toHaveLength(
      previousToolCalls.length + incomingToolCalls.length,
    );
    expect(repository.agentKit.messages).toMatchObject([
      { id: "new-answer", role: "assistant" },
    ]);
    const suggestionRequests = acceptedRequests.filter((agentKit) =>
      Object.hasOwn(agentKit, "suggestions"),
    );
    expect(suggestionRequests).toHaveLength(1);
    expect(suggestionRequests[0].runs).toEqual([
      expect.objectContaining({ id: runId }),
    ]);
    expect(suggestionRequests[0].suggestions).toEqual(suggestions);
    expect(repository.agentKit.suggestions).toEqual(suggestions);
  });

  it("persists changed suggestions when a completed run advances", async () => {
    const threadId = "advanced-suggestions";
    const run = (lastSequence: number) => ({
      id: "run-1",
      threadId,
      status: "completed" as const,
      startedAt: "2026-10-01T00:00:00.000Z",
      completedAt: "2026-10-01T00:00:01.000Z",
      lastSequence,
    });
    const previousSuggestions = [
      { id: "suggestion-old", runId: "run-1", label: "Old" },
    ];
    const suggestions = [
      { id: "suggestion-new", runId: "run-1", label: "New" },
    ];
    let repository: Record<string, any> = {
      messages: [],
      agentKit: {
        messages: [],
        runs: [run(5)],
        suggestions: previousSuggestions,
      },
    };
    const writes: Array<Record<string, any>> = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (!url.endsWith(`/threads/${threadId}`)) {
          return json({ error: "Not found" }, 404);
        }
        if (init?.method === "PUT") {
          const incoming = JSON.parse(JSON.parse(String(init.body)).threadData);
          writes.push(incoming.agentKit);
          repository = mergeThreadDataForClientSave(repository, incoming);
          return json({ ok: true });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify(repository),
        });
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.persistThreadSnapshot?.({
      threadId,
      snapshot: {
        id: threadId,
        title: "Advanced suggestions",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:02.000Z",
        messages: [],
        runs: [run(6)],
        suggestions,
      },
    });

    expect(
      writes.some((agentKit) => Object.hasOwn(agentKit, "suggestions")),
    ).toBe(true);
    expect(repository.agentKit.suggestions).toEqual(suggestions);
    await transport.dispose();
  });

  it("rejects an oversized suggestions snapshot before sending a write", async () => {
    const threadId = "oversized-suggestions";
    let putCount = 0;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith(`/threads/${threadId}`)) {
          if (init?.method === "PUT") {
            putCount += 1;
            return json({ ok: true });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({ messages: [], agentKit: {} }),
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      transport.persistThreadSnapshot?.({
        threadId,
        snapshot: {
          id: threadId,
          title: "Large suggestions",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:01.000Z",
          messages: [],
          runs: [
            {
              id: "large-run",
              threadId,
              status: "completed",
              startedAt: "2026-10-01T00:00:00.000Z",
              completedAt: "2026-10-01T00:00:01.000Z",
              lastSequence: 1,
            },
          ],
          suggestions: [
            {
              id: "large-suggestion",
              runId: "large-run",
              label: "Large suggestion",
              prompt: "x".repeat(4 * 1024 * 1024),
            },
          ],
        },
      }),
    ).rejects.toThrow(RangeError);

    expect(putCount).toBe(0);
    await transport.dispose();
  });

  it("replaces same-run event history when 413 retries split snapshot upserts", async () => {
    const largeLabel = "x".repeat(110_000);
    const threadId = "split-history";
    const messageId = "assistant-history";
    const runId = "run-history";
    const snapshotEvents = Array.from({ length: 20 }, (_, index) => ({
      id: `event-${index}`,
      threadId,
      runId,
      sequence: index + 1,
      occurredAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index + 1)).toISOString(),
      type: "activity.started" as const,
      activity: {
        id: `activity-${index}`,
        kind: "tool" as const,
        label: largeLabel,
        status: "running" as const,
      },
    }));
    const newerSnapshotEvents = snapshotEvents.map((event, index) =>
      index === 19
        ? {
            ...event,
            type: "activity.updated" as const,
            activity: { ...event.activity, label: "newer snapshot" },
          }
        : event,
    );
    let repository: Record<string, any> = {
      messages: [],
      agentKit: {
        messages: [
          {
            id: messageId,
            role: "assistant",
            parts: [{ type: "text", text: "The answer." }],
          },
        ],
        events: [
          {
            id: "old-event",
            threadId,
            runId,
            sequence: 1,
            occurredAt: "2026-10-01T00:00:00.000Z",
            type: "run.started",
          },
        ],
        runs: [
          {
            id: runId,
            threadId,
            status: "running",
            lastSequence: 20,
          },
        ],
        _eventRunWatermarks: { [runId]: 20 },
        annotations: Array.from({ length: 20 }, (_, index) => ({
          messageId,
          annotation: {
            id: `old-annotation-${index}`,
            kind: "source",
            label: "Old source",
          },
        })),
      },
    };
    const requests: Array<Record<string, any>> = [];
    const acceptedRequests: Array<Record<string, any>> = [];
    let interleavedNewerSnapshot = false;
    const responseLimit = 300_000;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            title: "History",
            threadData: JSON.stringify(repository),
          });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          const body = String(init?.body);
          const incoming = JSON.parse(JSON.parse(body).threadData);
          requests.push(incoming.agentKit);
          if (new TextEncoder().encode(body).byteLength > responseLimit) {
            return json({ error: "Request too large" }, 413);
          }
          acceptedRequests.push(incoming.agentKit);
          repository = mergeThreadDataForClientSave(repository, incoming);
          if (
            !interleavedNewerSnapshot &&
            incoming.agentKit.events?.length > 0
          ) {
            interleavedNewerSnapshot = true;
            repository = mergeThreadDataForClientSave(repository, {
              messages: [],
              agentKit: {
                _snapshotDelta: true,
                eventRunReplacements: [{ runId, lastSequence: 21 }],
                eventRunSnapshotWatermarks: [{ runId, lastSequence: 21 }],
                events: newerSnapshotEvents,
                runs: [
                  {
                    id: runId,
                    threadId,
                    status: "completed",
                    lastSequence: 21,
                  },
                ],
              },
            });
          }
          return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.persistThreadSnapshot?.({
      threadId,
      snapshot: {
        id: threadId,
        title: "History",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:01.000Z",
        messages: [
          {
            id: messageId,
            role: "assistant",
            parts: [{ type: "text", text: "The answer." }],
          },
        ],
        events: snapshotEvents,
        runs: [
          {
            id: runId,
            threadId,
            status: "completed" as const,
            lastSequence: 20,
          },
        ],
        annotations: Array.from({ length: 20 }, (_, index) => ({
          messageId,
          annotation: {
            id: `annotation-${index}`,
            kind: "source" as const,
            label: largeLabel,
          },
        })),
      },
    });

    expect(
      requests.some(
        (agentKit) =>
          agentKit.events?.length > 0 && agentKit.events.length < 20,
      ),
    ).toBe(true);
    const eventRequests = requests.filter(
      (agentKit) => agentKit.events?.length > 0,
    );
    expect(eventRequests.length).toBeGreaterThan(1);
    expect(
      eventRequests.every(
        (agentKit) =>
          agentKit.eventRunSnapshotBatches?.length === 1 &&
          agentKit.eventRunSnapshotBatches[0].runId === runId &&
          agentKit.eventRunSnapshotBatches[0].lastSequence === 20 &&
          agentKit.eventRunSnapshotBatches[0].expectedEventCount === 20,
      ),
    ).toBe(true);
    expect(
      new Set(
        eventRequests.map(
          (agentKit) => agentKit.eventRunSnapshotBatches[0].snapshotId,
        ),
      ).size,
    ).toBe(1);
    expect(
      requests.some(
        (agentKit) =>
          agentKit.annotationMessageIdsToReplace?.some(
            (entry: any) => entry.messageId === messageId,
          ) && (agentKit.annotationUpserts?.length ?? 0) < 20,
      ),
    ).toBe(true);
    expect(
      requests.some(
        (agentKit) =>
          agentKit.annotationUpserts?.length > 0 &&
          !agentKit.annotationMessageIdsToReplace?.some(
            (entry: any) => entry.messageId === messageId,
          ),
      ),
    ).toBe(true);
    const lastAnnotationChunk = acceptedRequests.reduce(
      (last, agentKit, index) =>
        (agentKit.annotationUpserts?.length ?? 0) > 0 ? index : last,
      -1,
    );
    const replacementChunk = acceptedRequests.findIndex((agentKit) =>
      agentKit.annotationMessageIdsToReplace?.some(
        (entry: any) => entry.messageId === messageId,
      ),
    );
    expect(replacementChunk).toBeGreaterThanOrEqual(lastAnnotationChunk);
    expect(requests.every((agentKit) => agentKit._snapshotDelta === true)).toBe(
      true,
    );
    expect(repository.agentKit.events).toHaveLength(20);
    expect(interleavedNewerSnapshot).toBe(true);
    expect(
      repository.agentKit.events.map((event: { id: string }) => event.id),
    ).toEqual(Array.from({ length: 20 }, (_, index) => `event-${index}`));
    expect(
      repository.agentKit.events.find(
        (event: { id: string }) => event.id === "event-19",
      )?.activity.label,
    ).toBe("newer snapshot");
    expect(repository.agentKit._eventRunWatermarks).toEqual({ [runId]: 21 });
    expect(repository.agentKit).not.toHaveProperty("_pendingEventRunSnapshots");
    expect(repository.agentKit.annotations).toHaveLength(20);
    expect(
      repository.agentKit.annotations.every((entry: any) =>
        entry.annotation.id.startsWith("annotation-"),
      ),
    ).toBe(true);
    expect(repository.agentKit).not.toHaveProperty("_snapshotDelta");
    expect(repository.agentKit).not.toHaveProperty(
      "eventRunSnapshotWatermarks",
    );
    expect(repository.agentKit).not.toHaveProperty("eventRunSnapshotBatches");
    expect(repository.agentKit).not.toHaveProperty(
      "annotationMessageIdsToReplace",
    );
    await transport.dispose();
  });

  it("keeps a prior run history when a later event chunk fails", async () => {
    const threadId = "failed-event-chunk-history";
    const runId = "run-failed-event-chunk";
    const messageId = "assistant-failed-event-chunk";
    const largeLabel = "x".repeat(110_000);
    const snapshotEvents = Array.from({ length: 6 }, (_, index) => ({
      id: `new-event-${index}`,
      threadId,
      runId,
      sequence: index + 1,
      occurredAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index + 1)).toISOString(),
      type: "activity.started" as const,
      activity: {
        id: `activity-${index}`,
        kind: "tool" as const,
        label: largeLabel,
        status: "running" as const,
      },
    }));
    const snapshot = {
      id: threadId,
      title: "Retry event chunks",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:01.000Z",
      messages: [
        {
          id: messageId,
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: "The answer." }],
        },
      ],
      events: snapshotEvents,
      runs: [
        {
          id: runId,
          threadId,
          status: "completed" as const,
          lastSequence: snapshotEvents.length,
        },
      ],
    };
    let repository: Record<string, any> = {
      messages: [],
      agentKit: {
        messages: snapshot.messages,
        events: [
          {
            id: "old-run-start",
            threadId,
            runId,
            sequence: 1,
            occurredAt: "2026-10-01T00:00:00.000Z",
            type: "run.started",
          },
          {
            id: "old-run-completed",
            threadId,
            runId,
            sequence: 2,
            occurredAt: "2026-10-01T00:00:02.000Z",
            type: "run.completed",
          },
        ],
        runs: [
          {
            id: runId,
            threadId,
            status: "running",
            lastSequence: 2,
          },
        ],
        _eventRunWatermarks: { [runId]: 2 },
      },
    };
    let acceptedEventChunk = false;
    let failLaterEventChunks = true;
    const responseLimit = 300_000;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            title: "Retry event chunks",
            threadData: JSON.stringify(repository),
          });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          const body = String(init?.body);
          const incoming = JSON.parse(JSON.parse(body).threadData);
          const agentKit = incoming.agentKit;
          const hasEvents = (agentKit.events?.length ?? 0) > 0;
          if (new TextEncoder().encode(body).byteLength > responseLimit) {
            return json({ error: "Request too large" }, 413);
          }
          if (hasEvents && acceptedEventChunk && failLaterEventChunks) {
            throw new TypeError(
              "Connection reset after the first event chunk.",
            );
          }
          repository = mergeThreadDataForClientSave(repository, incoming);
          if (hasEvents) acceptedEventChunk = true;
          return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      transport.persistThreadSnapshot?.({ threadId, snapshot }),
    ).rejects.toThrow("Connection reset after the first event chunk.");

    expect(acceptedEventChunk).toBe(true);
    expect(repository.agentKit.events.map((event: any) => event.id)).toEqual([
      "old-run-start",
      "old-run-completed",
    ]);
    expect(repository.agentKit._eventRunWatermarks).toEqual({ [runId]: 2 });
    expect(
      Object.values(repository.agentKit._pendingEventRunSnapshots[runId])[0]
        .events.length,
    ).toBeGreaterThan(0);

    failLaterEventChunks = false;
    await transport.persistThreadSnapshot?.({ threadId, snapshot });

    expect(repository.agentKit.events.map((event: any) => event.id)).toEqual(
      snapshotEvents.map((event) => event.id),
    );
    expect(repository.agentKit._eventRunWatermarks).toEqual({
      [runId]: snapshotEvents.length,
    });
    expect(repository.agentKit).not.toHaveProperty("_pendingEventRunSnapshots");
    await transport.dispose();
  });

  it("replays a committed final event chunk when its response is lost", async () => {
    const threadId = "lost-final-event-response";
    const runId = "run-lost-final-response";
    const previousMessage = {
      id: "previous-message",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Earlier answer." }],
    };
    const newMessage = {
      id: "new-message",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "New answer." }],
    };
    const events = [
      {
        id: "new-run-started",
        threadId,
        runId,
        sequence: 1,
        occurredAt: "2026-10-01T00:00:01.000Z",
        type: "run.started" as const,
      },
      {
        id: "new-run-completed",
        threadId,
        runId,
        sequence: 2,
        occurredAt: "2026-10-01T00:00:02.000Z",
        type: "run.completed" as const,
      },
    ];
    let repository: Record<string, any> = {
      messages: [],
      queuedMessages: [{ id: "queued-message", text: "Keep me" }],
      appData: { marker: "preserved" },
      agentKit: {
        messages: [previousMessage],
        events: [
          {
            id: "other-run-event",
            threadId,
            runId: "other-run",
            sequence: 1,
            occurredAt: "2026-10-01T00:00:00.000Z",
            type: "run.started",
          },
        ],
        runs: [
          {
            id: "other-run",
            threadId,
            status: "completed",
            lastSequence: 1,
          },
        ],
        _eventRunWatermarks: { "other-run": 1 },
      },
    };
    let loseFinalResponse = true;
    const committedFinalBodies: string[] = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            title: "Event retry",
            threadData: JSON.stringify(repository),
          });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          const body = String(init?.body);
          const incoming = JSON.parse(JSON.parse(body).threadData);
          const agentKit = incoming.agentKit;
          if ((agentKit.events?.length ?? 0) > 1) {
            return json({ error: "Split event chunks" }, 413);
          }
          const batch = agentKit.eventRunSnapshotBatches?.[0];
          repository = mergeThreadDataForClientSave(repository, incoming);
          if (batch?.complete) {
            committedFinalBodies.push(body);
            if (loseFinalResponse) {
              loseFinalResponse = false;
              const response = json({ ok: true });
              Object.defineProperty(response, "json", {
                value: async () => {
                  throw new TypeError(
                    "Connection reset while reading the committed response.",
                  );
                },
              });
              return response;
            }
          }
          return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.persistThreadSnapshot?.({
      threadId,
      snapshot: {
        id: threadId,
        title: "Event retry",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:01.000Z",
        messages: [previousMessage, newMessage],
        events,
        runs: [
          {
            id: runId,
            threadId,
            status: "completed",
            lastSequence: 2,
          },
        ],
      },
    });

    expect(committedFinalBodies).toHaveLength(2);
    expect(committedFinalBodies[1]).toBe(committedFinalBodies[0]);
    expect(repository.queuedMessages).toEqual([
      { id: "queued-message", text: "Keep me" },
    ]);
    expect(repository.appData).toEqual({ marker: "preserved" });
    expect(
      repository.agentKit.messages.map((message: any) => message.id),
    ).toEqual(["previous-message", "new-message"]);
    expect(repository.agentKit.events.map((event: any) => event.id)).toEqual([
      "other-run-event",
      "new-run-started",
      "new-run-completed",
    ]);
    expect(repository.agentKit._eventRunWatermarks).toEqual({
      "other-run": 1,
      [runId]: 2,
    });
    expect(repository.agentKit).not.toHaveProperty("_pendingEventRunSnapshots");
    expect(repository.agentKit).not.toHaveProperty("eventRunSnapshotBatches");
    expect(repository.agentKit._eventRunSnapshotCommits[runId]).toHaveLength(1);
    await transport.dispose();
  });

  it("does not overwrite a run started after the snapshot read", async () => {
    const threadId = "snapshot-concurrent-run";
    const output = "x".repeat(55_000);
    let repository: Record<string, any> = {
      messages: [],
      agentKit: { activeRunIds: [] },
    };
    const savedSnapshots: Array<Record<string, any>> = [];
    let concurrentRunStarted = false;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          const response = json({
            id: threadId,
            threadData: JSON.stringify(repository),
          });
          if (!concurrentRunStarted) {
            repository.agentKit.activeRunIds = ["concurrent-run"];
            concurrentRunStarted = true;
          }
          return response;
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          const incoming = JSON.parse(
            JSON.parse(String(init?.body)).threadData,
          );
          savedSnapshots.push(incoming.agentKit);
          repository = mergeThreadDataForClientSave(repository, incoming);
          return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.persistThreadSnapshot?.({
      threadId,
      snapshot: {
        id: threadId,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:01.000Z",
        messages: [],
        activeRunIds: [],
        toolCalls: Array.from({ length: 80 }, (_, index) => ({
          id: `large-tool-${index}`,
          name: "large-result",
          output,
          status: "completed" as const,
        })),
      },
    });

    expect(savedSnapshots.length).toBeGreaterThan(1);
    expect(
      savedSnapshots.every(
        (agentKit) => !Object.hasOwn(agentKit, "activeRunIds"),
      ),
    ).toBe(true);
    expect(repository.agentKit.activeRunIds).toEqual(["concurrent-run"]);
    await transport.dispose();
  });

  it("keeps existing annotations if a later replacement chunk fails", async () => {
    const threadId = "failed-annotation-replacement";
    const message = {
      id: "assistant-annotation",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Answer." }],
    };
    let repository: Record<string, any> = {
      messages: [],
      agentKit: {
        messages: [message],
        annotations: [
          {
            messageId: message.id,
            annotation: { id: "old-annotation", kind: "source" },
          },
        ],
      },
    };
    const label = "x".repeat(80_000);
    const responseLimit = 180_000;
    let acceptedAnnotationChunks = 0;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            title: "Annotations",
            threadData: JSON.stringify(repository),
          });
        }
        if (url.includes("/runs/active")) return json({ active: false });
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          const body = String(init?.body);
          const incoming = JSON.parse(JSON.parse(body).threadData);
          if (new TextEncoder().encode(body).byteLength > responseLimit) {
            return json({ error: "Request too large" }, 413);
          }
          if ((incoming.agentKit.annotationUpserts?.length ?? 0) > 0) {
            acceptedAnnotationChunks += 1;
            if (acceptedAnnotationChunks >= 2) {
              return json({ error: "Temporary persistence failure" }, 503);
            }
          }
          repository = mergeThreadDataForClientSave(repository, incoming);
          return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      transport.persistThreadSnapshot?.({
        threadId,
        snapshot: {
          id: threadId,
          title: "Annotations",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:01.000Z",
          messages: [message],
          annotations: Array.from({ length: 4 }, (_, index) => ({
            messageId: message.id,
            annotation: {
              id: `new-annotation-${index}`,
              kind: "source" as const,
              label,
            },
          })),
        },
      }),
    ).rejects.toThrow();

    expect(acceptedAnnotationChunks).toBeGreaterThanOrEqual(2);
    expect(
      repository.agentKit.annotations.some(
        (entry: any) => entry.annotation.id === "old-annotation",
      ),
    ).toBe(true);
    await transport.dispose();
  });

  it("splits oversized annotation removals into bounded markers", async () => {
    const threadId = "large-annotation-replacement";
    const message = {
      id: "assistant-large-annotation-set",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Answer." }],
    };
    const annotationIds = Array.from(
      { length: 64 },
      (_, index) => `annotation-${index}-${"x".repeat(2_048)}`,
    );
    const previousAnnotationIds = Array.from(
      { length: 64 },
      (_, index) => `previous-${index}-${"x".repeat(2_048)}`,
    );
    let repository: Record<string, any> = {
      messages: [],
      agentKit: {
        messages: [message],
        annotations: previousAnnotationIds.map((id) => ({
          messageId: message.id,
          annotation: { id, kind: "source" },
        })),
      },
    };
    const savedSnapshots: Array<Record<string, any>> = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            threadData: JSON.stringify(repository),
          });
        }
        if (url.includes("/runs/active")) return json({ active: false });
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          const incoming = JSON.parse(
            JSON.parse(String(init?.body)).threadData,
          );
          savedSnapshots.push(incoming.agentKit);
          repository = mergeThreadDataForClientSave(repository, incoming);
          return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.persistThreadSnapshot?.({
      threadId,
      snapshot: {
        id: threadId,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:01.000Z",
        messages: [message],
        annotations: annotationIds.map((id) => ({
          messageId: message.id,
          annotation: { id, kind: "source" as const },
        })),
      },
    });

    const removals = savedSnapshots.flatMap(
      (agentKit) => agentKit.annotationMessageIdsToReplace ?? [],
    );
    expect(removals.length).toBeGreaterThan(1);
    expect(
      removals.flatMap((replacement: any) => replacement.annotationsToRemove),
    ).toHaveLength(previousAnnotationIds.length);
    expect(
      removals.every(
        (replacement: any) =>
          new TextEncoder().encode(JSON.stringify(replacement)).byteLength <=
          64 * 1024,
      ),
    ).toBe(true);
    expect(repository.agentKit.annotations).toHaveLength(annotationIds.length);
    expect(
      repository.agentKit.annotations.some(
        (entry: any) => !annotationIds.includes(entry.annotation.id),
      ),
    ).toBe(false);
    await transport.dispose();
  });

  it("surfaces annotation conflicts after preserving the concurrent value", async () => {
    const threadId = "annotation-conflict";
    const message = {
      id: "assistant-annotation-conflict",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Answer." }],
    };
    const baseline = {
      messageId: message.id,
      annotation: {
        id: "source-1",
        kind: "source",
        label: "Original source",
      },
    };
    const desired = {
      messageId: message.id,
      annotation: {
        id: "source-1",
        kind: "source",
        label: "Snapshot edit",
      },
    };
    const concurrent = {
      messageId: message.id,
      annotation: {
        id: "source-1",
        kind: "source",
        label: "Concurrent edit",
      },
    };
    let repository: Record<string, any> = {
      messages: [],
      agentKit: { messages: [message], annotations: [baseline] },
    };
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            threadData: JSON.stringify(repository),
          });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          const incoming = JSON.parse(
            JSON.parse(String(init?.body)).threadData,
          );
          repository = {
            ...repository,
            agentKit: {
              ...repository.agentKit,
              annotations: [concurrent],
            },
          };
          const annotationConflicts: Array<Record<string, unknown>> = [];
          repository = mergeThreadDataForClientSave(repository, incoming, {
            onAnnotationConflict: (conflict) =>
              annotationConflicts.push(conflict),
          });
          return json({ ok: true, annotationConflicts });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      transport.persistThreadSnapshot?.({
        threadId,
        snapshot: {
          id: threadId,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:01.000Z",
          messages: [message],
          annotations: [desired],
        },
      }),
    ).rejects.toMatchObject({
      name: "AgentAnnotationSaveConflictError",
      message: expect.stringContaining("reload the thread"),
    });

    expect(repository.agentKit.annotations).toEqual([concurrent]);
    await transport.dispose();
  });

  it("packs thousands of small lifecycle events without resending saved history", async () => {
    const threadId = "many-events";
    let repository: Record<string, any> = { messages: [], agentKit: {} };
    let putCount = 0;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            threadData: JSON.stringify(repository),
          });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          putCount++;
          const incoming = JSON.parse(
            JSON.parse(String(init?.body)).threadData,
          );
          repository = mergeThreadDataForClientSave(repository, incoming);
          return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.persistThreadSnapshot?.({
      threadId,
      snapshot: {
        id: threadId,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:01.000Z",
        messages: [],
        events: Array.from({ length: 5_000 }, (_, index) => ({
          id: `event-${index}`,
          threadId,
          runId: "run-many-events",
          sequence: index + 1,
          occurredAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(),
          type: "run.status" as const,
          status: "running" as const,
        })),
      },
    });

    expect(putCount).toBe(1);
    expect(repository.agentKit.events).toHaveLength(5_000);
    expect(repository.agentKit.events[4_999]).toMatchObject({
      id: "event-4999",
      sequence: 5_000,
    });
    await transport.dispose();
  });

  it("keeps legacy top-level messages visible beside a partial AgentKit history", async () => {
    const threadId = "legacy-snapshot";
    const legacyMessage = {
      id: "legacy-user",
      role: "user",
      content: "The old prompt.",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    let repository: Record<string, any> = {
      messages: [legacyMessage],
      agentKit: {
        messages: [
          {
            id: "agentkit-reply",
            role: "assistant",
            parts: [{ type: "text", text: "A newer reply." }],
            status: "complete",
            createdAt: "2026-10-01T00:00:00.500Z",
          },
        ],
      },
    };
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            title: "Legacy history",
            threadData: JSON.stringify(repository),
          });
        }
        if (url.includes("/runs/active")) return json({ active: false });
        if (url.endsWith(`/threads/${threadId}/fork`) && method === "POST") {
          const body = JSON.parse(String(init?.body));
          return json({
            id: body.id,
            title: body.source.title,
            threadData: body.source.threadData,
          });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          const incoming = JSON.parse(
            JSON.parse(String(init?.body)).threadData,
          );
          repository = mergeThreadDataForClientSave(repository, incoming);
          return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });
    const loaded = await transport.getThreadSnapshot?.({ threadId });
    expect(loaded?.messages.map((message) => message.id)).toEqual([
      "legacy-user",
      "agentkit-reply",
    ]);
    const legacyFork = await transport.forkThread?.({
      threadId,
      fromMessageId: "legacy-user",
    });
    const legacyForkRequest = fetcher.mock.calls.find(([input]) =>
      String(input).endsWith(`/threads/${threadId}/fork`),
    );
    const legacyForkSource = JSON.parse(
      String(legacyForkRequest?.[1]?.body),
    ).source;
    expect(legacyForkSource.messageCount).toBe(1);
    expect(legacyFork?.messages.map((message) => message.id)).toEqual([
      "legacy-user",
    ]);
    const nextMessage = {
      id: "new-assistant",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "A new reply." }],
      createdAt: "2026-10-01T00:00:01.000Z",
    };

    await transport.persistThreadSnapshot?.({
      threadId,
      snapshot: {
        ...loaded!,
        messages: [...loaded!.messages, nextMessage],
      },
    });
    const reloaded = await transport.getThreadSnapshot?.({ threadId });

    expect(repository.agentKit.messages).toMatchObject([
      { id: "agentkit-reply", role: "assistant" },
      { id: "new-assistant", role: "assistant" },
    ]);
    expect(reloaded?.messages.map((message) => message.id)).toEqual([
      "legacy-user",
      "agentkit-reply",
      "new-assistant",
    ]);
    const fork = await transport.forkThread?.({
      threadId,
      fromMessageId: "agentkit-reply",
    });
    const forkRequest = fetcher.mock.calls
      .filter(([input]) => String(input).endsWith(`/threads/${threadId}/fork`))
      .at(-1);
    const forkSource = JSON.parse(String(forkRequest?.[1]?.body)).source;
    expect(forkSource.messageCount).toBe(2);
    expect(
      JSON.parse(forkSource.threadData).agentKit.messages.map(
        (message: { id: string }) => message.id,
      ),
    ).toEqual(["legacy-user", "agentkit-reply"]);
    expect(fork?.messages.map((message) => message.id)).toEqual([
      "legacy-user",
      "agentkit-reply",
    ]);
    await transport.dispose();
  });

  it("sizes escaped snapshot entries and retries a transient chunk failure", async () => {
    const threadId = "escaped-events";
    const largeLabel = '"\\'.repeat(150_000);
    let repository: Record<string, any> = { messages: [], agentKit: {} };
    const attemptedSizes: number[] = [];
    let failOnce = true;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            threadData: JSON.stringify(repository),
          });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          const body = String(init?.body);
          attemptedSizes.push(new TextEncoder().encode(body).byteLength);
          if (failOnce) {
            failOnce = false;
            return json({ error: "Temporary storage failure" }, 503);
          }
          const incoming = JSON.parse(JSON.parse(body).threadData);
          repository = mergeThreadDataForClientSave(repository, incoming);
          return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.persistThreadSnapshot?.({
      threadId,
      snapshot: {
        id: threadId,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:01.000Z",
        messages: [],
        events: Array.from({ length: 4 }, (_, index) => ({
          id: `event-${index}`,
          threadId,
          runId: "run-escaped",
          sequence: index + 1,
          occurredAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(),
          type: "activity.started" as const,
          activity: {
            id: `activity-${index}`,
            kind: "tool",
            label: largeLabel,
            status: "running",
          },
        })),
      },
    });

    expect(attemptedSizes).toHaveLength(3);
    expect(attemptedSizes[0]).toBe(attemptedSizes[1]);
    expect(Math.max(...attemptedSizes)).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(repository.agentKit.events).toHaveLength(4);
    await transport.dispose();
  });

  it("merges the incoming snapshot into a thread after concurrent create returns 409", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    let threadReads = 0;
    let serverThreadData: string | undefined;
    let savedThreadData: string | undefined;
    let savedMessageCount: number | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({ url, method });
        if (url.endsWith("/threads/raced-thread")) {
          if (method === "GET") {
            threadReads++;
            if (threadReads === 1) {
              return json({ error: "Thread not found" }, 404);
            }
            serverThreadData = JSON.stringify({
              messages: [
                {
                  id: "legacy-only-prompt",
                  role: "user",
                  content: "Keep the legacy prompt",
                },
              ],
              agentKit: {
                messages: [
                  {
                    id: "saved-prompt",
                    role: "user",
                    parts: [{ type: "text", text: "Stale prompt text" }],
                  },
                  {
                    id: "stored-only-prompt",
                    role: "user",
                    parts: [{ type: "text", text: "Keep stored history" }],
                  },
                ],
                toolCalls: [
                  {
                    id: "shared-tool",
                    name: "old-tool-name",
                    input: { version: "stored" },
                    status: "running",
                    messageId: "saved-prompt",
                  },
                  {
                    id: "stored-only-tool",
                    name: "keep-tool",
                    output: { kept: true },
                    status: "completed",
                  },
                ],
                widgets: [
                  {
                    messageId: "saved-prompt",
                    widget: {
                      id: "saved-widget",
                      kind: "test.action",
                      data: {
                        toolCallId: "saved-tool",
                        toolName: "create-release",
                      },
                      title: "Saved action",
                    },
                  },
                ],
              },
            });
            return json({
              id: "raced-thread",
              title: "Typed prompt",
              threadData: serverThreadData,
            });
          }
          if (method === "PUT") {
            const body = JSON.parse(String(init?.body));
            serverThreadData = JSON.stringify(
              mergeThreadDataForClientSave(
                JSON.parse(serverThreadData ?? "{}"),
                JSON.parse(body.threadData),
              ),
            );
            savedThreadData = serverThreadData;
            savedMessageCount = body.messageCount;
            return json({ ok: true });
          }
        }
        if (url === "/_agent-native/agent-chat/threads" && method === "POST") {
          return json({ error: "Thread id already in use" }, 409);
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.persistThreadSnapshot?.({
      threadId: "raced-thread",
      snapshot: {
        id: "raced-thread",
        title: "Typed prompt",
        createdAt: "2026-09-30T00:00:00.000Z",
        updatedAt: "2026-09-30T00:00:00.000Z",
        messages: [
          {
            id: "saved-prompt",
            role: "user",
            parts: [{ type: "text", text: "Updated prompt text" }],
          },
        ],
        toolCalls: [
          {
            id: "shared-tool",
            name: "new-tool-name",
            input: { version: "incoming" },
            output: { saved: true },
            status: "completed",
            messageId: "saved-prompt",
          },
        ],
        widgets: [
          {
            messageId: "missing-message",
            widget: {
              id: "orphan-widget",
              kind: "test.action",
              data: {
                toolCallId: "orphan-tool",
                toolName: "create-release",
              },
            },
          },
        ],
      },
    });

    expect(requests.map(({ method }) => method)).toEqual([
      "GET",
      "POST",
      "GET",
      "PUT",
    ]);
    const saved = JSON.parse(savedThreadData ?? "{}");
    expect(saved.messages.map((entry: any) => entry.message)).toEqual([
      {
        id: "legacy-only-prompt",
        role: "user",
        content: "Keep the legacy prompt",
      },
    ]);
    expect(saved.agentKit.messages).toEqual([
      expect.objectContaining({
        id: "saved-prompt",
        role: "user",
        parts: [
          expect.objectContaining({
            type: "text",
            text: "Updated prompt text",
          }),
        ],
      }),
      expect.objectContaining({
        id: "stored-only-prompt",
        role: "user",
        parts: [
          expect.objectContaining({
            type: "text",
            text: "Keep stored history",
          }),
        ],
      }),
    ]);
    expect(saved.agentKit.toolCalls).toEqual([
      {
        id: "shared-tool",
        name: "new-tool-name",
        input: { version: "incoming" },
        output: { saved: true },
        status: "completed",
        messageId: "saved-prompt",
      },
      {
        id: "stored-only-tool",
        name: "keep-tool",
        output: { kept: true },
        status: "completed",
      },
    ]);
    expect(saved.agentKit.widgets).toEqual([
      {
        messageId: "saved-prompt",
        widget: {
          id: "saved-widget",
          kind: "test.action",
          data: {
            toolCallId: "saved-tool",
            toolName: "create-release",
          },
          title: "Saved action",
        },
      },
    ]);
    expect(savedMessageCount).toBe(3);
  });

  it("preserves a thread-create failure when no accessible row exists", async () => {
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/threads/rejected-thread")) {
          return json({ error: "Thread not found" }, 404);
        }
        if (String(input).endsWith("/threads") && init?.method === "POST") {
          return json({ error: "Unavailable" }, 503);
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      transport.persistThreadSnapshot?.({
        threadId: "rejected-thread",
        snapshot: {
          id: "rejected-thread",
          createdAt: "2026-09-30T00:00:00.000Z",
          updatedAt: "2026-09-30T00:00:00.000Z",
          messages: [],
        },
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      isolateHistoryByScope: true,
      expectedQuery: "?scopeType=workspace-app&scopeId=app-one",
    },
    { isolateHistoryByScope: false, expectedQuery: "" },
  ])(
    "scopes thread restore and queue persistence only when history isolation is enabled",
    async ({ isolateHistoryByScope, expectedQuery }) => {
      const apiUrl = "/_agent-native/agent-chat";
      const fetcher = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          if (url.startsWith(`${apiUrl}/threads/thread-scope/queued`)) {
            const mutation = JSON.parse(String(init?.body)).mutation;
            return json({
              queuedMessages: [mutation.message],
              message: mutation.message,
            });
          }
          if (url.startsWith(`${apiUrl}/threads/thread-scope`)) {
            return json({
              id: "thread-scope",
              createdAt: "2026-09-01T00:00:00.000Z",
              updatedAt: "2026-09-01T00:00:00.000Z",
              threadData: JSON.stringify({ messages: [], queuedMessages: [] }),
            });
          }
          return json({ error: "Not found" }, 404);
        },
      );
      const transport = createAgentNativeAgentKitTransport({
        apiUrl,
        fetch: fetcher as typeof fetch,
        scope: { type: "workspace-app", id: "app-one" },
        isolateHistoryByScope,
        adapter: { createId: () => "queued-one" },
      });

      await transport.queueMessage?.({
        threadId: "thread-scope",
        text: "Run this next",
      });

      expect(
        fetcher.mock.calls
          .map(([input]) => String(input))
          .filter((url) => url.includes("/threads/thread-scope")),
      ).toEqual([`${apiUrl}/threads/thread-scope/queued${expectedQuery}`]);
      await transport.dispose();
    },
  );

  it("appends queue messages from independent transports without replacing snapshots", async () => {
    const persisted: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/threads/thread-cross-tab/queued")) {
          const mutation = JSON.parse(String(init?.body)).mutation;
          if (
            mutation.type === "append" &&
            !persisted.some((message) => message.id === mutation.message.id)
          ) {
            persisted.push(mutation.message);
          }
          return json({
            queuedMessages: persisted,
            message: mutation.message,
          });
        }
        if (url.endsWith("/threads/thread-cross-tab")) {
          return json({
            id: "thread-cross-tab",
            threadData: JSON.stringify({ queuedMessages: persisted }),
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    let nextId = 0;
    const createTransport = () =>
      createAgentNativeAgentKitTransport({
        apiUrl: "/_agent-native/agent-chat",
        fetch: fetcher as typeof fetch,
        adapter: { createId: () => `queued-${++nextId}` },
      });
    const first = createTransport();
    const second = createTransport();

    await Promise.all([
      first.queueMessage?.({ threadId: "thread-cross-tab", text: "First" }),
      second.queueMessage?.({ threadId: "thread-cross-tab", text: "Second" }),
    ]);

    expect(persisted.map((message) => message.text)).toEqual([
      "First",
      "Second",
    ]);
    expect(
      fetcher.mock.calls
        .filter(([input]) => String(input).endsWith("/queued"))
        .map(([, init]) => JSON.parse(String(init?.body))),
    ).toEqual([
      { mutation: expect.objectContaining({ type: "append" }) },
      { mutation: expect.objectContaining({ type: "append" }) },
    ]);
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("restores action widgets from durable assistant tool results", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-1",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            messages: [
              {
                id: "assistant-1",
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "tool-1",
                    toolName: "apply-ai-filter",
                    args: { mode: "filter" },
                    result: JSON.stringify({ changed: 5 }),
                    chatUIResult: { changed: 5 },
                    chatUI: {
                      renderer: "mail.ai-filter-confirmation",
                      title: "AI filter result",
                    },
                  },
                ],
              },
            ],
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-1",
    });

    expect(snapshot).toMatchObject({
      toolCalls: [
        {
          id: "tool-1",
          name: "apply-ai-filter",
          input: { mode: "filter" },
          output: { changed: 5 },
          status: "completed",
          messageId: "assistant-1",
        },
      ],
      widgets: [
        {
          messageId: "assistant-1",
          widget: {
            id: "tool-1:chat-ui",
            kind: "mail.ai-filter-confirmation",
            title: "AI filter result",
            data: {
              toolCallId: "tool-1",
              toolName: "apply-ai-filter",
            },
          },
        },
      ],
    });
  });

  it("restores widgets already stored in the AgentKit snapshot", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-agentkit-widget",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            agentKit: {
              messages: [
                {
                  id: "assistant-agentkit",
                  role: "assistant",
                  parts: [{ type: "text", text: "Done." }],
                },
              ],
              widgets: [
                {
                  messageId: "assistant-agentkit",
                  widget: {
                    id: "widget-agentkit",
                    kind: "mail.ai-filter-confirmation",
                    data: { changed: 5 },
                  },
                },
              ],
            },
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-agentkit-widget",
    });

    expect(snapshot?.widgets).toEqual([
      {
        messageId: "assistant-agentkit",
        widget: {
          id: "widget-agentkit",
          kind: "mail.ai-filter-confirmation",
          data: { changed: 5 },
        },
      },
    ]);
  });

  it("persists compact completed activity history without replacing messages", async () => {
    const repository = {
      queuedMessages: [{ id: "queued-after-snapshot-read", text: "Later" }],
      messages: [
        {
          id: "assistant-legacy",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "tool-history",
              toolName: "create-release",
              args: {},
              result: { ok: true },
              chatUI: { renderer: "test.action", title: "Release created" },
            },
          ],
        },
      ],
      retained: true,
      agentKit: {
        messages: [
          {
            id: "assistant-stale",
            role: "assistant",
            parts: [{ type: "text", text: "Old response." }],
          },
        ],
      },
    };
    let threadData = JSON.stringify(repository);
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/runs/active?threadId=thread-history")) {
          return json({ active: false });
        }
        if (url.endsWith("/threads/thread-history") && init?.method === "PUT") {
          const incoming = JSON.parse(JSON.parse(String(init.body)).threadData);
          threadData = JSON.stringify(
            mergeThreadDataForClientSave(JSON.parse(threadData), incoming),
          );
          return json({ ok: true });
        }
        if (url.endsWith("/threads/thread-history")) {
          return json({
            id: "thread-history",
            createdAt: "2026-09-26T00:00:00.000Z",
            updatedAt: "2026-09-26T00:01:00.000Z",
            threadData,
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      fetch: fetcher as typeof fetch,
      adapter: { now: () => "2026-09-26T00:01:00.000Z" },
    });

    await transport.persistThreadSnapshot?.({
      threadId: "thread-history",
      snapshot: {
        id: "thread-history",
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:01:00.000Z",
        messages: [
          {
            id: "user-approval",
            role: "user",
            parts: [
              {
                type: "file",
                name: "durable-upload.txt",
                fileId: "upload-1",
                url: "data:text/plain;base64,c2VjcmV0",
              },
              {
                type: "file",
                name: "inline-secret.txt",
                url: "data:text/plain;base64,c2VjcmV0",
              },
              {
                type: "file",
                name: "remote.txt",
                url: "https://files.example.test/remote.txt",
              },
            ],
            metadata: {
              hideUserMessage: true,
              privatePrompt: "do not persist this metadata",
              custom: {
                agentNativeRecoveryOfRunId: "run-refused",
                privateNote: "do not persist custom metadata",
              },
            },
          },
          {
            id: "assistant-history",
            role: "assistant",
            parts: [
              { type: "text", text: "Release created." },
              { type: "data", data: { private: "do not persist raw data" } },
            ],
          },
        ],
        toolCalls: [
          {
            id: "tool-history",
            name: "create-release",
            input: { release: "agentkit-acceptance" },
            output: { display: { title: "Release created" } },
            status: "completed",
            messageId: "assistant-history",
          },
          {
            id: "tool-string-history",
            name: "string-result",
            input: {},
            output: '{"value":1}',
            status: "completed",
          },
          {
            id: "tool-large-history",
            name: "large-result",
            output: "x".repeat(65_536),
            status: "completed",
            messageId: "assistant-history",
          },
        ],
        widgets: [
          {
            messageId: "assistant-history",
            widget: {
              id: "tool-history:chat-ui",
              kind: "test.action",
              data: {
                toolCallId: "tool-history",
                toolName: "create-release",
                raw: "do not persist widget payloads",
              },
              title: "Release created",
              metadata: { description: "Created one release." },
              actions: [{ id: "raw-action", label: "Discard" }],
            },
          },
          {
            messageId: "assistant-pending",
            widget: {
              id: "pending:chat-ui",
              kind: "test.action",
              data: { toolCallId: "pending", toolName: "create-release" },
            },
          },
        ],
        events: [
          {
            id: "history-1",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 1,
            occurredAt: "2026-09-26T00:00:01.000Z",
            type: "run.started",
          },
          {
            id: "history-2",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 2,
            occurredAt: "2026-09-26T00:00:02.000Z",
            type: "activity.started",
            activity: {
              id: "activity-history",
              kind: "tool",
              label: "Create release",
              status: "running",
            },
          },
          {
            id: "history-3",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 3,
            occurredAt: "2026-09-26T00:00:03.000Z",
            type: "activity.completed",
            activity: {
              id: "activity-history",
              kind: "tool",
              label: "Create release",
              detail: "A long action result",
              status: "completed",
            },
          },
          {
            id: "history-4",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 4,
            occurredAt: "2026-09-26T00:00:04.000Z",
            type: "message.completed",
            message: {
              id: "assistant-history",
              role: "assistant",
              parts: [{ type: "text", text: "Release created." }],
              status: "complete",
            },
          },
          {
            id: "history-5",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 5,
            occurredAt: "2026-09-26T00:00:05.000Z",
            type: "tool.updated",
            toolCall: {
              id: "tool-history",
              name: "create-release",
              output: "Do not persist this duplicate result",
              status: "completed",
            },
          },
          {
            id: "history-6",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 6,
            occurredAt: "2026-09-26T00:00:06.000Z",
            type: "run.completed",
          },
          {
            id: "history-error",
            threadId: "thread-history",
            runId: "run-error",
            sequence: 1,
            occurredAt: "2026-09-26T00:00:07.000Z",
            type: "run.failed",
            error: {
              code: "provider_error",
              message: "Provider failed. ".repeat(200),
              retryable: false,
              correlationId: "provider-trace-1",
              details: { secret: "do not persist error details" },
              metadata: { private: "do not persist error metadata" },
            },
          },
        ],
        runs: [
          {
            id: "run-history",
            threadId: "thread-history",
            status: "completed",
            lastSequence: 6,
            startedAt: "2026-09-26T00:00:01.000Z",
            completedAt: "2026-09-26T00:00:06.000Z",
          },
          {
            id: "run-error",
            threadId: "thread-history",
            status: "failed",
            lastSequence: 1,
            error: {
              code: "provider_error",
              message: "Provider failed. ".repeat(200),
              retryable: false,
              correlationId: "provider-trace-1",
              details: { secret: "do not persist error details" },
              metadata: { private: "do not persist error metadata" },
            },
          },
        ],
        activeRunIds: [],
        suggestions: [
          { id: "release-summary", label: "Summarize this release" },
        ],
        annotations: [
          {
            messageId: "assistant-history",
            annotation: {
              id: "annotation-history",
              kind: "source",
              label: "Release notes",
              url: "https://docs.example.test/release",
              start: 0,
              end: 15,
              metadata: { private: "do not persist annotation metadata" },
            },
          },
          {
            messageId: "missing-message",
            annotation: {
              id: "annotation-orphan",
              kind: "reference",
              label: "Orphan",
            },
          },
        ],
      },
    });

    const restored = await transport.getThreadSnapshot?.({
      threadId: "thread-history",
    });
    const saved = JSON.parse(threadData);

    expect(saved.messages.map((entry: any) => entry.message)).toEqual(
      repository.messages,
    );
    expect(saved.retained).toBe(true);
    expect(saved.queuedMessages).toEqual(repository.queuedMessages);
    expect(saved.agentKit.messages).toEqual([
      {
        id: "assistant-stale",
        role: "assistant",
        parts: [{ type: "text", text: "Old response." }],
      },
      {
        id: "user-approval",
        role: "user",
        parts: [
          {
            type: "file",
            name: "durable-upload.txt",
            fileId: "upload-1",
          },
          {
            type: "file",
            name: "remote.txt",
            url: "https://files.example.test/remote.txt",
          },
        ],
        metadata: {
          hideUserMessage: true,
          custom: { agentNativeRecoveryOfRunId: "run-refused" },
        },
      },
      {
        id: "assistant-history",
        role: "assistant",
        parts: [{ type: "text", text: "Release created." }],
      },
    ]);
    expect(JSON.stringify(saved.agentKit.messages)).not.toContain(
      "do not persist custom metadata",
    );
    expect(JSON.stringify(saved.agentKit.messages)).not.toContain(
      "do not persist raw data",
    );
    expect(JSON.stringify(saved.agentKit.messages)).not.toContain("c2VjcmV0");
    expect(JSON.stringify(saved.agentKit.messages)).not.toContain(
      "do not persist this metadata",
    );
    expect(saved.agentKit.annotations).toEqual([
      {
        messageId: "assistant-history",
        annotation: {
          id: "annotation-history",
          kind: "source",
          label: "Release notes",
          url: "https://docs.example.test/release",
          start: 0,
          end: 15,
        },
      },
    ]);
    expect(saved.agentKit.widgets).toEqual([
      {
        messageId: "assistant-history",
        widget: {
          id: "tool-history:chat-ui",
          kind: "test.action",
          data: { toolCallId: "tool-history", toolName: "create-release" },
          title: "Release created",
          metadata: { description: "Created one release." },
        },
      },
    ]);
    expect(JSON.stringify(saved.agentKit.widgets)).not.toContain(
      "do not persist widget payloads",
    );
    expect(saved.agentKit.toolCalls).toEqual([
      {
        id: "tool-history",
        name: "create-release",
        status: "completed",
        input: { release: "agentkit-acceptance" },
        output: { display: { title: "Release created" } },
        messageId: "assistant-history",
      },
      {
        id: "tool-string-history",
        name: "string-result",
        status: "completed",
        input: {},
        output: '{"value":1}',
      },
      {
        id: "tool-large-history",
        name: "large-result",
        status: "completed",
        messageId: "assistant-history",
        metadata: {
          agentKitSnapshot: {
            toolCallResult: "omitted",
            reason: "size_limit",
          },
        },
      },
    ]);
    expect(
      saved.agentKit.events.map((event: AgentEvent) => event.type),
    ).toEqual([
      "run.started",
      "activity.started",
      "activity.completed",
      "message.completed",
      "run.completed",
      "run.failed",
    ]);
    expect(saved.agentKit.events[2].activity.detail).toBeUndefined();
    expect(saved.agentKit.events.at(-1).error).toMatchObject({
      code: "provider_error",
      retryable: false,
      correlationId: "provider-trace-1",
    });
    expect(saved.agentKit.events.at(-1).error.message).toHaveLength(2_048);
    expect(Object.keys(saved.agentKit.events.at(-1).error).sort()).toEqual([
      "code",
      "correlationId",
      "message",
      "retryable",
    ]);
    expect(
      saved.agentKit.runs.find((run: { id: string }) => run.id === "run-error")
        ?.error,
    ).toEqual(saved.agentKit.events.at(-1).error);
    expect(JSON.stringify(saved.agentKit)).not.toContain(
      "do not persist error details",
    );
    expect(JSON.stringify(saved.agentKit)).not.toContain(
      "do not persist error metadata",
    );
    expect(restored?.events?.map((event) => event.type)).toEqual([
      "run.started",
      "activity.started",
      "activity.completed",
      "message.completed",
      "run.completed",
      "run.failed",
    ]);
    expect(restored?.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "run-history", status: "completed" }),
        expect.objectContaining({
          id: "run-error",
          status: "failed",
          error: saved.agentKit.events.at(-1).error,
        }),
      ]),
    );
    expect(restored?.messages).toEqual([
      {
        id: "assistant-stale",
        role: "assistant",
        parts: [{ type: "text", text: "Old response." }],
      },
      {
        id: "user-approval",
        role: "user",
        parts: [
          {
            type: "file",
            name: "durable-upload.txt",
            fileId: "upload-1",
          },
          {
            type: "file",
            name: "remote.txt",
            url: "https://files.example.test/remote.txt",
          },
        ],
        metadata: {
          hideUserMessage: true,
          custom: { agentNativeRecoveryOfRunId: "run-refused" },
        },
      },
      {
        id: "assistant-history",
        role: "assistant",
        parts: [{ type: "text", text: "Release created." }],
      },
    ]);
    expect(restored?.annotations).toEqual(saved.agentKit.annotations);
    expect(restored?.widgets).toEqual([
      {
        messageId: "assistant-history",
        widget: {
          id: "tool-history:chat-ui",
          kind: "test.action",
          data: { toolCallId: "tool-history", toolName: "create-release" },
          title: "Release created",
          metadata: { description: "Created one release." },
        },
      },
    ]);
    expect(restored?.toolCalls).toEqual([
      {
        id: "tool-history",
        name: "create-release",
        status: "completed",
        input: { release: "agentkit-acceptance" },
        output: { display: { title: "Release created" } },
        messageId: "assistant-history",
      },
      {
        id: "tool-string-history",
        name: "string-result",
        status: "completed",
        input: {},
        output: '{"value":1}',
      },
      {
        id: "tool-large-history",
        name: "large-result",
        status: "completed",
        messageId: "assistant-history",
        metadata: {
          agentKitSnapshot: {
            toolCallResult: "omitted",
            reason: "size_limit",
          },
        },
      },
    ]);
    expect(restored?.suggestions).toEqual([]);
    expect(saved.agentKit.suggestions).toEqual([]);
  });

  it("rejects non-JSON tool results instead of hiding snapshot data loss", async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: "thread-non-json",
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:01:00.000Z",
        threadData: JSON.stringify({}),
      }),
    );
    const transport = createAgentNativeAgentKitTransport({
      fetch: fetcher as typeof fetch,
    });
    const output: { self?: unknown } = {};
    output.self = output;

    await expect(
      transport.persistThreadSnapshot?.({
        threadId: "thread-non-json",
        snapshot: {
          id: "thread-non-json",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          messages: [],
          toolCalls: [
            {
              id: "tool-circular",
              name: "circular-result",
              output,
              status: "completed",
            },
          ],
        },
      }),
    ).rejects.toThrow(/circular|cyclic/i);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("shows a turn the server refused before its run started as a failed run, not an unanswered prompt", async () => {
    const threadData = foldUnstartedTurnFailure(
      upsertUserMessage(
        {},
        buildUserMessage({
          text: "Create a pitch deck",
          runId: "turn-1",
          turnId: "turn-1",
          refusedRetry: {
            references: [{ id: "reference-1", type: "document" }],
            model: "model-original",
            effort: "high",
            requestMode: "plan",
          },
        }),
      ),
      {
        runId: "turn-1",
        threadId: "thread-refused",
        turnId: "turn-1",
        code: "missing_credentials",
        message: "No LLM provider is connected.",
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({
              id: "thread-refused",
              threadData: JSON.stringify(threadData),
            }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-refused",
    });

    expect(snapshot?.messages).toMatchObject([
      {
        role: "user",
        parts: [{ type: "text", text: "Create a pitch deck" }],
        // What a retry after reload resends, and which prompt was refused.
        metadata: {
          references: [{ id: "reference-1", type: "document" }],
          model: "model-original",
          effort: "high",
          requestMode: "plan",
          custom: {
            submittedRunId: "turn-1",
            agentNativeRunNotStarted: true,
          },
        },
      },
    ]);
    expect(snapshot?.runs).toMatchObject([
      {
        id: "turn-1",
        threadId: "thread-refused",
        status: "failed",
        error: {
          code: "missing_credentials",
          message: "No LLM provider is connected.",
        },
      },
    ]);
    await transport.dispose();
  });

  it("reports a turn refused at its start under the id the server recorded", async () => {
    const sentTurnIds: string[] = [];
    let respond: () => Response | Promise<Response> = () =>
      json(
        {
          error: "Use Builder.io or a provider API key before chatting.",
          code: "AGENT_CHAT_AI_SETUP_REQUIRED",
        },
        403,
      );
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
      sentTurnIds.push(JSON.parse(String(init?.body)).turnId);
      return respond();
    });
    const reports: RunOutcomeReport[] = [];
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
      adapter: { onRunOutcome: (report) => reports.push(report) },
    });
    const start = () =>
      transport.startRun({
        threadId: "thread-1",
        messages: [
          {
            id: "user-1",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
      });

    await expect(start()).rejects.toMatchObject({
      code: "AGENT_CHAT_AI_SETUP_REQUIRED",
      status: 403,
    });
    expect(reports).toEqual([
      expect.objectContaining({
        runId: sentTurnIds[0],
        threadId: "thread-1",
        outcome: "failed",
        code: "AGENT_CHAT_AI_SETUP_REQUIRED",
        terminalSource: "local",
      }),
    ]);
    expect(agentTroubleCauseForCode(reports[0]!.code)).toBe(
      "no_model_connected",
    );

    respond = () => {
      throw new DOMException("signal is aborted without reason", "AbortError");
    };
    await expect(start()).rejects.toMatchObject({ name: "AbortError" });
    respond = () => json({ code: "run_slot_busy" }, 409);
    await expect(start()).rejects.toMatchObject({ status: 409 });
    expect(reports).toHaveLength(1);
    await transport.dispose();
  });

  describe("a prompt the server refused before its run started", () => {
    const reference = {
      type: "file",
      path: "docs/brief.md",
      name: "brief.md",
      source: "workspace",
    };
    const retryContext = {
      references: [reference],
      model: "model-original",
      engine: "engine-original",
      effort: "high",
      requestMode: "plan",
    } as const;

    function serverRefusal() {
      return foldUnstartedTurnFailure(
        upsertUserMessage(
          {},
          buildUserMessage({
            text: "Create a pitch deck",
            runId: "turn-1",
            turnId: "turn-1",
            agentKitMessageId: "client-user-1",
            refusedRetry: retryContext,
          }),
        ),
        {
          runId: "turn-1",
          threadId: "thread-refused",
          turnId: "turn-1",
          code: "missing_credentials",
          message: "No LLM provider is connected.",
        },
      );
    }

    // A server that applies the same merge a client thread PUT goes through.
    function threadServer(initial: unknown) {
      let repo = initial;
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(
          async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.includes("/runs/active")) return json({ active: false });
            if (init?.method === "PUT") {
              repo = mergeThreadDataForClientSave(
                repo,
                JSON.parse(JSON.parse(String(init.body)).threadData),
              );
              return json({ ok: true });
            }
            return json({
              id: "thread-refused",
              createdAt: "2026-10-01T00:00:00.000Z",
              updatedAt: "2026-10-01T00:00:01.000Z",
              threadData: JSON.stringify(repo),
            });
          },
        ) as typeof fetch,
        adapter: { now: () => "2026-10-01T00:00:02.000Z" },
      });
      return transport;
    }

    const refusedPrompt = (
      snapshot: Awaited<
        ReturnType<
          NonNullable<
            ReturnType<
              typeof createAgentNativeAgentKitTransport
            >["getThreadSnapshot"]
          >
        >
      >,
    ) => snapshot?.messages.find((message) => message.role === "user");

    const expectedMetadata = {
      ...retryContext,
      custom: {
        agentNativeRunNotStarted: true,
        submittedRunId: "turn-1",
        submittedTurnId: "turn-1",
      },
    };

    it("keeps its marker and retry context when the client saves the loaded thread and reloads", async () => {
      const transport = threadServer(serverRefusal());
      const loaded = await transport.getThreadSnapshot?.({
        threadId: "thread-refused",
      });
      expect(refusedPrompt(loaded)?.metadata).toMatchObject(expectedMetadata);

      await transport.persistThreadSnapshot?.({
        threadId: "thread-refused",
        snapshot: loaded!,
      });
      const reloaded = await transport.getThreadSnapshot?.({
        threadId: "thread-refused",
      });

      expect(refusedPrompt(reloaded)?.metadata).toMatchObject(expectedMetadata);
      await transport.dispose();
    });

    it("restores them when the client saves its own copy of the prompt without them", async () => {
      const transport = threadServer(serverRefusal());
      const loaded = await transport.getThreadSnapshot?.({
        threadId: "thread-refused",
      });
      // The client's copy of the same prompt: its own id, and the only
      // metadata a save keeps, as after an in-session refusal.
      const clientCopy = {
        id: "client-user-1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Create a pitch deck" }],
        createdAt: refusedPrompt(loaded)?.createdAt,
        status: "error" as const,
      };

      await transport.persistThreadSnapshot?.({
        threadId: "thread-refused",
        snapshot: {
          ...loaded!,
          messages: loaded!.messages.map((message) =>
            message.role === "user" ? clientCopy : message,
          ),
        },
      });
      const reloaded = await transport.getThreadSnapshot?.({
        threadId: "thread-refused",
      });

      const prompt = refusedPrompt(reloaded);
      expect(prompt?.id).toBe("client-user-1");
      expect(prompt?.metadata).toMatchObject(expectedMetadata);
      expect(
        reloaded?.messages.filter((message) => message.role === "user"),
      ).toHaveLength(1);
      await transport.dispose();
    });
  });

  it("restores the complete durable reply when a same-id AgentKit snapshot is shorter", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({
              id: "thread-short-reply",
              threadData: JSON.stringify({
                messages: [
                  {
                    message: {
                      id: "assistant-1",
                      role: "assistant",
                      status: "complete",
                      content: [
                        { type: "text", text: "Full answer with final lines" },
                      ],
                    },
                  },
                ],
                agentKit: {
                  messages: [
                    {
                      id: "assistant-1",
                      role: "assistant",
                      status: "complete",
                      parts: [{ type: "text", text: "Full answer" }],
                    },
                  ],
                },
              }),
            }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-short-reply",
    });

    expect(snapshot?.messages).toMatchObject([
      {
        id: "assistant-1",
        parts: [{ type: "text", text: "Full answer with final lines" }],
      },
    ]);
    await transport.dispose();
  });

  it("restores the durable reply by run ID when message IDs differ and events are absent", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({
              id: "thread-different-ids",
              threadData: JSON.stringify({
                messages: [
                  {
                    message: {
                      id: "server-run-1",
                      role: "assistant",
                      status: "complete",
                      content: [
                        { type: "text", text: "Full answer with final lines" },
                      ],
                      metadata: { runId: "run-1" },
                    },
                  },
                ],
                agentKit: {
                  messages: [
                    {
                      id: "message-1",
                      role: "assistant",
                      status: "complete",
                      parts: [{ type: "text", text: "Full answer" }],
                      metadata: { runId: "run-1" },
                    },
                  ],
                },
              }),
            }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-different-ids",
    });

    expect(snapshot?.messages).toMatchObject([
      {
        id: "message-1",
        parts: [{ type: "text", text: "Full answer with final lines" }],
      },
    ]);
    await transport.dispose();
  });

  it("reconciles a reloaded assistant message through its run snapshot", async () => {
    const threadId = "thread-run-snapshot-reconcile";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "completed", runId: "run-1" })
          : json({
              id: threadId,
              threadData: JSON.stringify({
                messages: [
                  {
                    message: {
                      id: "server-assistant-1",
                      role: "assistant",
                      status: "complete",
                      content: [
                        { type: "text", text: "Full answer with final lines" },
                      ],
                      metadata: { runId: "run-1" },
                    },
                  },
                ],
                agentKit: {
                  messages: [
                    {
                      id: "assistant-1",
                      role: "assistant",
                      status: "streaming",
                      parts: [{ type: "text", text: "Full answer" }],
                    },
                  ],
                  events: [],
                  runs: [
                    {
                      id: "run-1",
                      threadId,
                      status: "running",
                      activeMessageId: "assistant-1",
                      lastSequence: 4,
                    },
                  ],
                },
              }),
            }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages).toMatchObject([
      {
        id: "assistant-1",
        status: "complete",
        parts: [{ type: "text", text: "Full answer with final lines" }],
      },
    ]);
    await transport.dispose();
  });

  // The shape of a thread whose page was reloaded mid-run: the page saved
  // its snapshot with only the prompt, and the server then finished the run.
  function reloadedMidRunThread(agentKitMessages: unknown[]) {
    return {
      id: "thread-reloaded",
      threadData: JSON.stringify({
        messages: [
          {
            message: {
              id: "user-1",
              role: "user",
              status: "complete",
              content: [{ type: "text", text: "Write forty lines" }],
            },
            parentId: null,
          },
          {
            message: {
              id: "server-run-1",
              role: "assistant",
              status: { type: "complete", reason: "stop" },
              content: [{ type: "text", text: "L1: one\nL40: forty" }],
              metadata: {
                runId: "run-1",
                custom: { turnId: "turn-1", foldedRunIds: ["run-1"] },
              },
            },
            parentId: "user-1",
          },
        ],
        agentKit: {
          messages: agentKitMessages,
          events: [],
          runs: [
            {
              id: "run-1",
              threadId: "thread-reloaded",
              status: "completed",
              startedAt: "2026-10-01T23:54:23.807Z",
              lastSequence: 0,
            },
          ],
          activeRunIds: [],
        },
      }),
    };
  }
  const reloadedPrompt = {
    id: "user-1",
    role: "user",
    status: "complete",
    parts: [{ type: "text", text: "Write forty lines" }],
  };

  // `active` is false once the run is no longer in flight; the finished run's
  // id and status still come back inside the reconnect window for replay.
  it.each([true, false])(
    "restores a finished run's reply the reloaded page never saved into the AgentKit snapshot (active: %s)",
    async (active) => {
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) =>
          String(input).includes("/runs/active")
            ? json({ active, status: "completed", runId: "run-1" })
            : json(reloadedMidRunThread([reloadedPrompt])),
        ) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({
        threadId: "thread-reloaded",
      });

      expect(snapshot?.messages).toMatchObject([
        { id: "user-1", role: "user" },
        {
          id: "server-run-1",
          role: "assistant",
          parts: [{ type: "text", text: "L1: one\nL40: forty" }],
        },
      ]);
      expect(snapshot?.runs?.find((run) => run.id === "run-1")?.status).toBe(
        "completed",
      );
      expect(snapshot?.activeRunIds ?? []).toEqual([]);
      await transport.dispose();
    },
  );

  // The stale-run reaper recovered turn-1: run-1 was interrupted and run-2,
  // a successor on the same turn, carried it on.
  function recoveredTurnThread(input: {
    run1: Record<string, unknown>;
    successorReply: boolean;
    successorFailed?: boolean;
    /** The text of each message the open page saved for run-1, run-2's included. */
    pageSaw?: string[];
  }) {
    const streamed = (id: string, sequence: number) => ({
      id: `run-1:${sequence}`,
      type: "message.created",
      threadId: "thread-recovered",
      runId: "run-1",
      sequence,
      occurredAt: "2026-10-05T17:00:50.000Z",
      message: { id, role: "assistant", parts: [] },
    });
    return {
      id: "thread-recovered",
      threadData: JSON.stringify({
        messages: [
          {
            message: {
              id: "server-user-run-1",
              role: "user",
              status: "complete",
              content: [{ type: "text", text: "Handle the refund" }],
              metadata: {
                custom: {
                  submittedRunId: "run-1",
                  submittedTurnId: "turn-1",
                },
              },
            },
            parentId: null,
          },
          ...(input.successorReply
            ? [
                {
                  message: {
                    id: "server-run-2",
                    role: "assistant",
                    status: input.successorFailed
                      ? { type: "incomplete", reason: "error" }
                      : { type: "complete", reason: "stop" },
                    content: [{ type: "text", text: "Refund handled." }],
                    metadata: {
                      runId: "run-2",
                      custom: { turnId: "turn-1", foldedRunIds: ["run-2"] },
                    },
                  },
                  parentId: "server-user-run-1",
                },
              ]
            : []),
        ],
        agentKit: {
          messages: [
            {
              id: "user-1",
              role: "user",
              status: "complete",
              parts: [{ type: "text", text: "Handle the refund" }],
            },
            ...(input.pageSaw ?? []).map((text, index) => ({
              id: `assistant-${index + 1}`,
              role: "assistant",
              status: "complete",
              parts: text ? [{ type: "text", text }] : [],
            })),
          ],
          events: (input.pageSaw ?? []).map((_text, index) =>
            streamed(`assistant-${index + 1}`, index + 1),
          ),
          runs: [
            {
              id: "run-1",
              threadId: "thread-recovered",
              startedAt: "2026-10-05T17:00:48.000Z",
              lastSequence: 0,
              ...input.run1,
            },
          ],
          activeRunIds: [],
        },
      }),
    };
  }
  const staleRunFailure = {
    status: "failed",
    error: {
      code: "stale_run",
      message:
        "The agent stopped before it could finish. It may have hit a server timeout or the worker may have been interrupted.",
      retryable: true,
    },
  };

  it.each([
    {
      label: "the open page saved its failure",
      run1: staleRunFailure,
      active: { active: false, status: "completed", runId: "run-2" },
    },
    {
      label: "the page closed mid-run",
      run1: { status: "running" },
      active: { active: false, status: "completed", runId: "run-2" },
    },
    {
      label: "the server no longer reports the turn",
      run1: staleRunFailure,
      active: { active: false, status: "idle" },
    },
  ])(
    "does not report an interrupted run as failed once a successor finished its turn ($label)",
    async ({ run1, active }) => {
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) =>
          String(input).includes("/runs/active")
            ? json({ ...active, turnId: "turn-1" })
            : json(recoveredTurnThread({ run1, successorReply: true })),
        ) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({
        threadId: "thread-recovered",
      });

      const run = snapshot?.runs?.find((entry) => entry.id === "run-1");
      expect(run?.status).toBe("completed");
      expect(run?.error).toBeUndefined();
      expect(
        snapshot?.runs?.filter((entry) => entry.status === "failed"),
      ).toEqual([]);
      expect(snapshot?.messages.at(-1)).toMatchObject({
        id: "server-run-2",
        parts: [{ type: "text", text: "Refund handled." }],
      });
      await transport.dispose();
    },
  );

  it("shows a recovered turn's reply once after the open page followed the successor", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({
              active: false,
              status: "completed",
              runId: "run-2",
              turnId: "turn-1",
            })
          : json(
              recoveredTurnThread({
                run1: { status: "completed" },
                successorReply: true,
                pageSaw: ["", "Refund handled."],
              }),
            ),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-recovered",
    });

    expect(
      snapshot?.messages.filter((message) => message.role === "assistant"),
    ).toMatchObject([
      { id: "assistant-1" },
      {
        id: "assistant-2",
        parts: [{ type: "text", text: "Refund handled." }],
      },
    ]);
    await transport.dispose();
  });

  it.each([
    {
      label: "the page closed before the recovery",
      pageSaw: ["Checking the refund…"],
    },
    {
      label: "the page saw part of the recovery",
      pageSaw: ["Checking the refund…", "Refund"],
    },
    {
      label: "the interrupted attempt only quoted the answer",
      pageSaw: ["Still pending. Expected confirmation: Refund handled."],
    },
  ])(
    "keeps a recovered turn's saved reply the page never fully showed ($label)",
    async ({ pageSaw }) => {
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) =>
          String(input).includes("/runs/active")
            ? json({ active: false, status: "idle" })
            : json(
                recoveredTurnThread({
                  run1: { status: "running" },
                  successorReply: true,
                  pageSaw,
                }),
              ),
        ) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({
        threadId: "thread-recovered",
      });

      expect(snapshot?.messages.at(-1)).toMatchObject({
        id: "server-run-2",
        parts: [{ type: "text", text: "Refund handled." }],
      });
      await transport.dispose();
    },
  );

  it("follows the successor still running an interrupted run's turn instead of failing the run", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({
              active: true,
              status: "running",
              runId: "run-2",
              turnId: "turn-1",
            })
          : json(
              recoveredTurnThread({
                run1: staleRunFailure,
                successorReply: false,
              }),
            ),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-recovered",
    });

    expect(
      snapshot?.runs?.find((run) => run.id === "run-1"),
    ).not.toHaveProperty("error");
    expect(snapshot?.activeRunIds).toEqual(["run-2"]);
    await transport.dispose();
  });

  it("keeps an interrupted run's failure when the run that carried its turn on failed too", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "idle" })
          : json(
              recoveredTurnThread({
                run1: staleRunFailure,
                successorReply: true,
                successorFailed: true,
              }),
            ),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-recovered",
    });

    expect(snapshot?.runs?.find((run) => run.id === "run-1")).toMatchObject({
      status: "failed",
      error: { code: "stale_run" },
    });
    await transport.dispose();
  });

  it("keeps an interrupted run's failure when no newer run carried its turn", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({
              active: false,
              status: "failed",
              runId: "run-1",
              turnId: "turn-1",
              terminalReason: "error:stale_run",
            })
          : json(
              recoveredTurnThread({
                run1: staleRunFailure,
                successorReply: false,
              }),
            ),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-recovered",
    });

    expect(snapshot?.runs?.find((run) => run.id === "run-1")).toMatchObject({
      status: "failed",
    });
    await transport.dispose();
  });

  it("reports a finished run's failure after the server stops calling it active", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({
              active: false,
              status: "completed",
              runId: "run-timeout",
              terminalReason: "run_timeout",
            })
          : json({
              id: "thread-timeout",
              threadData: JSON.stringify({
                messages: [],
                agentKit: {
                  messages: [],
                  runs: [
                    {
                      id: "run-timeout",
                      threadId: "thread-timeout",
                      status: "running",
                      lastSequence: 0,
                    },
                  ],
                  activeRunIds: ["run-timeout"],
                },
              }),
            }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-timeout",
    });

    expect(
      snapshot?.runs?.find((run) => run.id === "run-timeout")?.error,
    ).toMatchObject({ code: "run_timeout", retryable: true });
    expect(snapshot?.activeRunIds ?? []).toEqual([]);
    await transport.dispose();
  });

  // A continuation run folds into the first run's durable reply. The page saw
  // the first run, then reloaded before the continuation finished.
  function foldedContinuationThread(options: {
    snapshotSawContinuation: boolean;
    endsWithToolPart?: boolean;
  }) {
    const assistantEvent = (runId: string, id: string) => ({
      id: `event-${runId}`,
      type: "message.created",
      threadId: "thread-folded",
      runId,
      sequence: 1,
      occurredAt: "2026-10-01T23:54:00.000Z",
      message: { id, role: "assistant", parts: [] },
    });
    return {
      id: "thread-folded",
      threadData: JSON.stringify({
        messages: [
          {
            message: {
              id: "user-1",
              role: "user",
              status: "complete",
              content: [{ type: "text", text: "Write forty lines" }],
            },
            parentId: null,
          },
          {
            message: {
              id: "server-run-2",
              role: "assistant",
              status: { type: "complete", reason: "stop" },
              content: [{ type: "text", text: "First half. Second half." }],
              metadata: {
                runId: "run-2",
                custom: { foldedRunIds: ["run-1", "run-2"] },
              },
            },
            parentId: "user-1",
          },
        ],
        agentKit: {
          messages: [
            reloadedPrompt,
            {
              id: "message-1",
              role: "assistant",
              status: "complete",
              parts: [
                { type: "text", text: "First half." },
                ...(options.endsWithToolPart
                  ? [{ type: "data", data: { toolCallId: "tool-1" } }]
                  : []),
              ],
            },
            ...(options.snapshotSawContinuation
              ? [
                  {
                    id: "message-2",
                    role: "assistant",
                    status: "complete",
                    parts: [{ type: "text", text: " Second half." }],
                  },
                ]
              : []),
          ],
          events: [
            assistantEvent("run-1", "message-1"),
            ...(options.snapshotSawContinuation
              ? [assistantEvent("run-2", "message-2")]
              : []),
          ],
          runs: ["run-1", "run-2"].map((id) => ({
            id,
            threadId: "thread-folded",
            status: "completed",
            startedAt: "2026-10-01T23:54:00.000Z",
            lastSequence: 0,
          })),
          activeRunIds: [],
        },
      }),
    };
  }

  it("completes the first run's reply with a continuation the reloaded page never saw", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json(foldedContinuationThread({ snapshotSawContinuation: false })),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(snapshot?.messages).toMatchObject([
      { id: "user-1", role: "user" },
      {
        id: "message-1",
        parts: [{ type: "text", text: "First half. Second half." }],
      },
    ]);
    await transport.dispose();
  });

  it("appends the continuation after a tool part the reloaded page already saved", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json(
              foldedContinuationThread({
                snapshotSawContinuation: false,
                endsWithToolPart: true,
              }),
            ),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(snapshot?.messages[1]?.parts).toMatchObject([
      { type: "text", text: "First half." },
      { type: "data" },
      { type: "text", text: " Second half." },
    ]);
    await transport.dispose();
  });

  it("adds only the missing continuation when the page saw some but not all folded runs", async () => {
    const thread = foldedContinuationThread({ snapshotSawContinuation: true });
    const data = JSON.parse(thread.threadData);
    data.messages[1].message.content = [
      { type: "text", text: "First half. Second half. Third half." },
    ];
    data.messages[1].message.metadata = {
      runId: "run-3",
      custom: { foldedRunIds: ["run-1", "run-2", "run-3"] },
    };
    data.agentKit.runs.push({
      id: "run-3",
      threadId: "thread-folded",
      status: "completed",
      startedAt: "2026-10-01T23:54:00.000Z",
      lastSequence: 0,
    });
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({ ...thread, threadData: JSON.stringify(data) }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(
      snapshot?.messages.map((message) => [
        message.id,
        message.parts.map((part) => (part.type === "text" ? part.text : "")),
      ]),
    ).toEqual([
      ["user-1", ["Write forty lines"]],
      ["message-1", ["First half."]],
      ["message-2", [" Second half. Third half."]],
    ]);
    await transport.dispose();
  });

  it("restores folded reasoning only on the final saved message", async () => {
    const thread = foldedContinuationThread({ snapshotSawContinuation: true });
    const data = JSON.parse(thread.threadData);
    data.messages[1].message.content = [
      { type: "reasoning", text: "Stored full reasoning." },
      { type: "text", text: "First half. Second half. Third half." },
    ];
    data.messages[1].message.metadata = {
      runId: "run-3",
      custom: { foldedRunIds: ["run-1", "run-2", "run-3"] },
    };
    data.agentKit.runs.push({
      id: "run-3",
      threadId: "thread-folded",
      status: "completed",
      startedAt: "2026-10-01T23:54:00.000Z",
      lastSequence: 0,
    });
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({ ...thread, threadData: JSON.stringify(data) }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(
      snapshot?.messages.map((message) => ({
        id: message.id,
        parts: message.parts.map((part) =>
          part.type === "text" || part.type === "reasoning" ? part.text : "",
        ),
      })),
    ).toEqual([
      { id: "user-1", parts: ["Write forty lines"] },
      { id: "message-1", parts: ["First half."] },
      {
        id: "message-2",
        parts: ["Stored full reasoning.", " Second half. Third half."],
      },
    ]);
    await transport.dispose();
  });

  it("completes a partly streamed terminal continuation from the whole folded reply", async () => {
    const thread = foldedContinuationThread({ snapshotSawContinuation: true });
    const data = JSON.parse(thread.threadData);
    data.agentKit.messages[2].parts = [{ type: "text", text: " Second" }];
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({ ...thread, threadData: JSON.stringify(data) }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(
      snapshot?.messages.map((message) => [
        message.id,
        message.parts.map((part) => (part.type === "text" ? part.text : "")),
      ]),
    ).toEqual([
      ["user-1", ["Write forty lines"]],
      ["message-1", ["First half."]],
      ["message-2", [" Second half."]],
    ]);
    await transport.dispose();
  });

  it("keeps separate messages for continuation runs the page did watch", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json(foldedContinuationThread({ snapshotSawContinuation: true })),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(
      snapshot?.messages.map((message) => [
        message.id,
        message.parts.map((part) => (part.type === "text" ? part.text : "")),
      ]),
    ).toEqual([
      ["user-1", ["Write forty lines"]],
      ["message-1", ["First half."]],
      ["message-2", [" Second half."]],
    ]);
    await transport.dispose();
  });

  it("restores the earlier folded text when only the terminal suffix was saved", async () => {
    const thread = foldedContinuationThread({ snapshotSawContinuation: true });
    const data = JSON.parse(thread.threadData);
    data.agentKit.messages = [
      reloadedPrompt,
      {
        id: "message-2",
        role: "assistant",
        status: "complete",
        parts: [{ type: "text", text: " Second half." }],
      },
    ];
    data.agentKit.events = [
      {
        id: "event-run-2",
        type: "message.created",
        threadId: "thread-folded",
        runId: "run-2",
        sequence: 1,
        occurredAt: "2026-10-01T23:54:00.000Z",
        message: { id: "message-2", role: "assistant", parts: [] },
      },
    ];
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({ ...thread, threadData: JSON.stringify(data) }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(
      snapshot?.messages.map((message) => [
        message.id,
        message.parts.map((part) => (part.type === "text" ? part.text : "")),
      ]),
    ).toEqual([
      ["user-1", ["Write forty lines"]],
      ["message-2", ["First half. Second half."]],
    ]);
    await transport.dispose();
  });

  it("does not replace unrelated or reordered AgentKit content with durable text", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({
              id: "thread-other-reply",
              threadData: JSON.stringify({
                messages: [
                  {
                    message: {
                      id: "server-other-run",
                      role: "assistant",
                      content: [{ type: "text", text: "Different answer" }],
                      metadata: { runId: "other-run" },
                    },
                  },
                  {
                    message: {
                      id: "message-1",
                      role: "assistant",
                      content: [{ type: "text", text: "Rewritten answer" }],
                    },
                  },
                  {
                    message: {
                      id: "message-2",
                      role: "assistant",
                      content: [
                        { type: "text", text: "Before tool with suffix" },
                      ],
                    },
                  },
                ],
                agentKit: {
                  messages: [
                    {
                      id: "message-1",
                      role: "assistant",
                      parts: [{ type: "text", text: "Original answer" }],
                    },
                    {
                      id: "message-2",
                      role: "assistant",
                      parts: [
                        { type: "text", text: "Before tool" },
                        {
                          type: "data",
                          mediaType: "application/json",
                          data: { tool: "done" },
                        },
                      ],
                    },
                  ],
                },
              }),
            }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-other-reply",
    });

    expect(snapshot?.messages).toMatchObject([
      { id: "message-1", parts: [{ type: "text", text: "Original answer" }] },
      {
        id: "message-2",
        parts: [
          { type: "text", text: "Before tool" },
          {
            type: "data",
            mediaType: "application/json",
            data: { tool: "done" },
          },
        ],
      },
    ]);
    await transport.dispose();
  });

  it("restores failed action calls without success widgets", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-failed-widget",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            messages: [
              {
                id: "assistant-1",
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "tool-failed",
                    toolName: "manage-draft",
                    args: { action: "create" },
                    result: "Error creating draft",
                    isError: true,
                    chatUI: { renderer: "mail.draft-created" },
                  },
                ],
              },
            ],
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-failed-widget",
    });

    expect(snapshot?.toolCalls).toMatchObject([
      { id: "tool-failed", status: "failed", messageId: "assistant-1" },
    ]);
    expect(snapshot?.widgets).toEqual([]);
  });

  it("keeps legacy chatUI widgets paired with parents missing from AgentKit history", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-divergent-history",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            messages: [
              {
                id: "assistant-later",
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "tool-later",
                    toolName: "create-release",
                    args: { release: "agentkit-acceptance" },
                    result: { created: true },
                    chatUI: { renderer: "test.action" },
                  },
                ],
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "assistant-earlier",
                  role: "assistant",
                  parts: [{ type: "text", text: "Earlier response." }],
                },
              ],
            },
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-divergent-history",
    });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "assistant-earlier",
      "assistant-later",
    ]);
    expect(snapshot?.messages[1]).toMatchObject({
      id: "assistant-later",
      role: "assistant",
      parts: [],
    });
    expect(snapshot?.widgets).toEqual([
      {
        messageId: "assistant-later",
        widget: {
          id: "tool-later:chat-ui",
          kind: "test.action",
          data: { toolCallId: "tool-later", toolName: "create-release" },
        },
      },
    ]);
  });

  it("does not duplicate a legacy widget already embedded in AgentKit history", async () => {
    const widget = {
      id: "tool-shared:chat-ui",
      kind: "test.action",
      data: { toolCallId: "tool-shared", toolName: "create-release" },
    };
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-embedded-widget",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            messages: [
              {
                id: "assistant-legacy",
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "tool-shared",
                    toolName: "create-release",
                    args: { release: "agentkit-acceptance" },
                    result: { created: true },
                    chatUI: { renderer: "test.action" },
                  },
                ],
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "assistant-canonical",
                  role: "assistant",
                  parts: [
                    { type: "text", text: "Release created." },
                    { type: "widget", widget },
                  ],
                },
              ],
            },
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-embedded-widget",
    });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "assistant-canonical",
    ]);
    expect(snapshot?.messages[0]?.parts).toContainEqual({
      type: "widget",
      widget,
    });
    expect(snapshot?.widgets).toEqual([]);
    expect(snapshot?.toolCalls).toMatchObject([
      { id: "tool-shared", output: { created: true } },
    ]);
  });

  it("attaches a legacy widget to its canonical tool message after reload", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-canonical-tool-message",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            messages: [
              {
                id: "assistant-legacy",
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "tool-shared",
                    toolName: "create-release",
                    args: { release: "agentkit-acceptance" },
                    result: { created: true },
                    chatUI: { renderer: "test.action" },
                  },
                ],
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "assistant-canonical",
                  role: "assistant",
                  parts: [{ type: "text", text: "Release created." }],
                },
              ],
              toolCalls: [
                {
                  id: "tool-shared",
                  name: "create-release",
                  status: "completed",
                  messageId: "assistant-canonical",
                  output: { created: true },
                },
              ],
            },
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-canonical-tool-message",
    });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "assistant-canonical",
    ]);
    expect(snapshot?.widgets).toEqual([
      {
        messageId: "assistant-canonical",
        widget: {
          id: "tool-shared:chat-ui",
          kind: "test.action",
          data: { toolCallId: "tool-shared", toolName: "create-release" },
        },
      },
    ]);
  });

  it("loads durable history and promotes queued work into a real stream", async () => {
    const queueWrites: unknown[] = [];
    let queuedMessages = [
      {
        id: "queued-1",
        text: "Continue after approval",
        createdAt: "2026-08-29T00:02:00.000Z",
      },
    ];
    let activeRunChecks = 0;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/runs/active?threadId=thread-1")) {
          activeRunChecks += 1;
          return json({ active: false, status: "complete" });
        }
        if (url.endsWith("/threads/thread-1") && !init?.method) {
          return json({
            id: "thread-1",
            title: "Release review",
            createdAt: "2026-08-29T00:00:00.000Z",
            updatedAt: "2026-08-29T00:01:00.000Z",
            threadData: JSON.stringify({
              messages: [
                {
                  id: "user-1",
                  role: "user",
                  content: [{ type: "text", text: "Review the release" }],
                },
              ],
              queuedMessages,
            }),
          });
        }
        if (url.endsWith("/threads/thread-1/queued")) {
          const mutation = JSON.parse(String(init?.body)).mutation;
          queueWrites.push(mutation);
          if (mutation.type === "claim") {
            const index = queuedMessages.findIndex(
              (message) => message.id === mutation.messageId,
            );
            const claimedMessage = {
              ...queuedMessages[index],
              promotionClaim: {
                id: mutation.claimId,
                expiresAt: Date.now() + 10_000,
              },
            };
            queuedMessages[index] = claimedMessage;
            return json({ queuedMessages, claimedMessage });
          }
          if (mutation.type === "release") {
            queuedMessages = queuedMessages.map((message) => {
              if (message.id !== mutation.messageId) return message;
              const { promotionClaim: _claim, ...released } = message;
              return released;
            });
          }
          return json({ queuedMessages });
        }
        if (url.endsWith("/_agent-native/agent-chat")) {
          const stream = [
            { type: "text", text: "Release continued." },
            {
              type: "suggestions",
              suggestions: [
                {
                  id: "review-release",
                  label: "Review release",
                  prompt: "Review the release in detail.",
                },
              ],
            },
            { type: "done" },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join("");
          return new Response(stream, {
            headers: {
              "content-type": "text/event-stream",
              "x-run-id": "run-2",
            },
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
      adapter: {
        now: () => "2026-08-29T00:03:00.000Z",
      },
    });

    const thread = await transport.getThreadSnapshot?.({
      threadId: "thread-1",
    });
    expect(thread).toMatchObject({
      title: "Release review",
      messages: [{ id: "user-1", role: "user" }],
      queuedMessages: [{ id: "queued-1", text: "Continue after approval" }],
    });

    const promoted = await transport.steerQueuedMessage?.({
      threadId: "thread-1",
      messageId: "queued-1",
    });
    expect(promoted).toMatchObject({
      runId: "run-2",
      capabilities: {
        feedback: true,
        messageQueue: true,
        suggestions: true,
        threadForking: true,
        threadHistory: true,
      },
    });
    expect(transport.capabilities?.suggestions).toBe(true);
    const events: AgentEvent[] = [];
    if (promoted) {
      for await (const event of transport.subscribeToRun({
        threadId: "thread-1",
        runId: promoted.runId,
      })) {
        events.push(event);
      }
    }

    expect(queueWrites).toEqual([
      {
        type: "claim",
        messageId: "queued-1",
        claimId: expect.any(String),
      },
    ]);
    expect(activeRunChecks).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.status",
      "message.created",
      "message.delta",
      "suggestions.updated",
      "message.completed",
      "run.status",
      "run.completed",
    ]);
    expect(runStateMocks.dispatchAgentChatRunning).toHaveBeenCalledWith(
      expect.objectContaining({
        isRunning: true,
        phase: "responding",
        threadId: "thread-1",
        tabId: "thread-1",
        runId: "run-2",
        turnId: expect.any(String),
        reason: "response_started",
      }),
    );
    expect(runStateMocks.dispatchAgentChatRunning).toHaveBeenCalledWith(
      expect.objectContaining({
        isRunning: false,
        phase: "idle",
        threadId: "thread-1",
        tabId: "thread-1",
        runId: "run-2",
        turnId: expect.any(String),
        reason: "run.completed",
      }),
    );
    expect(
      events.find((event) => event.type === "suggestions.updated"),
    ).toMatchObject({
      suggestions: [
        {
          id: "review-release",
          label: "Review release",
          prompt: "Review the release in detail.",
        },
      ],
    });
  });

  it("persists a queue reorder as an atomic message mutation", async () => {
    const queueWrites: unknown[] = [];
    let queuedMessages = [
      {
        id: "queued-one",
        text: "First",
        createdAt: "2026-08-29T00:00:00.000Z",
      },
      {
        id: "queued-two",
        text: "Second",
        createdAt: "2026-08-29T00:00:01.000Z",
      },
      {
        id: "queued-three",
        text: "Third",
        createdAt: "2026-08-29T00:00:02.000Z",
      },
    ];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/threads/thread-queue") && !init?.method) {
          return json({
            id: "thread-queue",
            createdAt: "2026-08-29T00:00:00.000Z",
            updatedAt: "2026-08-29T00:00:00.000Z",
            threadData: JSON.stringify({
              messages: [],
              queuedMessages,
            }),
          });
        }
        if (url.endsWith("/threads/thread-queue/queued")) {
          const mutation = JSON.parse(String(init?.body)).mutation;
          queueWrites.push(mutation);
          const index = queuedMessages.findIndex(
            (message) => message.id === mutation.messageId,
          );
          if (index > 0) {
            queuedMessages = [
              queuedMessages[index]!,
              ...queuedMessages.filter(
                (message) => message.id !== mutation.messageId,
              ),
            ];
          }
          return json({ queuedMessages });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.listQueuedMessages?.({ threadId: "thread-queue" });
    await transport.moveQueuedMessageToTop?.({
      threadId: "thread-queue",
      messageId: "queued-three",
    });

    expect(queueWrites).toEqual([
      { type: "moveToTop", messageId: "queued-three" },
    ]);
    await transport.dispose();
  });

  it("preserves completed side effects through the real AgentKit transport", async () => {
    const fetcher = vi.fn(async () => {
      const stream = [
        { type: "tool_start", id: "tool-1", tool: "update-slide", input: {} },
        {
          type: "tool_done",
          id: "tool-1",
          tool: "update-slide",
          result: "Updated slide 1",
          completedSideEffect: true,
        },
        { type: "done" },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "x-run-id": "run-side-effect",
        },
      });
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Update slide 1" }],
        },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId,
    })) {
      events.push(event);
    }

    expect(events.find((event) => event.type === "tool.updated")).toMatchObject(
      {
        type: "tool.updated",
        metadata: { completedSideEffect: true },
        toolCall: { metadata: { completedSideEffect: true } },
      },
    );
    await transport.dispose();
  });

  it("preserves structured tool metadata through the runtime and protocol", async () => {
    const fetcher = vi.fn(async () => {
      const stream = [
        {
          type: "tool_start",
          id: "tool-edit",
          tool: "update-file",
          input: { path: "src/app.ts" },
          structuredMeta: { toolKind: "edit", filePath: "src/app.ts" },
        },
        {
          type: "tool_done",
          id: "tool-edit",
          tool: "update-file",
          result: "Updated src/app.ts",
          structuredMeta: {
            toolKind: "edit",
            filePath: "src/app.ts",
            diff: "-old\n+new",
          },
        },
        { type: "done" },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "x-run-id": "run-tool-meta",
        },
      });
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Update src/app.ts" }],
        },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId,
    })) {
      events.push(event);
    }

    expect(events.find((event) => event.type === "tool.updated")).toMatchObject(
      {
        type: "tool.updated",
        metadata: {
          toolKind: "edit",
          filePath: "src/app.ts",
          diff: "-old\n+new",
        },
        toolCall: {
          metadata: {
            toolKind: "edit",
            filePath: "src/app.ts",
            diff: "-old\n+new",
          },
        },
      },
    );
    await transport.dispose();
  });

  it("shows the missing-final-response notice for a completed tool-only turn", async () => {
    const fetcher = vi.fn(async () => {
      const stream = [
        { type: "tool_start", id: "tool-1", tool: "update-slide", input: {} },
        {
          type: "tool_done",
          id: "tool-1",
          tool: "update-slide",
          result: "Updated slide 1",
          completedSideEffect: true,
        },
        { type: "done" },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "x-run-id": "run-no-final",
        },
      });
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Update slide 1" }],
        },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId,
    })) {
      events.push(event);
    }

    expect(
      events.find((event) => event.type === "message.completed"),
    ).toMatchObject({
      type: "message.completed",
      message: {
        metadata: {
          custom: {
            runWarning: {
              errorCode: "final_response_missing_after_tool",
              recoverable: true,
            },
          },
        },
        parts: [
          {
            type: "text",
            text: expect.stringContaining(
              "stopped before sending a final message",
            ),
          },
        ],
      },
    });
    await transport.dispose();
  });

  it("preserves the loop-limit error and iteration detail", async () => {
    const fetcher = vi.fn(async () => {
      const stream = [
        { type: "text", text: "I am still working." },
        { type: "loop_limit", maxIterations: 25 },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "x-run-id": "run-loop-limit",
        },
      });
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "Work" }] },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      error: {
        code: "loop_limit",
        retryable: false,
        details: { maxIterations: 25 },
      },
    });
    await transport.dispose();
  });

  it("preserves thread-load authentication errors as typed failures", async () => {
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: vi.fn(async () =>
        json(
          {
            statusMessage: "Your session has expired.",
            data: {
              code: "session_expired",
              details: { loginUrl: "/login" },
            },
          },
          401,
        ),
      ) as typeof fetch,
    });

    await expect(
      transport.getThreadSnapshot?.({ threadId: "thread-expired" }),
    ).rejects.toMatchObject({
      message: "Your session has expired.",
      code: "session_expired",
      status: 401,
      retryable: false,
      details: { loginUrl: "/login" },
    });
    await transport.dispose();
  });

  it("restores an active continuation into the durable reply identity", async () => {
    const requestUrls: string[] = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requestUrls.push(url);
        if (url.endsWith("/threads/thread-resume") && !init?.method) {
          return json({
            id: "thread-resume",
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    id: "server-run-initial",
                    role: "assistant",
                    content: [{ type: "text", text: "Waiting for approval." }],
                    status: { type: "complete", reason: "stop" },
                    metadata: {
                      runId: "run-initial",
                      custom: {
                        foldedRunIds: ["run-initial", "run-durable"],
                      },
                    },
                  },
                },
                {
                  message: {
                    id: "server-user-run-durable",
                    role: "user",
                    content: [{ type: "text", text: "Continue the report" }],
                    metadata: { custom: { submittedRunId: "run-durable" } },
                  },
                },
              ],
              agentKit: { messages: [] },
            }),
          });
        }
        if (
          url.includes("/runs/latest?threadId=thread-resume&runId=run-durable")
        ) {
          return json({
            runId: "run-durable",
            threadId: "thread-resume",
            turnId: "turn-resume",
            startedAt: Date.now(),
            status: "running",
            dispatchMode: "background-processing",
            terminalReason: null,
          });
        }
        if (url.includes("/runs/active?threadId=thread-resume")) {
          return json({
            active: true,
            status: "running",
            runId: "run-durable",
          });
        }
        if (url.endsWith("/runs/run-durable/events?after=0")) {
          const stream = [
            { type: "text", text: "Recovered response", seq: 1 },
            { type: "done", seq: 2 },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join("");
          return new Response(stream, {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
      runtime: createAgentNativeChatRuntime({
        apiUrl: "/_agent-native/agent-chat",
        fetch: fetcher as typeof fetch,
      }),
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-resume",
    });
    expect(snapshot?.activeRunIds).toContain("run-durable");
    expect(snapshot?.messages).toMatchObject([
      {
        id: "server-user-run-durable",
        role: "user",
        parts: [{ type: "text", text: "Continue the report" }],
      },
    ]);
    expect(transport.capabilities?.resumableRuns).toBe(true);

    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-resume",
      runId: "run-durable",
    })) {
      events.push(event);
    }

    expect(requestUrls).toContain(
      "/_agent-native/agent-chat/runs/run-durable/events?after=0",
    );
    expect(events[0]?.type).toBe("run.started");
    expect(
      events.find((event) => event.type === "message.completed"),
    ).toMatchObject({
      type: "message.completed",
      message: {
        id: "server-run-initial",
        parts: [{ type: "text", text: "Recovered response" }],
      },
    });
    expect(
      events.flatMap((event) =>
        (event.type === "message.created" ||
          event.type === "message.completed") &&
        event.message.role === "assistant"
          ? [event.message.id]
          : [],
      ),
    ).toEqual(["server-run-initial", "server-run-initial"]);
    expect(
      events.flatMap((event) =>
        event.type === "message.delta" || event.type === "reasoning.delta"
          ? [event.messageId]
          : [],
      ),
    ).toEqual(["server-run-initial"]);
    expect(events.at(-1)?.type).toBe("run.completed");
    await transport.dispose();
  });

  it("restores a folded reply mapping from AgentKit-only saved history", async () => {
    const threadId = "thread-agentkit-folded-history";
    const continuationMetadata = {
      [AGENT_NATIVE_PROTOCOL_METADATA_KEY]: {
        observability: { interruptedRunId: "run-initial" },
      },
    };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/threads/${threadId}`)) {
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [],
            agentKit: {
              messages: [
                {
                  id: "assistant-folded-reply",
                  role: "assistant",
                  status: "complete",
                  parts: [{ type: "text", text: "Waiting for approval." }],
                },
              ],
              activeRunIds: ["run-initial"],
              runs: [
                {
                  id: "run-initial",
                  threadId,
                  status: "running",
                  lastSequence: 1,
                  activeMessageId: "assistant-folded-reply",
                },
              ],
            },
          }),
        });
      }
      if (url.includes(`/runs/active?threadId=${threadId}`)) {
        return json({ active: false, status: "idle" });
      }
      return json({ error: "Not found" }, 404);
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
      runtime: resumableNativeRuntime([
        {
          type: "message-start",
          metadata: continuationMetadata,
          message: {
            id: "assistant-continuation-message",
            role: "assistant",
            content: [],
          },
        },
        {
          type: "message-delta",
          metadata: continuationMetadata,
          messageId: "assistant-continuation-message",
          delta: { type: "text", text: "The report is complete." },
        },
        {
          type: "message-done",
          metadata: continuationMetadata,
          message: {
            id: "assistant-continuation-message",
            role: "assistant",
            content: [{ type: "text", text: "The report is complete." }],
          },
        },
        { type: "done", reason: "complete" },
      ]),
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });
    expect(snapshot?.messages.map((message) => message.id)).toContain(
      "assistant-folded-reply",
    );

    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId,
      runId: "run-continuation",
    })) {
      events.push(event);
    }

    expect(
      events.flatMap((event) =>
        (event.type === "message.created" ||
          event.type === "message.completed") &&
        event.message.role === "assistant"
          ? [event.message.id]
          : [],
      ),
    ).toEqual(["assistant-folded-reply", "assistant-folded-reply"]);
    expect(
      events.flatMap((event) =>
        event.type === "message.delta" ? [event.messageId] : [],
      ),
    ).toEqual(["assistant-folded-reply"]);
    await transport.dispose();
  });

  it("preserves distinct assistant message IDs within one run", async () => {
    const threadId = "thread-distinct-assistant-messages";
    const transport = createAgentNativeAgentKitTransport({
      runtime: resumableNativeRuntime([
        {
          type: "message-start",
          message: {
            id: "assistant-tool-step",
            role: "assistant",
            content: [{ type: "text", text: "Calling the tool." }],
          },
        },
        {
          type: "message-done",
          message: {
            id: "assistant-tool-step",
            role: "assistant",
            content: [{ type: "text", text: "Calling the tool." }],
          },
        },
        {
          type: "message-start",
          message: {
            id: "assistant-final-answer",
            role: "assistant",
            content: [{ type: "text", text: "The task is complete." }],
          },
        },
        {
          type: "message-done",
          message: {
            id: "assistant-final-answer",
            role: "assistant",
            content: [{ type: "text", text: "The task is complete." }],
          },
        },
        { type: "done", reason: "complete" },
      ]),
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId,
      runId: "run-distinct-assistant-messages",
    })) {
      events.push(event);
    }

    expect(
      events.flatMap((event) =>
        event.type === "message.created" && event.message.role === "assistant"
          ? [event.message.id]
          : [],
      ),
    ).toEqual(["assistant-tool-step", "assistant-final-answer"]);
    expect(
      events.flatMap((event) =>
        event.type === "message.completed" && event.message.role === "assistant"
          ? [event.message.id]
          : [],
      ),
    ).toEqual(["assistant-tool-step", "assistant-final-answer"]);
    await transport.dispose();
  });

  it("drops an exact same-run server mirror without collapsing AgentKit messages", async () => {
    const threadId = "thread-server-reply-mirror";
    const runId = "run-server-reply-mirror";
    const assistantMessages = [
      {
        id: "assistant-tool-step",
        role: "assistant" as const,
        status: "complete" as const,
        parts: [{ type: "text" as const, text: "Calling the tool." }],
      },
      {
        id: "assistant-final-answer",
        role: "assistant" as const,
        status: "complete" as const,
        parts: [{ type: "text" as const, text: "The task is complete." }],
      },
    ];
    const events = assistantMessages.flatMap((message, index) => {
      const sequence = index * 2 + 1;
      const base = {
        threadId,
        runId,
        occurredAt: `2026-10-01T00:00:0${sequence}Z`,
      };
      return [
        {
          ...base,
          id: `${runId}:${sequence}`,
          sequence,
          type: "message.created" as const,
          message,
        },
        {
          ...base,
          id: `${runId}:${sequence + 1}`,
          sequence: sequence + 1,
          type: "message.completed" as const,
          message,
        },
      ];
    });

    const loadMessages = async (
      rootText: string,
      rootToolCallResult: unknown = { message: "Hello, AgentKit Browser!" },
      rootReasoning = false,
      snapshotFinalStatus: "complete" | "streaming" = "complete",
    ) => {
      const snapshotAssistantMessages = assistantMessages.map((message) =>
        message.id === "assistant-final-answer"
          ? { ...message, status: snapshotFinalStatus }
          : message,
      );
      const transport = createAgentNativeAgentKitTransport({
        apiUrl: "/_agent-native/agent-chat",
        fetch: vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith(`/threads/${threadId}`)) {
            return json({
              id: threadId,
              threadData: JSON.stringify({
                messages: [
                  {
                    message: {
                      id: `server-${runId}`,
                      role: "assistant",
                      content: [
                        ...(rootReasoning
                          ? [{ type: "reasoning", text: "Stored rationale." }]
                          : []),
                        {
                          type: "tool-call",
                          toolCallId: "call-hello",
                          toolName: "hello",
                          args: { name: "AgentKit Browser" },
                          result: rootToolCallResult,
                        },
                        { type: "text", text: rootText },
                      ],
                      status: { type: "complete", reason: "stop" },
                      metadata: {
                        runId,
                        custom: { foldedRunIds: [runId] },
                      },
                    },
                  },
                ],
                agentKit: {
                  messages: snapshotAssistantMessages,
                  toolCalls: [
                    {
                      id: "call-hello",
                      name: "hello",
                      input: { name: "AgentKit Browser" },
                      output: { message: "Hello, AgentKit Browser!" },
                      status: "completed",
                      runId,
                      messageId: "assistant-final-answer",
                    },
                  ],
                  events,
                  _mergeRootMessages: true,
                },
              }),
            });
          }
          if (url.includes(`/runs/active?threadId=${threadId}`)) {
            return json({ active: false, status: "idle" });
          }
          return json({ error: "Not found" }, 404);
        }) as typeof fetch,
      });
      const snapshot = await transport.getThreadSnapshot?.({ threadId });
      await transport.dispose();
      return {
        messageIds: snapshot?.messages.map((message) => message.id),
        toolCallIds: snapshot?.toolCalls.map((toolCall) => toolCall.id),
        ...(rootReasoning
          ? {
              reasoningByMessage: snapshot?.messages.map((message) => ({
                id: message.id,
                text: message.parts
                  .filter((part) => part.type === "reasoning")
                  .map((part) => part.text)
                  .join(""),
              })),
              statusByMessage: snapshot?.messages.map((message) => ({
                id: message.id,
                status: message.status,
              })),
            }
          : {}),
      };
    };

    await expect(loadMessages("The task is complete.")).resolves.toEqual({
      messageIds: ["assistant-tool-step", "assistant-final-answer"],
      toolCallIds: ["call-hello"],
    });
    await expect(
      loadMessages("A different durable response."),
    ).resolves.toEqual({
      messageIds: [
        `server-${runId}`,
        "assistant-tool-step",
        "assistant-final-answer",
      ],
      toolCallIds: ["call-hello"],
    });
    await expect(
      loadMessages("The task is complete. Additional details follow."),
    ).resolves.toEqual({
      messageIds: [
        `server-${runId}`,
        "assistant-tool-step",
        "assistant-final-answer",
      ],
      toolCallIds: ["call-hello"],
    });
    // The stored root keeps the model-facing result text; the snapshot output
    // is the structured result. The same call must still count as mirrored.
    await expect(
      loadMessages(
        "The task is complete.",
        JSON.stringify(
          { message: "Hello, AgentKit Browser!", detail: "model-only" },
          null,
          2,
        ),
      ),
    ).resolves.toEqual({
      messageIds: ["assistant-tool-step", "assistant-final-answer"],
      toolCallIds: ["call-hello"],
    });
    await expect(
      loadMessages("The task is complete.", undefined, true, "streaming"),
    ).resolves.toEqual({
      messageIds: ["assistant-tool-step", "assistant-final-answer"],
      toolCallIds: ["call-hello"],
      reasoningByMessage: [
        { id: "assistant-tool-step", text: "" },
        { id: "assistant-final-answer", text: "Stored rationale." },
      ],
      statusByMessage: [
        { id: "assistant-tool-step", status: "complete" },
        { id: "assistant-final-answer", status: "complete" },
      ],
    });
  });

  it("restores reasoning from a durable assistant mirror without duplicating the reply", async () => {
    const threadId = "thread-reasoning-mirror";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith(`/threads/${threadId}`)) {
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    id: "server-run-1",
                    role: "assistant",
                    content: [
                      { type: "reasoning", text: "Stored rationale." },
                      { type: "text", text: "Done." },
                    ],
                    status: { type: "complete", reason: "stop" },
                    metadata: { runId: "run-1" },
                  },
                },
              ],
              agentKit: {
                messages: [
                  {
                    id: "assistant-1",
                    role: "assistant",
                    status: "complete",
                    parts: [{ type: "text", text: "Done." }],
                    metadata: { runId: "run-1" },
                  },
                ],
              },
            }),
          });
        }
        if (url.includes(`/runs/active?threadId=${threadId}`)) {
          return json({ active: false, status: "idle" });
        }
        return json({ error: "Not found" }, 404);
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages).toMatchObject([
      {
        id: "assistant-1",
        parts: [
          { type: "reasoning", text: "Stored rationale." },
          { type: "text", text: "Done." },
        ],
      },
    ]);
    await transport.dispose();
  });

  it.each([
    {
      case: "attributed",
      messageStatus: "streaming",
      messageRunId: "run-replay",
    },
    {
      case: "attributed",
      messageStatus: "complete",
      messageRunId: "run-replay",
    },
    {
      case: "unattributed",
      messageStatus: "streaming",
      messageRunId: undefined,
    },
  ] as const)(
    "rebuilds a $messageStatus assistant once during $case active replay",
    async ({ messageStatus, messageRunId }) => {
      const threadId = "thread-partial-assistant-replay";
      const requestUrls: string[] = [];
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requestUrls.push(url);
        if (url.endsWith(`/threads/${threadId}`)) {
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [],
              agentKit: {
                messages: [
                  {
                    id:
                      messageStatus === "complete"
                        ? "server-run-replay"
                        : "assistant-partial",
                    role: "assistant",
                    status: messageStatus,
                    parts: [{ type: "text", text: "Slow stream" }],
                    ...(messageRunId
                      ? { metadata: { runId: messageRunId } }
                      : {}),
                  },
                ],
              },
            }),
          });
        }
        if (url.includes(`/runs/active?threadId=${threadId}`)) {
          return json({ active: true, status: "running", runId: "run-replay" });
        }
        if (url.includes("/runs/latest?") && url.includes("runId=run-replay")) {
          return json({
            runId: "run-replay",
            turnId: "turn-replay",
            status: "running",
          });
        }
        if (url.endsWith("/runs/run-replay/events?after=0")) {
          const stream = [
            { type: "text", text: "Slow stream", seq: 1 },
            { type: "text", text: " resumed after reload.", seq: 2 },
            { type: "done", seq: 3 },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join("");
          return new Response(stream, {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return json({ error: "Not found" }, 404);
      }) as typeof fetch;
      const transport = createAgentNativeAgentKitTransport({
        apiUrl: "/_agent-native/agent-chat",
        fetch: fetcher,
        runtime: createAgentNativeChatRuntime({
          apiUrl: "/_agent-native/agent-chat",
          fetch: fetcher,
        }),
      });
      const client = new AgentKitClient({ transport });

      await client.loadThread(threadId);
      await vi.waitFor(() =>
        expect(client.getThread(threadId).runs["run-replay"]?.status).toBe(
          "completed",
        ),
      );
      expect(client.getThread(threadId).runs["run-replay"]).toMatchObject({
        status: "completed",
      });

      expect(requestUrls).toContain(
        "/_agent-native/agent-chat/runs/run-replay/events?after=0",
      );
      const assistantMessages = client
        .getThread(threadId)
        .messages.filter((message) => message.role === "assistant");
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.parts).toEqual([
        { type: "text", text: "Slow stream resumed after reload." },
      ]);

      await client.shutdown();
      await transport.dispose();
    },
  );

  it("keeps a prior assistant projection when another run replays from sequence zero", async () => {
    const threadId = "thread-prior-assistant-replay";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: true, status: "running", runId: "run-new" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "server-prior-assistant",
                  role: "assistant",
                  content: [{ type: "text", text: "Prior answer" }],
                  status: { type: "complete" },
                  metadata: { runId: "run-prior" },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "snapshot-prior-assistant",
                  role: "assistant",
                  status: "streaming",
                  parts: [{ type: "text", text: "Prior answer" }],
                  metadata: { runId: "run-prior" },
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-prior-assistant",
    ]);
    await transport.dispose();
  });

  it("clears partial projections for paused runs replayed from sequence zero", async () => {
    for (const status of ["awaiting_approval", "awaiting_input"] as const) {
      const threadId = `thread-${status}-replay`;
      const runId = `run-${status}`;
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          if (String(input).includes("/runs/active")) {
            return json({ active: true, status, runId });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [],
              agentKit: {
                messages: [
                  {
                    id: "assistant-partial",
                    role: "assistant",
                    status: "streaming",
                    parts: [
                      { type: "text", text: "Partial approval response" },
                    ],
                    metadata: { runId },
                  },
                ],
              },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.activeRunIds).toContain(runId);
      expect(snapshot?.messages.map((message) => message.id)).not.toContain(
        "assistant-partial",
      );
      await transport.dispose();
    }
  });

  it("preserves run_timeout failures without ending a pending redispatch", async () => {
    for (const awaitingRedispatch of [false, true]) {
      const threadId = `thread-timeout-${awaitingRedispatch}`;
      const runId = `run-timeout-${awaitingRedispatch}`;
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          if (String(input).includes("/runs/active")) {
            return json({
              active: true,
              status: "completed",
              runId,
              terminalReason: "run_timeout",
              awaitingRedispatch,
            });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: awaitingRedispatch
                ? [
                    {
                      message: {
                        id: "assistant-continuation-chunk",
                        role: "assistant",
                        content: [{ type: "text", text: "Partial response" }],
                        status: { type: "complete" },
                        metadata: {
                          runId,
                          custom: {
                            continued: true,
                            foldedRunIds: [runId],
                          },
                        },
                      },
                    },
                  ]
                : [],
              agentKit: { messages: [] },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.runs?.find((run) => run.id === runId)?.status).toBe(
        awaitingRedispatch ? "running" : "failed",
      );
      if (awaitingRedispatch) {
        expect(snapshot?.activeRunIds).toContain(runId);
      } else {
        expect(
          snapshot?.runs?.find((run) => run.id === runId)?.error,
        ).toMatchObject({
          code: "run_timeout",
          retryable: true,
        });
        expect(snapshot?.activeRunIds).not.toContain(runId);
      }
      await transport.dispose();
    }
  });

  it.each(["loop_limit", "max_tokens", "stream_ended"] as const)(
    "restores legacy truncated run status for %s",
    async (terminalReason) => {
      const threadId = `thread-truncated-${terminalReason}`;
      const runId = `run-truncated-${terminalReason}`;
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          if (String(input).includes("/runs/active")) {
            return json({
              active: true,
              status: "completed",
              runId,
              terminalReason,
            });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [],
              agentKit: { messages: [] },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.runs).toContainEqual(
        expect.objectContaining({
          id: runId,
          status: "failed",
          error: expect.objectContaining({ code: terminalReason }),
        }),
      );
      await transport.dispose();
    },
  );

  it("discovers active runs with the default Agent-Native runtime", async () => {
    const requestUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestUrls.push(url);
      if (url.endsWith("/threads/thread-default-runtime")) {
        return json({
          id: "thread-default-runtime",
          threadData: JSON.stringify({
            messages: [],
            agentKit: { messages: [] },
          }),
        });
      }
      if (url.includes("/runs/active?threadId=thread-default-runtime")) {
        return json({ active: true, status: "running", runId: "run-default" });
      }
      return json({ error: "Not found" }, 404);
    });
    const transport = createAgentNativeAgentKitTransport({
      fetch: fetcher as typeof fetch,
      runtime: createAgentNativeChatRuntime({
        fetch: fetcher as typeof fetch,
      }),
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-default-runtime",
    });

    expect(requestUrls).toContain(
      "/_agent-native/agent-chat/runs/active?threadId=thread-default-runtime",
    );
    expect(snapshot?.activeRunIds).toContain("run-default");
    await transport.dispose();
  });

  it("normalizes a resumed runtime ID in the active-run snapshot", async () => {
    const threadId = "thread-active-runtime-alias";
    async function* approvalEvents(): AsyncIterable<AgentChatRuntimeKnownEvent> {
      yield {
        type: "approval-request",
        approvalId: "approval-1",
        toolCallId: "tool-1",
        toolName: "publish",
        message: "Publish the release?",
      };
      yield { type: "done", reason: "tool-use" };
    }
    async function* completionEvents(): AsyncIterable<AgentChatRuntimeKnownEvent> {
      yield { type: "done", reason: "complete" };
    }
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/threads/${threadId}`)) {
        return json({
          id: threadId,
          threadData: JSON.stringify({ messages: [], agentKit: {} }),
        });
      }
      if (url.includes(`/runs/active?threadId=${threadId}`)) {
        return json({
          active: true,
          status: "running",
          runId: "runtime-after-approval",
        });
      }
      return json({ error: "Not found" }, 404);
    });
    const runtime = createAgentNativeChatRuntime({
      fetch: fetcher as typeof fetch,
    });
    runtime.createSession = async () => ({
      id: threadId,
      runtimeId: runtime.id,
      startTurn: async () => ({
        id: "turn-before-approval",
        runId: "runtime-before-approval",
        sessionId: threadId,
        events: approvalEvents(),
      }),
      continueTurn: async () => ({
        id: "turn-after-approval",
        runId: "runtime-after-approval",
        sessionId: threadId,
        events: completionEvents(),
      }),
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
      runtime,
      adapter: { createId: () => "protocol-after-approval" },
    });
    const { runId } = await transport.startRun({
      threadId,
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Publish it" }],
        },
      ],
    });
    const initialIterator = transport
      .subscribeToRun({ threadId, runId })
      [Symbol.asyncIterator]();
    while (true) {
      const next = await initialIterator.next();
      expect(next.done).toBe(false);
      if (next.value?.type === "approval.requested") break;
    }
    const resumed = await transport.resumeRun?.({
      threadId,
      runId,
      resume: [
        resumeEntryFromApproval({
          approvalId: "approval-1",
          response: { decision: "approve" },
        }),
      ],
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(resumed?.runId).toBe("protocol-after-approval");
    expect(snapshot?.activeRunIds).toEqual(["protocol-after-approval"]);
    await initialIterator.return?.();
    await transport.dispose();
  });

  it("does not discover server runs for a custom runtime", async () => {
    const requestUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestUrls.push(url);
      if (url.endsWith("/threads/thread-custom-runtime")) {
        return json({
          id: "thread-custom-runtime",
          threadData: JSON.stringify({
            messages: [],
            agentKit: { messages: [] },
          }),
        });
      }
      return json({ error: "Not found" }, 404);
    });
    const transport = createAgentNativeAgentKitTransport({
      fetch: fetcher as typeof fetch,
      runtime: createHttpAgentChatRuntime({
        kind: "agent-native",
        endpoint: "/external-agent-chat",
        fetch: fetcher as typeof fetch,
      }),
    });

    await transport.getThreadSnapshot?.({
      threadId: "thread-custom-runtime",
    });

    expect(requestUrls.some((url) => url.includes("/runs/active"))).toBe(false);
    await transport.dispose();
  });

  it("restores completed turns from durable thread messages after the page was away", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({
            active: true,
            status: "completed",
            runId: "run-finished",
          });
        }
        return json({
          id: "thread-finished-while-away",
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "server-user-run-finished",
                  role: "user",
                  content: [{ type: "text", text: "Finish the report" }],
                  attachments: [
                    {
                      id: "attachment-report",
                      type: "file",
                      name: "report.pdf",
                      content: [
                        {
                          type: "file",
                          url: "https://files.example/report.pdf",
                          mimeType: "application/pdf",
                          filename: "report.pdf",
                        },
                      ],
                    },
                    {
                      id: "attachment-chart",
                      type: "image",
                      name: "chart.png",
                      content: [
                        {
                          type: "image",
                          image: "https://files.example/chart.png",
                          mimeType: "image/png",
                          filename: "chart.png",
                        },
                      ],
                    },
                  ],
                  metadata: { custom: { submittedRunId: "run-finished" } },
                },
              },
              {
                message: {
                  id: "server-assistant-run-finished",
                  role: "assistant",
                  content: [{ type: "text", text: "The report is finished." }],
                  metadata: { runId: "run-finished" },
                },
              },
            ],
            agentKit: { messages: [] },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-finished-while-away",
    });

    expect(snapshot?.messages).toMatchObject([
      {
        id: "server-user-run-finished",
        role: "user",
        parts: [
          { type: "text", text: "Finish the report" },
          {
            type: "file",
            name: "report.pdf",
            url: "https://files.example/report.pdf",
            mediaType: "application/pdf",
          },
          {
            type: "file",
            name: "chart.png",
            url: "https://files.example/chart.png",
            mediaType: "image/png",
          },
        ],
      },
      {
        id: "server-assistant-run-finished",
        role: "assistant",
        parts: [{ type: "text", text: "The report is finished." }],
      },
    ]);
    expect(snapshot?.runs).toContainEqual(
      expect.objectContaining({ id: "run-finished", status: "completed" }),
    );
    expect(snapshot?.activeRunIds).not.toContain("run-finished");
    await transport.dispose();
  });

  it("does not append a second copy of an attachment-bearing prompt", async () => {
    const threadId = "thread-attachment-prompt-reconcile";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "server-user-attachment-prompt",
                  role: "user",
                  createdAt: "2026-09-01T00:00:00.000Z",
                  content: [{ type: "text", text: "Read this report" }],
                  attachments: [
                    {
                      id: "server-attachment-1",
                      type: "file",
                      name: "report.pdf",
                      contentType: "application/pdf",
                      content: [
                        {
                          type: "file",
                          url: "https://files.example/report.pdf",
                          mimeType: "application/pdf",
                          filename: "report.pdf",
                        },
                      ],
                    },
                  ],
                  metadata: {
                    custom: { submittedRunId: "run-attachment-prompt" },
                  },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "snapshot-user-attachment-prompt",
                  role: "user",
                  createdAt: "2026-09-01T00:00:00.000Z",
                  parts: [
                    { type: "text", text: "Read this report" },
                    {
                      type: "file",
                      name: "report.pdf",
                      url: "https://files.example/report.pdf",
                      mediaType: "application/pdf",
                    },
                  ],
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-user-attachment-prompt",
    ]);
    await transport.dispose();
  });

  it("keeps text-file attachment bodies out of the transcript projection", async () => {
    const threadId = "thread-text-attachment-projection";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "server-user-text-attachment",
                  role: "user",
                  content: [{ type: "text", text: "Review this file" }],
                  attachments: [
                    {
                      id: "server-attachment-text",
                      type: "file",
                      name: "notes.txt",
                      contentType: "text/plain",
                      content: [
                        {
                          type: "text",
                          text: '<attachment name="notes.txt">private body</attachment>',
                        },
                      ],
                    },
                  ],
                  metadata: {
                    custom: { submittedRunId: "run-text-attachment" },
                  },
                },
              },
            ],
            agentKit: { messages: [] },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages[0]?.parts).toEqual([
      { type: "text", text: "Review this file" },
      {
        type: "file",
        name: "notes.txt",
        fileId: "server-attachment-text",
        mediaType: "text/plain",
      },
    ]);
    expect(JSON.stringify(snapshot?.messages)).not.toContain("private body");
    await transport.dispose();
  });

  it.each([
    { userStopped: false, expectedStatus: "completed" },
    { userStopped: true, expectedStatus: "cancelled" },
  ] as const)(
    "restores a stale run as $expectedStatus when its durable reply is userStopped=$userStopped",
    async ({ userStopped, expectedStatus }) => {
      const threadId = "thread-stale-run";
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url.includes("/runs/active")) {
            return json({ active: false, status: "idle" });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    id: "durable-user-stale",
                    role: "user",
                    content: [{ type: "text", text: "Summarize this" }],
                    createdAt: "2026-09-01T00:00:00.000Z",
                    metadata: { custom: { submittedRunId: "run-stale" } },
                  },
                },
                {
                  message: {
                    id: "durable-assistant-stale",
                    role: "assistant",
                    content: [{ type: "text", text: "The summary." }],
                    createdAt: "2026-09-01T00:00:01.000Z",
                    status: { type: "complete" },
                    metadata: {
                      runId: "run-stale",
                      custom: { ...(userStopped ? { userStopped: true } : {}) },
                    },
                  },
                },
              ],
              agentKit: {
                messages: [],
                activeRunIds: ["run-stale"],
                runs: [
                  {
                    id: "run-stale",
                    threadId,
                    status: "running",
                    lastSequence: 1,
                  },
                ],
              },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.messages.map((message) => message.id)).toEqual([
        "durable-user-stale",
        "durable-assistant-stale",
      ]);
      expect(snapshot?.runs).toContainEqual(
        expect.objectContaining({ id: "run-stale", status: expectedStatus }),
      );
      expect(snapshot?.activeRunIds).not.toContain("run-stale");
      await transport.dispose();
    },
  );

  it.each([
    { status: "awaiting_approval", active: true },
    { status: "awaiting_input", active: true },
    { status: "failed", active: true },
    { status: "cancelled", active: true },
    { status: "awaiting_approval", active: false },
    { status: "awaiting_input", active: false },
  ] as const)(
    "preserves durable assistant run state $status when active=$active",
    async ({ status, active }) => {
      const threadId = `thread-durable-status-${status}-${active}`;
      const runId = `run-${status}`;
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          if (String(input).includes("/runs/active")) {
            return json({
              active,
              status: active ? status : "idle",
              runId,
              ...(active && status === "failed"
                ? { terminalReason: "provider_unavailable" }
                : {}),
            });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    id: `assistant-${runId}`,
                    role: "assistant",
                    content: [{ type: "text", text: "Before the pause" }],
                    status: { type: "complete" },
                    metadata: { runId },
                  },
                },
              ],
              agentKit: {
                messages: [],
                activeRunIds:
                  status === "awaiting_approval" || status === "awaiting_input"
                    ? [runId]
                    : [],
                runs: [
                  {
                    id: runId,
                    threadId,
                    status,
                    lastSequence: 1,
                  },
                ],
              },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.runs).toContainEqual(
        expect.objectContaining({ id: runId, status }),
      );
      if (status === "awaiting_approval" || status === "awaiting_input") {
        expect(snapshot?.activeRunIds).toContain(runId);
      } else {
        expect(snapshot?.activeRunIds).not.toContain(runId);
      }
      if (status === "failed" && active) {
        expect(snapshot?.runs).toContainEqual(
          expect.objectContaining({
            id: runId,
            status: "failed",
            error: expect.objectContaining({
              code: "provider_unavailable",
              metadata: { terminalReason: "provider_unavailable" },
            }),
          }),
        );
      }
      await transport.dispose();
    },
  );

  it("restores a durable failed assistant reply without a saved run snapshot", async () => {
    const threadId = "thread-durable-failed-assistant";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "assistant-failed-durable",
                  role: "assistant",
                  content: [{ type: "text", text: "The request failed." }],
                  status: { type: "incomplete", reason: "error" },
                  metadata: {
                    runId: "run-failed-durable",
                    custom: {
                      runError: {
                        message: "Provider unavailable",
                        errorCode: "provider_unavailable",
                      },
                    },
                  },
                },
              },
            ],
            agentKit: { messages: [] },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages).toContainEqual(
      expect.objectContaining({
        id: "assistant-failed-durable",
        role: "assistant",
        status: "error",
        metadata: {
          runId: "run-failed-durable",
          custom: {
            runError: {
              message: "Provider unavailable",
              errorCode: "provider_unavailable",
            },
          },
        },
      }),
    );
    await transport.dispose();
  });

  it("merges durable assistant failure status and details into stale projections", async () => {
    const threadId = "thread-stale-assistant-failure";
    const runId = "run-stale-assistant-failure";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({
            active: true,
            status: "failed",
            runId,
            terminalReason: "provider_unavailable",
          });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "assistant-stale-failure",
                  role: "assistant",
                  content: [{ type: "text", text: "The request failed." }],
                  status: { type: "incomplete", reason: "error" },
                  metadata: {
                    runId,
                    custom: {
                      runError: {
                        message: "Provider unavailable",
                        errorCode: "provider_unavailable",
                        details: "The provider rejected the request.",
                        recoverable: true,
                      },
                    },
                  },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "assistant-stale-failure",
                  role: "assistant",
                  parts: [{ type: "text", text: "The request failed." }],
                  status: "streaming",
                  metadata: { runId, custom: { snapshotField: true } },
                },
              ],
              runs: [
                { id: runId, threadId, status: "running", lastSequence: 1 },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages).toContainEqual(
      expect.objectContaining({
        id: "assistant-stale-failure",
        status: "error",
        metadata: {
          runId,
          custom: {
            snapshotField: true,
            runError: {
              message: "Provider unavailable",
              errorCode: "provider_unavailable",
              details: "The provider rejected the request.",
              recoverable: true,
            },
          },
        },
      }),
    );
    expect(snapshot?.runs).toContainEqual(
      expect.objectContaining({
        id: runId,
        status: "failed",
        error: {
          code: "provider_unavailable",
          message: "Provider unavailable",
          details: "The provider rejected the request.",
          retryable: true,
          metadata: { terminalReason: "provider_unavailable" },
        },
      }),
    );
    await transport.dispose();
  });

  it("restores each durable assistant message from a multi-message run", async () => {
    const threadId = "thread-multiple-durable-assistant-messages";
    const runId = "run-multiple-durable-assistant-messages";
    const durableMessages = [
      {
        id: "assistant-tool-request",
        text: "Calling the tool.",
        at: "2026-09-01T00:00:01.000Z",
      },
      {
        id: "assistant-final-answer",
        text: "The task is complete.",
        at: "2026-09-01T00:00:02.000Z",
      },
    ];
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: durableMessages.map((message) => ({
              message: {
                id: message.id,
                role: "assistant",
                content: [{ type: "text", text: message.text }],
                createdAt: message.at,
                status: { type: "complete" },
                metadata: { runId },
              },
            })),
            agentKit: {
              messages: [
                {
                  id: "assistant-tool-request",
                  role: "assistant",
                  status: "streaming",
                  parts: [{ type: "text", text: "Calling the tool" }],
                  metadata: { runId },
                },
              ],
              events: durableMessages.map((message, index) => ({
                id: `event-${message.id}`,
                threadId,
                runId,
                sequence: index + 1,
                occurredAt: message.at,
                type: "message.completed",
                message: {
                  id: message.id,
                  role: "assistant",
                  parts: [{ type: "text", text: message.text }],
                  status: "complete",
                },
              })),
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual(
      durableMessages.map((message) => message.id),
    );
    expect(snapshot?.messages[0]).toMatchObject({
      id: "assistant-tool-request",
      status: "complete",
      parts: [{ type: "text", text: "Calling the tool." }],
    });
    await transport.dispose();
  });

  it("orders recovered messages with existing turns by creation time", async () => {
    const threadId = "thread-chronological-recovery";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "durable-user-one",
                  role: "user",
                  content: [{ type: "text", text: "First request" }],
                  createdAt: "2026-09-02T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-one" } },
                },
              },
              {
                message: {
                  id: "durable-assistant-one",
                  role: "assistant",
                  content: [{ type: "text", text: "First response" }],
                  createdAt: "2026-09-02T00:00:01.000Z",
                  status: { type: "complete" },
                  metadata: { runId: "run-one" },
                },
              },
              {
                message: {
                  id: "durable-user-two",
                  role: "user",
                  content: [{ type: "text", text: "Second request" }],
                  createdAt: "2026-09-03T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-two" } },
                },
              },
              {
                message: {
                  id: "durable-assistant-two",
                  role: "assistant",
                  content: [{ type: "text", text: "Second response" }],
                  createdAt: "2026-09-03T00:00:01.000Z",
                  status: { type: "complete" },
                  metadata: { runId: "run-two" },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "snapshot-user-old",
                  role: "user",
                  parts: [{ type: "text", text: "Older request" }],
                  createdAt: "2026-09-01T00:00:00.000Z",
                },
                {
                  id: "snapshot-assistant-old",
                  role: "assistant",
                  parts: [{ type: "text", text: "Older response" }],
                  createdAt: "2026-09-01T00:00:01.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-user-old",
      "snapshot-assistant-old",
      "durable-user-one",
      "durable-assistant-one",
      "durable-user-two",
      "durable-assistant-two",
    ]);
    await transport.dispose();
  });

  it("keeps mirrored answers in turn order and restores their durable timestamps", async () => {
    const threadId = "thread-mirrored-turn-order";
    const turns = [
      {
        runId: "run-one",
        userId: "client-user-one",
        answerId: "client-answer-one",
        promptAt: "2026-10-07T16:00:00.000Z",
        answerAt: "2026-10-07T16:00:12.000Z",
      },
      {
        runId: "run-two",
        userId: "client-user-two",
        answerId: "client-answer-two",
        promptAt: "2026-10-07T16:00:08.000Z",
        answerAt: "2026-10-07T16:00:20.000Z",
      },
      {
        runId: "run-three",
        userId: "client-user-three",
        answerId: "client-answer-three",
        promptAt: "2026-10-07T16:00:21.000Z",
        answerAt: "2026-10-07T16:00:30.000Z",
      },
      {
        runId: "run-four",
        userId: "client-user-four",
        answerId: "client-answer-four",
        promptAt: "2026-10-07T16:00:31.000Z",
        answerAt: "2026-10-07T16:00:40.000Z",
      },
    ];
    const durableMessages = turns.flatMap((turn, index) => {
      const toolCallId = `call-${turn.runId}`;
      const result = {
        answer:
          index === 2
            ? "Answer 3 with completed suffix"
            : `Answer ${index + 1}`,
      };
      return [
        {
          message: {
            id: `server-user-${turn.runId}`,
            role: "user",
            content: [{ type: "text", text: `Question ${index + 1}` }],
            createdAt: turn.promptAt,
            metadata: {
              custom: {
                submittedRunId: turn.runId,
                agentKitMessageId: turn.userId,
              },
            },
          },
        },
        {
          message: {
            id: `server-answer-${turn.runId}`,
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId,
                toolName: "lookup",
                args: { runId: turn.runId },
                result,
              },
              { type: "text", text: result.answer },
            ],
            createdAt: turn.answerAt,
            status: { type: "complete" },
            metadata: { runId: turn.runId },
          },
        },
      ];
    });
    const agentKitMessages = turns.flatMap((turn, index) => [
      {
        id: turn.userId,
        role: "user",
        parts: [{ type: "text", text: `Question ${index + 1}` }],
        ...(index === 1 ? {} : { createdAt: turn.promptAt }),
      },
      {
        id: turn.answerId,
        role: "assistant",
        status: "complete",
        parts: [
          {
            type: "text",
            text: index === 2 ? "Answer 3" : `Answer ${index + 1}`,
          },
        ],
      },
    ]);
    const events = turns.slice(0, 2).map((turn) => ({
      id: `event-${turn.answerId}`,
      threadId,
      runId: turn.runId,
      sequence: 1,
      occurredAt: turn.answerAt,
      type: "message.completed",
      message: {
        id: turn.answerId,
        role: "assistant",
        parts: [{ type: "text", text: `Answer ${turns.indexOf(turn) + 1}` }],
      },
    }));
    const toolCalls = turns.map((turn, index) => ({
      id: `call-${turn.runId}`,
      name: "lookup",
      input: { runId: turn.runId },
      output: {
        answer:
          index === 2
            ? "Answer 3 with completed suffix"
            : `Answer ${index + 1}`,
      },
      status: "completed",
      runId: turn.runId,
      messageId: turn.answerId,
    }));
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: durableMessages,
            agentKit: {
              messages: agentKitMessages,
              events,
              runs: turns.map((turn) => ({
                id: turn.runId,
                threadId,
                lastSequence: 0,
                status: "completed",
              })),
              toolCalls,
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual(
      turns.flatMap((turn) => [turn.userId, turn.answerId]),
    );
    expect(snapshot?.messages.map((message) => message.createdAt)).toEqual(
      turns.flatMap((turn) => [turn.promptAt, turn.answerAt]),
    );
    expect(
      snapshot?.messages
        .filter((message) => message.role === "assistant")
        .map((message) =>
          message.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
        ),
    ).toEqual([
      "Answer 1",
      "Answer 2",
      "Answer 3 with completed suffix",
      "Answer 4",
    ]);
    await transport.dispose();
  });

  it("keeps same-text durable prompts when snapshot matching is ambiguous", async () => {
    const threadId = "thread-ambiguous-prompt";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "durable-prompt-one",
                  role: "user",
                  content: [{ type: "text", text: "Repeat this" }],
                  createdAt: "2026-09-02T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-one" } },
                },
              },
              {
                message: {
                  id: "durable-prompt-two",
                  role: "user",
                  content: [{ type: "text", text: "Repeat this" }],
                  createdAt: "2026-09-03T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-two" } },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "snapshot-prompt-unmatched",
                  role: "user",
                  parts: [{ type: "text", text: "Repeat this" }],
                  createdAt: "2026-09-01T00:00:00.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-prompt-unmatched",
      "durable-prompt-one",
      "durable-prompt-two",
    ]);
    await transport.dispose();
  });

  it("reconciles repeated prompts when snapshot and durable timestamps match", async () => {
    const threadId = "thread-repeated-prompt-reconcile";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: ["run-one", "run-two"].map((runId, index) => ({
              message: {
                id: `durable-prompt-${index + 1}`,
                role: "user",
                content: [{ type: "text", text: "Retry this prompt" }],
                createdAt: `2026-09-03T00:00:0${index}.000Z`,
                metadata: { custom: { submittedRunId: runId } },
              },
            })),
            agentKit: {
              messages: [
                {
                  id: "snapshot-prompt-one",
                  role: "user",
                  parts: [{ type: "text", text: "Retry this prompt" }],
                  createdAt: "2026-09-03T00:00:00.000Z",
                },
                {
                  id: "snapshot-prompt-two",
                  role: "user",
                  parts: [{ type: "text", text: "Retry this prompt" }],
                  createdAt: "2026-09-03T00:00:01.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-prompt-one",
      "snapshot-prompt-two",
    ]);
    await transport.dispose();
  });

  it("uses the submitted AgentKit message ID to match differently timed prompts", async () => {
    const threadId = "thread-agentkit-message-id-reconcile";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "durable-prompt",
                  role: "user",
                  content: [{ type: "text", text: "One submitted prompt" }],
                  createdAt: "2026-09-03T00:00:00.500Z",
                  metadata: {
                    custom: {
                      submittedRunId: "run-one",
                      agentKitMessageId: "message-agentkit-one",
                    },
                  },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "message-agentkit-one",
                  role: "user",
                  parts: [{ type: "text", text: "One submitted prompt" }],
                  createdAt: "2026-09-03T00:00:00.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "message-agentkit-one",
    ]);
    await transport.dispose();
  });

  it("keeps equal text from different AgentKit message IDs as separate turns", async () => {
    const threadId = "thread-agentkit-message-id-distinct";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "durable-new-repeat",
                  role: "user",
                  content: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-04T00:00:00.000Z",
                  metadata: {
                    custom: {
                      submittedRunId: "run-new-repeat",
                      agentKitMessageId: "message-new-repeat",
                    },
                  },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "message-old-repeat",
                  role: "user",
                  parts: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-04T00:00:00.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "message-old-repeat",
      "durable-new-repeat",
    ]);
    await transport.dispose();
  });

  it("preserves a newer durable prompt that repeats stale snapshot text", async () => {
    const threadId = "thread-identical-prompt-new-turn";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "durable-new-repeat",
                  role: "user",
                  content: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-04T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-new-repeat" } },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "snapshot-old-repeat",
                  role: "user",
                  parts: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-01T00:00:00.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-old-repeat",
      "durable-new-repeat",
    ]);
    await transport.dispose();
  });

  it("does not hydrate stale runs as active after an explicit idle result", async () => {
    const threadId = "thread-idle-stale-run";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [],
            agentKit: {
              messages: [],
              activeRunIds: ["run-stale"],
              runs: [
                {
                  id: "run-stale",
                  threadId,
                  status: "running",
                  lastSequence: 1,
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });
    const client = new AgentKitClient({ transport });

    const thread = await client.loadThread(threadId);

    expect(thread.activeRunIds).toEqual([]);
    expect(thread.runs["run-stale"]).toMatchObject({
      status: "failed",
      error: { code: "run_state_unavailable", retryable: true },
    });
    await client.shutdown();
    await transport.dispose();
  });

  it.each([
    { serverStatus: "errored", expectedStatus: "failed" },
    { serverStatus: "aborted", expectedStatus: "cancelled" },
    { serverStatus: "truncated", expectedStatus: "failed" },
  ])(
    "maps the terminal server status $serverStatus into a visible run state",
    async ({ serverStatus, expectedStatus }) => {
      const threadId = `thread-status-${serverStatus}`;
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          if (String(input).includes("/runs/active")) {
            return json({
              active: true,
              status: serverStatus,
              runId: "run-terminal",
            });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [],
              agentKit: { messages: [] },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.runs).toContainEqual(
        expect.objectContaining({ id: "run-terminal", status: expectedStatus }),
      );
      expect(snapshot?.activeRunIds).not.toContain("run-terminal");
      if (serverStatus === "truncated") {
        expect(snapshot?.runs).toContainEqual(
          expect.objectContaining({
            id: "run-terminal",
            error: expect.objectContaining({ code: "run_truncated" }),
          }),
        );
      }
      await transport.dispose();
    },
  );

  it("does not duplicate a submitted prompt already in the thread snapshot", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "complete" });
        }
        return json({
          id: "thread-deduped-prompt",
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "server-user-run-durable",
                  role: "user",
                  content: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-04T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-durable" } },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "client-user-message",
                  role: "user",
                  parts: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-04T00:00:00.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-deduped-prompt",
    });

    expect(snapshot?.messages).toHaveLength(1);
    expect(snapshot?.messages[0]).toMatchObject({
      id: "client-user-message",
      role: "user",
      parts: [{ type: "text", text: "Repeat this prompt" }],
    });
    await transport.dispose();
  });

  it("runs the supplied host runtime through AgentKit", async () => {
    const fetcher = vi.fn(async () =>
      json({ error: "Unexpected request" }, 500),
    );
    const startTurn = vi.fn(async ({ sessionId }: { sessionId?: string }) => ({
      id: "turn-local",
      runId: "run-local",
      sessionId: sessionId ?? "thread-local",
      events: (async function* () {
        yield {
          type: "message-start",
          message: {
            id: "assistant-local",
            role: "assistant",
            content: [],
          },
        } as const;
        yield {
          type: "message-delta",
          messageId: "assistant-local",
          delta: { type: "text", text: "Local runtime reply." },
        } as const;
        yield {
          type: "message-done",
          message: {
            id: "assistant-local",
            role: "assistant",
            content: [{ type: "text", text: "Local runtime reply." }],
          },
        } as const;
        yield { type: "done", reason: "complete" } as const;
      })(),
    }));
    const runtime: AgentChatRuntime = {
      id: "test:local",
      kind: "external-agent",
      label: "Local test runtime",
      capabilities: {
        messages: {
          streaming: true,
          history: true,
          structuredContent: true,
          attachments: true,
        },
        tools: {
          events: true,
          hostTools: true,
          inputStreaming: true,
          resultStreaming: true,
        },
        sessions: { create: true, restore: true, persistent: true },
        cancellation: {
          abortSignal: true,
          explicitCancel: true,
          interrupt: true,
        },
      },
      async createSession(input) {
        const sessionId = input?.id ?? "thread-local";
        return {
          id: sessionId,
          threadId: input?.threadId,
          runtimeId: "test:local",
          startTurn: ({ abortSignal: _abortSignal }) =>
            startTurn({ sessionId }),
        };
      },
    };
    const transport = createAgentNativeAgentKitTransport({
      runtime,
      fetch: fetcher,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-local",
      messages: [
        {
          id: "user-local",
          role: "user",
          parts: [{ type: "text", text: "Use the local runtime." }],
        },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-local",
      runId,
    })) {
      events.push(event);
    }

    expect(startTurn).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message.completed",
        message: expect.objectContaining({
          id: "assistant-local",
          role: "assistant",
        }),
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "run.completed" });
    expect(fetcher).not.toHaveBeenCalled();
    await transport.dispose();
  });

  it("releases a claimed queue item when starting its run fails", async () => {
    const queueWrites: unknown[] = [];
    let queuedMessages = [{ id: "queued-terminal", text: "Try again" }];
    let startRunRequests = 0;
    let claimId: string | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/threads/thread-terminal") && !init?.method) {
          return json({
            id: "thread-terminal",
            threadData: JSON.stringify({
              queuedMessages,
            }),
          });
        }
        if (url.endsWith("/threads/thread-terminal/queued")) {
          const mutation = JSON.parse(String(init?.body)).mutation;
          queueWrites.push(mutation);
          if (mutation.type === "claim") {
            claimId = mutation.claimId;
            const claimedMessage = {
              ...queuedMessages[0],
              promotionClaim: {
                id: claimId,
                expiresAt: Date.now() + 10_000,
              },
            };
            queuedMessages[0] = claimedMessage;
            return json({ queuedMessages, claimedMessage });
          }
          if (mutation.type === "release") {
            const { promotionClaim: _claim, ...released } = queuedMessages[0];
            queuedMessages[0] = released;
          }
          return json({ queuedMessages });
        }
        if (url.endsWith("/_agent-native/agent-chat")) {
          startRunRequests += 1;
          return json({ error: "Deterministic start rejection" }, 502);
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      transport.steerQueuedMessage?.({
        threadId: "thread-terminal",
        messageId: "queued-terminal",
      }),
    ).rejects.toThrow("Deterministic start rejection");

    expect(startRunRequests).toBe(1);
    expect(queueWrites).toHaveLength(2);
    expect(queueWrites[0]).toEqual({
      type: "claim",
      messageId: "queued-terminal",
      claimId: expect.any(String),
    });
    expect(queueWrites[1]).toMatchObject({
      type: "release",
      messageId: "queued-terminal",
      claimId,
    });
    expect(queuedMessages).toEqual([
      { id: "queued-terminal", text: "Try again" },
    ]);
    await transport.dispose();
  });

  it("returns a typed busy promotion to the client for automatic retry", async () => {
    const threadId = "thread-busy";
    const queueWrites: Array<Record<string, unknown>> = [];
    const queuedMessages: Array<Record<string, unknown>> = [
      {
        id: "queued-busy",
        threadId,
        text: "Wait for the current run",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    let startRequests = 0;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith(`/threads/${threadId}/queued`)) {
          const mutation = JSON.parse(String(init?.body)).mutation;
          queueWrites.push(mutation);
          if (mutation.type === "claim") {
            const claimedMessage = {
              ...queuedMessages[0],
              promotionClaim: {
                id: mutation.claimId,
                expiresAt: Date.now() + 10_000,
              },
            };
            queuedMessages[0] = claimedMessage;
            return json({ queuedMessages, claimedMessage });
          }
          if (mutation.type === "release") {
            queuedMessages[0] = {
              id: "queued-busy",
              threadId,
              text: "Wait for the current run",
              createdAt: "2026-09-01T00:00:00.000Z",
            };
          }
          return json({ queuedMessages });
        }
        if (url.endsWith(`/threads/${threadId}`)) {
          return json({
            id: threadId,
            threadData: JSON.stringify({ queuedMessages }),
          });
        }
        if (
          url.endsWith("/_agent-native/agent-chat") &&
          init?.method === "POST"
        ) {
          startRequests += 1;
          return json(
            {
              error: "Run already in progress for this thread",
              code: "run_slot_busy",
              retryable: true,
              activeRunId: "run-active",
            },
            409,
          );
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      transport.steerQueuedMessage?.({
        threadId,
        messageId: "queued-busy",
      }),
    ).rejects.toMatchObject({
      code: "run_slot_busy",
      activeRunId: "run-active",
      retryable: true,
    });

    expect(startRequests).toBe(1);
    expect(queueWrites).toMatchObject([
      { type: "claim", messageId: "queued-busy", claimId: expect.any(String) },
      {
        type: "release",
        messageId: "queued-busy",
        claimId: expect.any(String),
      },
    ]);
    expect(queueWrites[1]?.claimId).toBe(queueWrites[0]?.claimId);
    expect(queuedMessages[0]).not.toHaveProperty("promotionClaim");
    await transport.dispose();
  });

  it("does not cancel a finished run an older server still reports as active", async () => {
    const threadId = "thread-old-server";
    const queuedMessages: Array<Record<string, unknown>> = [
      {
        id: "queued-old",
        threadId,
        text: "Send after the finished run",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    let startRequests = 0;
    const requests: string[] = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("/runs/active")) {
          // Before `active` meant in flight: a run inside the reconnect window.
          return json({
            active: true,
            runId: "run-done",
            status: "completed",
          });
        }
        if (url.endsWith(`/threads/${threadId}/queued`)) {
          const mutation = JSON.parse(String(init?.body)).mutation;
          if (mutation.type === "claim") {
            const claimedMessage = {
              ...queuedMessages[0],
              promotionClaim: {
                id: mutation.claimId,
                expiresAt: Date.now() + 10_000,
              },
            };
            queuedMessages[0] = claimedMessage;
            return json({ queuedMessages, claimedMessage });
          }
          return json({ queuedMessages });
        }
        if (url.endsWith(`/threads/${threadId}`)) {
          return json({
            id: threadId,
            threadData: JSON.stringify({ queuedMessages }),
          });
        }
        if (
          url.endsWith("/_agent-native/agent-chat") &&
          init?.method === "POST"
        ) {
          startRequests += 1;
          return json(
            { error: "busy", code: "run_slot_busy", retryable: true },
            409,
          );
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      transport.steerQueuedMessage?.({
        threadId,
        messageId: "queued-old",
        interruptActiveRun: true,
      }),
    ).rejects.toMatchObject({ code: "run_slot_busy" });

    expect(startRequests).toBe(1);
    expect(requests.some((request) => /cancel/i.test(request))).toBe(false);
    await transport.dispose();
  });

  it("distinguishes a missing thread from an empty durable queue", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({ error: "Not found" }, 404),
      ) as typeof fetch,
    });

    await expect(
      transport.listQueuedMessages?.({ threadId: "missing-thread" }),
    ).rejects.toThrow("thread missing-thread does not exist");
  });

  it("preserves an unreadable error response as an explicit request failure", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(
        async () =>
          ({
            ok: false,
            status: 502,
            text: async () => {
              throw new Error("response body unavailable");
            },
          }) as Response,
      ) as typeof fetch,
    });

    await expect(
      transport.submitFeedback?.({
        threadId: "thread-1",
        messageId: "assistant-1",
        value: "negative",
      }),
    ).rejects.toThrow(
      "Agent chat request failed with 502, and its error body could not be read.",
    );
  });

  it("explains an oversized request and marks it non-retryable", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({ error: "Payload too large" }, 413),
      ) as typeof fetch,
    });

    await expect(
      transport.submitFeedback?.({
        threadId: "thread-1",
        messageId: "assistant-1",
        value: "negative",
      }),
    ).rejects.toMatchObject({
      message:
        "This request exceeded the server's size limit (HTTP 413). Start a new chat or remove large attachments or references, then retry.",
      code: "http_413",
      status: 413,
      retryable: false,
    });
  });

  it("persists response feedback and forks durable history from a message", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/threads/thread-1") && !init?.method) {
          return json({
            id: "thread-1",
            title: "Release review",
            threadData: JSON.stringify({
              messages: [
                {
                  id: "user-1",
                  role: "user",
                  content: [{ type: "text", text: "Review it" }],
                },
              ],
              agentKit: {
                messages: [
                  {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "Review it" }],
                  },
                  {
                    id: "assistant-1",
                    role: "assistant",
                    parts: [{ type: "text", text: "Ready." }],
                  },
                  {
                    id: "user-2",
                    role: "user",
                    parts: [{ type: "text", text: "Publish it" }],
                  },
                ],
                widgets: [
                  {
                    messageId: "assistant-1",
                    widget: {
                      id: "widget-retained",
                      kind: "test.action",
                      data: {
                        toolCallId: "tool-retained",
                        toolName: "publish",
                      },
                    },
                  },
                  {
                    messageId: "user-2",
                    widget: {
                      id: "widget-later",
                      kind: "test.action",
                      data: { toolCallId: "tool-later", toolName: "publish" },
                    },
                  },
                ],
                toolCalls: [
                  {
                    id: "tool-retained",
                    name: "publish",
                    status: "completed",
                    messageId: "assistant-1",
                  },
                  {
                    id: "tool-later",
                    name: "publish",
                    status: "completed",
                    messageId: "user-2",
                  },
                ],
              },
            }),
          });
        }
        if (url.endsWith("/threads/thread-1/fork")) {
          const body = JSON.parse(String(init?.body)) as {
            id: string;
            source: { threadData: string; fromMessageId?: string };
          };
          requests.push({ url, body });
          return json({
            id: body.id,
            title: "Release review",
            threadData: body.source.threadData,
          });
        }
        if (url.endsWith("/observability/feedback")) {
          requests.push({ url, body: JSON.parse(String(init?.body)) });
          return json({ id: "feedback-1" });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      feedbackUrl: "/_agent-native/observability/feedback",
      fetch: fetcher as typeof fetch,
      adapter: { createId: () => "thread-fork" },
    });

    expect(transport.capabilities).toMatchObject({
      feedback: true,
      threadForking: true,
    });
    await transport.submitFeedback?.({
      threadId: "thread-1",
      messageId: "assistant-1",
      runId: "run-1",
      messageSeq: 2,
      value: "positive",
    });
    const fork = await transport.forkThread?.({
      threadId: "thread-1",
      fromMessageId: "assistant-1",
    });

    expect(requests[0]).toMatchObject({
      url: "/_agent-native/observability/feedback",
      body: {
        threadId: "thread-1",
        runId: "run-1",
        messageSeq: 2,
        feedbackType: "thumbs_up",
        value: { messageId: "assistant-1", value: "positive" },
      },
    });
    const forkBody = requests[1]?.body as {
      source?: {
        threadData?: string;
        messageCount?: number;
        fromMessageId?: string;
      };
    };
    expect(forkBody.source?.messageCount).toBe(2);
    expect(forkBody.source?.fromMessageId).toBe("assistant-1");
    expect(
      JSON.parse(forkBody.source?.threadData ?? "{}").messages,
    ).toHaveLength(1);
    expect(
      JSON.parse(forkBody.source?.threadData ?? "{}").agentKit.messages.map(
        (message: { id: string }) => message.id,
      ),
    ).toEqual(["user-1", "assistant-1"]);
    expect(
      JSON.parse(forkBody.source?.threadData ?? "{}").agentKit.widgets.map(
        (widget: { widget: { id: string } }) => widget.widget.id,
      ),
    ).toEqual(["widget-retained"]);
    expect(
      JSON.parse(forkBody.source?.threadData ?? "{}").agentKit.toolCalls.map(
        (toolCall: { id: string }) => toolCall.id,
      ),
    ).toEqual(["tool-retained"]);
    expect(fork).toMatchObject({
      id: "thread-fork",
      messages: [{ id: "user-1" }, { id: "assistant-1" }],
      widgets: [
        {
          messageId: "assistant-1",
          widget: { id: "widget-retained" },
        },
      ],
    });
  });

  it("carries first-party screen scope and security references without overstating capabilities", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/_agent-native/agent-chat")) {
          requestBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, {
            headers: {
              "content-type": "text/event-stream",
              "x-run-id": "run-context-1",
            },
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
      browserTabId: "tab-1",
      surface: "app",
      mode: "plan",
      scope: { type: "issue", id: "issue-42", label: "Issue 42" },
      adapter: {
        capabilities: { actions: true, resumableRuns: true, uploads: true },
        metadata: {
          "x-agent-native": {
            context: {
              route: {
                id: "/issues/42",
                kind: "route",
                label: "Issue 42",
              },
              screen: {
                id: "issue-detail",
                kind: "screen",
                label: "Issue",
              },
            },
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
            access: { decisionId: "access-1" },
            audit: { eventId: "audit-1" },
          },
        },
      },
    });

    const { runId, capabilities } = await transport.startRun({
      threadId: "thread-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Inspect this issue" }],
        },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId,
    })) {
      events.push(event);
    }

    expect(requestBody?.metadata).toMatchObject({
      "x-agent-native": {
        context: {
          browserTabId: "tab-1",
          mode: "plan",
          route: { id: "/issues/42" },
          screen: { id: "issue-detail" },
          scope: { type: "issue", id: "issue-42" },
          focusedObjects: [{ id: "issue-42", kind: "issue" }],
        },
        identity: {
          actor: { id: "user-1" },
          workspace: { id: "workspace-1" },
          organization: { id: "org-1" },
        },
        access: { decisionId: "access-1" },
        audit: { eventId: "audit-1" },
        smartObjects: [{ id: "issue-42", kind: "issue" }],
      },
    });
    expect(events[0]?.metadata).toMatchObject({
      "x-agent-native": {
        context: { browserTabId: "tab-1" },
        identity: { actor: { id: "user-1" } },
        observability: {
          protocolRunId: "run-context-1",
          runtimeRunId: "run-context-1",
        },
      },
    });
    expect(capabilities).toMatchObject({
      actions: false,
      feedback: true,
      messageQueue: true,
      resumableRuns: true,
      threadForking: true,
      threadHistory: true,
      uploads: false,
    });
  });
});
