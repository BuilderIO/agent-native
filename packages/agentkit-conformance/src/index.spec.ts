import type {
  AgentCapabilities,
  AgentEvent,
  AgentMessage,
  AgentQueuedMessage,
  AgentRunSnapshot,
  AgentTransport,
} from "@agent-native/agentkit-protocol";
import { AGENTKIT_PROTOCOL_VERSION } from "@agent-native/agentkit-protocol";
import { describe, expect, it } from "vitest";

import {
  AgentKitHttpError,
  createAgentKitHttpHandler,
  createAgentKitHttpTransport,
} from "../../agentkit-adapters/src/index.js";
import type {
  AgentChatRuntime,
  AgentChatRuntimeEvent,
} from "../../core/src/client/chat/index.js";
import { createAgentKitProtocolAdapter } from "../../core/src/client/chat/index.js";
import {
  assertAgentTransportConformance,
  type AgentKitConformanceScenario,
} from "./index.js";

type FixtureDefect =
  | "abort"
  | "approval"
  | "approval-decision"
  | "cancellation"
  | "capabilities"
  | "cross-thread"
  | "duplicate-event"
  | "event-order"
  | "running-activity"
  | "lifecycle-projection"
  | "queue"
  | "reconnect"
  | "terminal-failure"
  | "unsupported"
  | "version";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

interface FixtureRun {
  id: string;
  threadId: string;
  scenario: AgentKitConformanceScenario;
  events: AgentEvent[];
  subscriptions: number;
  cancelled: Deferred;
  approved: Deferred;
}

const occurredAt = "2026-08-29T00:00:00.000Z";

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function event(
  run: Pick<FixtureRun, "id" | "threadId">,
  sequence: number,
  payload: Omit<
    AgentEvent,
    "id" | "threadId" | "runId" | "sequence" | "occurredAt"
  >,
  id = `${run.id}-event-${sequence}`,
): AgentEvent {
  return {
    id,
    threadId: run.threadId,
    runId: run.id,
    sequence,
    occurredAt,
    ...payload,
  } as AgentEvent;
}

function message(id: string, text: string): AgentMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function unsupportedError(): Error & { code: string } {
  return Object.assign(new Error("Unsupported capability"), {
    code: "unsupported_capability",
  });
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

function createFixtureTransport(
  preparedScenario: AgentKitConformanceScenario,
  defect?: FixtureDefect,
): AgentTransport {
  const capabilities: AgentCapabilities = {
    protocolVersion:
      defect === "version"
        ? ((AGENTKIT_PROTOCOL_VERSION + 1) as typeof AGENTKIT_PROTOCOL_VERSION)
        : AGENTKIT_PROTOCOL_VERSION,
    actions: false,
    approvals: true,
    messageQueue: true,
    resumableRuns: true,
    threadHistory: true,
    widgets: true,
    taskGroups: true,
  };
  const runs = new Map<string, FixtureRun>();
  const queued = new Map<string, AgentQueuedMessage>();
  let runNumber = 0;
  let queueNumber = 0;

  const makeRun = (
    scenario: AgentKitConformanceScenario,
    threadId: string,
  ): FixtureRun => {
    const run: FixtureRun = {
      id: `${scenario}-run-${++runNumber}`,
      threadId,
      scenario,
      events: [],
      subscriptions: 0,
      cancelled: deferred(),
      approved: deferred(),
    };
    run.events.push(event(run, 1, { type: "run.started" }));

    if (scenario === "completed") {
      run.events.push(
        event(
          run,
          defect === "event-order" ? 3 : 2,
          {
            type: "annotation.created",
            messageId: "message-1",
            annotation: {
              id: "annotation-1",
              kind: "source",
              label: "Draft source",
            },
          },
          defect === "duplicate-event" ? run.events[0]!.id : undefined,
        ),
        event(run, 3, {
          type: "annotation.updated",
          annotation: {
            id: "annotation-1",
            kind: "source",
            label: "Final source",
          },
        }),
        event(run, 4, {
          type: "annotation.removed",
          annotationId: "annotation-1",
        }),
        event(run, 5, {
          type: "widget.created",
          messageId: "message-1",
          widget: { id: "widget-1", kind: "status", data: { ready: false } },
        }),
        event(run, 6, {
          type: "widget.updated",
          widget: { id: "widget-1", kind: "status", data: { ready: true } },
        }),
        event(run, 7, { type: "widget.removed", widgetId: "widget-1" }),
        event(run, 8, {
          type: "task-group.created",
          taskGroup: {
            id: "group-1",
            title: "Conformance",
            status: "running",
            taskIds: ["task-1"],
          },
        }),
        event(run, 9, {
          type: "task-group.updated",
          taskGroup: {
            id: "group-1",
            title: "Conformance",
            status: "running",
            taskIds: ["task-1", "task-2"],
          },
        }),
        event(run, 10, { type: "task-group.removed", taskGroupId: "group-1" }),
        event(run, 11, {
          type: "task-group.created",
          taskGroup: {
            id: "group-2",
            title: "Release",
            status: "running",
            taskIds: ["task-3"],
          },
        }),
        event(run, 12, {
          type: "task-group.completed",
          taskGroup: {
            id: "group-2",
            title: "Release",
            status: "completed",
            taskIds: ["task-3"],
          },
        }),
        ...(defect === "running-activity"
          ? [
              event(run, 13, {
                type: "activity.updated",
                activity: {
                  id: "activity-stuck",
                  kind: "status",
                  label: "Still working",
                  status: "running",
                },
              }),
              event(run, 14, { type: "run.completed" }),
            ]
          : [event(run, 13, { type: "run.completed" })]),
      );
    } else if (scenario === "cross-thread") {
      const terminalId =
        defect === "duplicate-event" ? run.events[0]!.id : undefined;
      run.events.push(
        event(
          run,
          defect === "event-order" ? 3 : 2,
          { type: "run.completed" },
          terminalId,
        ),
      );
    } else if (scenario === "abort") {
      run.events.push(
        event(run, 2, {
          type: "message.created",
          message: message(`${run.id}-message`, "continued after disconnect"),
        }),
        event(run, 3, { type: "run.completed" }),
      );
    } else if (scenario === "reconnect") {
      run.events.push(event(run, 2, { type: "run.completed" }));
    } else if (scenario === "approval") {
      run.events.push(
        event(run, 2, {
          type: "approval.requested",
          request: {
            id: `${run.id}-approval`,
            title: "Approve conformance continuation",
            options: [{ id: "approve", label: "Approve", kind: "primary" }],
          },
        }),
      );
    } else if (scenario === "terminal-failure") {
      run.events.push(
        event(run, 2, {
          type: "run.failed",
          error: {
            code: defect === "terminal-failure" ? "" : "fixture_failure",
            message: "Deterministic terminal failure",
          },
        }),
      );
    }
    runs.set(run.id, run);
    return run;
  };

  const transport: AgentTransport = {
    capabilities,
    async getCapabilities() {
      return capabilities;
    },
    async startRun(input) {
      return { runId: makeRun(preparedScenario, input.threadId).id };
    },
    async *subscribeToRun(input) {
      const run = runs.get(input.runId);
      if (!run) throw new Error("Unknown run");
      if (run.threadId !== input.threadId) {
        if (defect === "cross-thread") yield* run.events;
        else throw new Error("Run does not belong to this thread");
        return;
      }

      run.subscriptions += 1;
      const afterSequence = input.afterSequence ?? 0;
      if (
        run.scenario === "reconnect" &&
        run.subscriptions === 1 &&
        afterSequence === 0
      ) {
        yield run.events[0]!;
        throw new Error("Deterministic transport interruption");
      }
      if (run.scenario === "reconnect" && defect === "reconnect") {
        yield* run.events;
        return;
      }
      if (run.scenario === "abort" && input.signal && afterSequence === 0) {
        yield run.events[0]!;
        await waitForAbort(input.signal);
        if (defect === "abort") yield run.events[1]!;
        return;
      }

      for (const item of run.events) {
        if (item.sequence > afterSequence) yield item;
      }
      if (run.scenario === "cancellation" && run.events.length === 1) {
        await run.cancelled.promise;
        yield* run.events.slice(1);
      }
      if (run.scenario === "approval" && run.events.length === 2) {
        await run.approved.promise;
        yield* run.events.slice(2);
      }
    },
    async cancelRun(input) {
      const run = runs.get(input.runId);
      if (!run || run.threadId !== input.threadId)
        throw new Error("Unknown run");
      run.events.push(
        event(run, 2, {
          type: defect === "cancellation" ? "run.completed" : "run.cancelled",
        }),
      );
      run.cancelled.resolve();
    },
    async getRun(input) {
      const run = runs.get(input.runId);
      if (!run || run.threadId !== input.threadId) return null;
      const terminal = run.events.at(-1);
      const status: AgentRunSnapshot["status"] =
        terminal?.type === "run.completed"
          ? "completed"
          : terminal?.type === "run.failed"
            ? "failed"
            : terminal?.type === "run.cancelled"
              ? "cancelled"
              : terminal?.type === "approval.requested"
                ? "awaiting_approval"
                : "running";
      return {
        id: run.id,
        threadId: run.threadId,
        status,
        lastSequence: terminal?.sequence ?? 0,
        ...(terminal?.type === "run.failed" ? { error: terminal.error } : {}),
      };
    },
    async getThreadSnapshot(input) {
      const threadRuns = [...runs.values()].filter(
        (run) => run.threadId === input.threadId,
      );
      const queuedMessages = [...queued.values()].filter(
        (item) => item.threadId === input.threadId,
      );
      if (threadRuns.length === 0 && queuedMessages.length === 0) return null;
      const events = threadRuns.flatMap((run) => run.events);
      return {
        id: input.threadId,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        messages: events.flatMap((item) =>
          item.type === "message.created" ? [item.message] : [],
        ),
        events,
        queuedMessages,
        widgets: [],
        annotations: [],
        taskGroups: [
          defect === "lifecycle-projection"
            ? {
                id: "stale-group",
                title: "Stale projection",
                status: "running",
                taskIds: [],
              }
            : {
                id: "group-2",
                title: "Release",
                status: "completed",
                taskIds: ["task-3"],
              },
        ],
      };
    },
    async invokeAction() {
      if (defect === "unsupported") {
        return { invocationId: "unsupported", status: "completed" };
      }
      throw unsupportedError();
    },
    async listQueuedMessages(input) {
      return [...queued.values()].filter(
        (item) => item.threadId === input.threadId,
      );
    },
    async queueMessage(input) {
      const queuedMessage: AgentQueuedMessage = {
        id: `queued-${++queueNumber}`,
        threadId: input.threadId,
        text: input.text,
        createdAt: occurredAt,
        attachments: input.attachments,
        metadata: input.metadata,
      };
      queued.set(queuedMessage.id, queuedMessage);
      return { message: queuedMessage };
    },
    async steerQueuedMessage(input) {
      const queuedMessage = queued.get(input.messageId);
      if (!queuedMessage || queuedMessage.threadId !== input.threadId) {
        throw new Error("Unknown queued message");
      }
      queued.delete(input.messageId);
      const run = makeRun("queue", input.threadId);
      run.events.push(
        event(run, 2, {
          type: "message.created",
          message: message(
            defect === "queue"
              ? `${queuedMessage.id}-changed`
              : queuedMessage.id,
            queuedMessage.text,
          ),
        }),
        event(run, 3, { type: "run.completed" }),
      );
      return { runId: run.id };
    },
    async removeQueuedMessage(input) {
      const queuedMessage = queued.get(input.messageId);
      if (!queuedMessage || queuedMessage.threadId !== input.threadId) {
        throw new Error("Unknown queued message");
      }
      queued.delete(input.messageId);
    },
  };

  if (defect !== "capabilities") {
    transport.resolveApproval = async (input) => {
      const run = runs.get(input.runId);
      if (!run || run.threadId !== input.threadId)
        throw new Error("Unknown run");
      if (defect !== "approval") {
        run.events.push(
          event(run, 3, {
            type: "approval.resolved",
            approvalId: input.approvalId,
            optionId: input.optionId,
            response:
              defect === "approval-decision"
                ? { decision: "allow" as "approve" }
                : input.response,
          }),
        );
      }
      run.events.push(
        event(run, run.events.length + 1, { type: "run.completed" }),
      );
      run.approved.resolve();
    };
  }

  return transport;
}

function createCoreRuntime(
  scenario: AgentKitConformanceScenario,
): AgentChatRuntime {
  let runNumber = 0;

  return {
    id: `agentkit-conformance-${scenario}`,
    kind: "agent-native",
    label: "AgentKit conformance runtime",
    capabilities: {
      messages: {
        streaming: true,
        attachments: false,
        history: false,
      },
      tools: {
        events: false,
        approvals: false,
        hostTools: false,
      },
      sessions: { create: true, fork: false },
      cancellation: { abortSignal: true, explicitCancel: true },
      models: { selectable: false },
      rich: {
        annotations: false,
        citations: false,
        widgets: false,
        clientEffects: false,
        participants: false,
        interactions: false,
        tasks: false,
        taskGroups: false,
        extensions: false,
        uploadProgress: false,
      },
    },
    createSession(input) {
      const threadId = input?.threadId ?? input?.id ?? "core-thread";
      let activeCancellation: Deferred | undefined;
      return {
        id: threadId,
        runtimeId: `agentkit-conformance-${scenario}`,
        threadId,
        startTurn() {
          const runId = `${scenario}-core-run-${++runNumber}`;
          const cancelled = deferred();
          activeCancellation = cancelled;
          const events =
            async function* (): AsyncIterable<AgentChatRuntimeEvent> {
              if (scenario === "cancellation") {
                await cancelled.promise;
                yield { type: "done", reason: "cancelled" };
                return;
              }
              if (scenario === "abort") {
                await new Promise<never>(() => undefined);
              }
              if (scenario === "terminal-failure") {
                yield {
                  type: "error",
                  code: "fixture_failure",
                  error: "Deterministic terminal failure",
                };
                yield { type: "done", reason: "error" };
                return;
              }
              yield {
                type: "message-start",
                message: {
                  id: `${runId}-assistant`,
                  role: "assistant",
                  content: [],
                },
              };
              yield {
                type: "message-delta",
                messageId: `${runId}-assistant`,
                delta: { type: "text", text: "Conformance complete." },
              };
              yield { type: "done", reason: "complete" };
            };
          return {
            id: `${runId}-turn`,
            runId,
            sessionId: threadId,
            events: events(),
            async cancel() {
              cancelled.resolve();
              return { status: "cancelled" };
            },
          };
        },
        async cancelTurn() {
          activeCancellation?.resolve();
          return { status: "cancelled" };
        },
      };
    },
  };
}

function createFetchBridge(
  handler: (request: Request) => Promise<Response>,
): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal ?? undefined;
    const response = await handler(new Request(input, init));
    if (!response.body || !signal) return response;

    const reader = response.body.getReader();
    let finished = false;
    let abort: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        abort = () => {
          if (finished) return;
          finished = true;
          void reader.cancel(signal.reason);
          controller.error(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("The request was aborted.", "AbortError"),
          );
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      },
      async pull(controller) {
        if (finished) return;
        const next = await reader.read();
        if (next.done) {
          finished = true;
          if (abort) signal.removeEventListener("abort", abort);
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      },
      async cancel(reason) {
        finished = true;
        if (abort) signal.removeEventListener("abort", abort);
        await reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

describe("assertAgentTransportConformance", () => {
  it("executes the complete transport lifecycle contract", async () => {
    const report = await assertAgentTransportConformance({
      createTransport: (scenario) => createFixtureTransport(scenario),
      timeoutMs: 250,
    });

    expect(report.profile).toBe("full");
    expect(report.scenarioEventCount).toBeGreaterThan(0);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        "capabilities truthfulness",
        "cancellation",
        "abort/disconnect",
        "reconnect interruption",
        "cross-thread isolation",
        "queue identity/steering",
        "approval continuation",
        "unsupported operations",
        "event ordering/deduplication",
        "terminal failure",
        "version compatibility",
        "rich lifecycle replay",
        "rich lifecycle snapshot",
      ]),
    );
  });

  it("keeps a baseline profile for transports without lifecycle fixtures", async () => {
    const transport = createFixtureTransport("completed");
    let disposeCalls = 0;
    transport.dispose = () => {
      disposeCalls += 1;
    };
    const report = await assertAgentTransportConformance({ transport });

    expect(report.profile).toBe("baseline");
    expect(report.eventCount).toBe(13);
    expect(report.replayedEventCount).toBe(7);
    expect(report.checks).not.toContain("cancellation");
    expect(disposeCalls).toBe(0);
  });

  it("awaits disposal of every factory-created transport", async () => {
    const disposed: AgentKitConformanceScenario[] = [];
    await assertAgentTransportConformance({
      createTransport(scenario) {
        const transport = createFixtureTransport(scenario);
        transport.dispose = () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              disposed.push(scenario);
              resolve();
            }, 0);
          });
        return transport;
      },
      timeoutMs: 250,
    });

    expect(disposed).toEqual([
      "cancellation",
      "abort",
      "reconnect",
      "cross-thread",
      "queue",
      "approval",
      "terminal-failure",
      "completed",
    ]);
  });

  it("disposes created transports when conformance fails", async () => {
    const disposed: AgentKitConformanceScenario[] = [];
    await expect(
      assertAgentTransportConformance({
        createTransport(scenario) {
          const transport = createFixtureTransport(scenario, "cancellation");
          transport.dispose = () => {
            disposed.push(scenario);
          };
          return transport;
        },
        timeoutMs: 250,
      }),
    ).rejects.toThrow(/Expected run\.cancelled/iu);

    expect(disposed).toEqual(["cancellation", "completed"]);
  });

  it.each<readonly [FixtureDefect, RegExp]>([
    ["capabilities", /approvals is advertised/iu],
    ["cancellation", /Expected run\.cancelled/iu],
    ["abort", /stop event delivery/iu],
    ["reconnect", /must be contiguous; expected 2/iu],
    ["cross-thread", /different thread/iu],
    ["queue", /exactly one user message/iu],
    ["approval", /approval\.resolved/iu],
    ["approval-decision", /response\.decision/iu],
    ["unsupported", /invokeAction must reject/iu],
    ["duplicate-event", /emitted more than once/iu],
    ["event-order", /must be contiguous; expected 2/iu],
    ["running-activity", /must close every running activity/iu],
    ["lifecycle-projection", /lifecycle projections must match/iu],
    ["terminal-failure", /non-empty (?:error code|string)/iu],
    ["version", /protocolVersion|protocol version/iu],
  ])("rejects the %s contract defect", async (defect, expected) => {
    await expect(
      assertAgentTransportConformance({
        createTransport: (scenario) => createFixtureTransport(scenario, defect),
        timeoutMs: 250,
      }),
    ).rejects.toThrow(expected);
  });
});

describe("production AgentKit adapter targets", () => {
  it("runs the full lifecycle contract through the HTTP/SSE adapter", async () => {
    const report = await assertAgentTransportConformance({
      createTransport(scenario) {
        const serverTransport = createFixtureTransport(scenario);
        delete serverTransport.invokeAction;
        const handler = createAgentKitHttpHandler({
          basePath: "/agentkit",
          transport: serverTransport,
        });
        return createAgentKitHttpTransport({
          baseUrl: "https://agentkit.test/agentkit",
          createCorrelationId: () => `conformance-${scenario}`,
          fetch: createFetchBridge(handler),
        });
      },
      isUnsupportedError: (error) =>
        error instanceof AgentKitHttpError &&
        (error.status === 501 || /unsupported/iu.test(error.code ?? "")),
      timeoutMs: 500,
    });

    expect(report.profile).toBe("full");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        "cursor replay",
        "reconnect interruption",
        "queue identity/steering",
        "approval continuation",
      ]),
    );
  });

  it("runs the baseline contract through Core's Agent-Native adapter", async () => {
    const transport = createAgentKitProtocolAdapter(
      createCoreRuntime("completed"),
      { now: () => occurredAt },
    );
    const report = await assertAgentTransportConformance({
      transport,
      timeoutMs: 500,
    });

    expect(report.profile).toBe("baseline");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        "capabilities truthfulness",
        "event ordering/deduplication",
        "terminal completion",
      ]),
    );
  });
});
