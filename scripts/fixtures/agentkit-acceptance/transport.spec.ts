import assert from "node:assert/strict";
import test from "node:test";

import type { AgentKitController } from "@agent-native/agentkit/client";
import type {
  AgentEvent,
  AgentMessage,
  AgentTransport,
  StartRunInput,
} from "@agent-native/agentkit/protocol";

import {
  createAgentThreadState,
  hasActiveAgentRuns,
} from "../../../packages/agentkit/src/client/state.ts";
import {
  acceptanceRejectedSteerPrompt,
  acceptanceSuggestionSourcePrompt,
  instrumentAgentKitAcceptanceTransport,
  getAcceptanceDiagnostics,
  registerAcceptanceClientDiagnostics,
} from "./transport.ts";

async function collectEvents(
  events: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

test("translates transformed replay cursors back to source sequence space", async () => {
  const sourceCursors: Array<number | undefined> = [];
  const sourceEvents: AgentEvent[] = [
    {
      id: "event-1",
      threadId: "thread-1",
      runId: "run-1",
      sequence: 1,
      occurredAt: "2026-09-17T00:00:00.000Z",
      type: "run.started",
    },
    {
      id: "event-2",
      threadId: "thread-1",
      runId: "run-1",
      sequence: 2,
      occurredAt: "2026-09-17T00:00:01.000Z",
      type: "run.status",
      status: "completed",
    },
    {
      id: "event-3",
      threadId: "thread-1",
      runId: "run-1",
      sequence: 3,
      occurredAt: "2026-09-17T00:00:02.000Z",
      type: "run.completed",
    },
  ];
  const transport: AgentTransport = {
    async startRun() {
      return { runId: "run-1" };
    },
    subscribeToRun(input) {
      sourceCursors.push(input.afterSequence);
      return (async function* () {
        for (const event of sourceEvents) {
          if (event.sequence > (input.afterSequence ?? 0)) yield event;
        }
      })();
    },
    async cancelRun() {},
  };
  const instrumented = instrumentAgentKitAcceptanceTransport(transport);
  const messages: AgentMessage[] = [
    {
      id: "user-1",
      role: "user",
      status: "complete",
      parts: [{ type: "text", text: acceptanceSuggestionSourcePrompt }],
    },
  ];
  const input: StartRunInput = { threadId: "thread-1", messages };

  await instrumented.startRun(input);
  const first = await collectEvents(
    instrumented.subscribeToRun({ threadId: "thread-1", runId: "run-1" }),
  );
  const resumed = await collectEvents(
    instrumented.subscribeToRun({
      threadId: "thread-1",
      runId: "run-1",
      afterSequence: 2,
    }),
  );

  assert.deepEqual(
    first.map((event) => event.sequence),
    [1, 2, 3, 4],
  );
  assert.equal(first[1]?.type, "suggestions.updated");
  assert.deepEqual(
    resumed.map((event) => event.sequence),
    [3, 4],
  );
  assert.deepEqual(sourceCursors, [undefined, 1]);
  assert.equal(resumed[0]?.type, "run.status");
});

test("rejects one queued steering attempt and permits the retry", async () => {
  let steerCalls = 0;
  let queuedMessageId = "";
  const transport: AgentTransport = {
    async startRun() {
      return { runId: "run-1" };
    },
    subscribeToRun() {
      return (async function* () {})();
    },
    async cancelRun() {},
    async queueMessage(input) {
      queuedMessageId = "queued-retry";
      return {
        message: {
          id: queuedMessageId,
          threadId: input.threadId,
          text: input.text,
          createdAt: "2026-09-17T00:00:00.000Z",
        },
      };
    },
    async listQueuedMessages() {
      return [];
    },
    async steerQueuedMessage() {
      steerCalls++;
      return { runId: "run-1" };
    },
  };
  const instrumented = instrumentAgentKitAcceptanceTransport(transport);
  assert.ok(instrumented.steerQueuedMessage);
  await instrumented.queueMessage?.({
    threadId: "thread-1",
    text: acceptanceRejectedSteerPrompt,
  });

  await assert.rejects(
    instrumented.steerQueuedMessage({
      threadId: "thread-1",
      messageId: queuedMessageId,
    }),
    /Deterministic queue steering rejection/u,
  );
  assert.equal(steerCalls, 0);

  await instrumented.steerQueuedMessage?.({
    threadId: "thread-1",
    messageId: queuedMessageId,
  });
  assert.equal(steerCalls, 1);
});

test("captures a bounded client promotion gate without message payloads", () => {
  const state = createAgentThreadState("diagnostic-thread");
  state.activeRunIds = ["interrupted-run"];
  state.runs["interrupted-run"] = {
    id: "interrupted-run",
    status: "running",
    lastSequence: 3,
  };
  state.queuedMessages = [
    {
      id: "queued-diagnostic",
      threadId: state.id,
      text: "DO_NOT_LOG_PAYLOAD",
      createdAt: "2026-09-29T00:00:00.000Z",
    },
  ];
  let listener: (() => void) | undefined;
  let released = false;
  const controller = {
    getThread: () => state,
    subscribe: (callback: () => void) => {
      listener = callback;
      return () => {
        released = true;
      };
    },
  } as unknown as AgentKitController;
  const release = registerAcceptanceClientDiagnostics(
    controller,
    state.id,
    hasActiveAgentRuns,
  );
  for (let index = 0; index < 250; index++) listener?.();
  assert.equal(getAcceptanceDiagnostics().length, 200);
  assert.equal(getAcceptanceDiagnostics().at(-1)?.hasActiveRuns, true);
  state.runs["interrupted-run"].status = "completed";
  listener?.();
  assert.equal(getAcceptanceDiagnostics().at(-1)?.hasActiveRuns, false);
  assert.deepEqual(getAcceptanceDiagnostics().at(-1)?.queuedMessageIds, [
    "queued-diagnostic",
  ]);
  assert.equal(
    JSON.stringify(getAcceptanceDiagnostics()).includes("DO_NOT_LOG_PAYLOAD"),
    false,
  );
  release();
  assert.equal(released, true);
});

test("records steering failures and preserves the original rejection", async () => {
  const failure = new Error("Agent chat run slot did not become available.");
  const transport: AgentTransport = {
    async startRun() {
      return { runId: "diagnostic-run" };
    },
    subscribeToRun() {
      return (async function* () {})();
    },
    async cancelRun() {},
    async listQueuedMessages() {
      return [];
    },
    async steerQueuedMessage() {
      throw failure;
    },
  };
  const instrumented = instrumentAgentKitAcceptanceTransport(transport);
  assert.ok(instrumented.steerQueuedMessage);
  await assert.rejects(
    instrumented.steerQueuedMessage({
      threadId: "diagnostic-thread",
      messageId: "queued-diagnostic",
    }),
    (error) => error === failure,
  );
  assert.deepEqual(
    getAcceptanceDiagnostics()
      .slice(-2)
      .map((entry) => entry.type),
    ["transport.steer.started", "transport.steer.failed"],
  );
  assert.deepEqual(getAcceptanceDiagnostics().at(-1)?.error, {
    name: "Error",
    message: failure.message,
  });
});
