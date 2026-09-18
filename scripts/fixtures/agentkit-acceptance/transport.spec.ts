import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentEvent,
  AgentMessage,
  AgentTransport,
  StartRunInput,
} from "@agent-native/agentkit/protocol";

import {
  acceptanceSuggestionSourcePrompt,
  instrumentAgentKitAcceptanceTransport,
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
