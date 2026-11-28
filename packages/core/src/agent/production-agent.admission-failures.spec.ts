import { randomUUID } from "node:crypto";

import { mockEvent } from "h3";
import { expect, it, vi } from "vitest";

import {
  createThread,
  QueuedSubmissionAdmissionError,
} from "../chat-threads/store.js";
import { getDbExec } from "../db/client.js";
import { runWithRequestContext } from "../server/request-context.js";
import type { AgentEngine } from "./engine/types.js";
import { createProductionAgentHandler } from "./production-agent.js";
import { updateRunTerminalStateIfRunning } from "./run-store.js";

const ownerEmail = "owner@example.com";

it.each([
  {
    code: "queued_message_id_conflict" as const,
    message: "This message ID was already used for a different submission",
  },
  {
    code: "queued_message_id_terminal" as const,
    message: "This message ID is no longer available for submission",
  },
])(
  "persists the $code admission failure and returns 409",
  async ({ code, message }) => {
    const threadId = `thread-${randomUUID()}`;
    const messageId = `message-${randomUUID()}`;
    await createThread(ownerEmail, { id: threadId });
    let runId = "";
    const failure = new QueuedSubmissionAdmissionError(code, messageId);
    const engine = testEngine();
    const handler = createProductionAgentHandler({
      systemPrompt: "Test",
      engine,
      assertAiSetupReady: async () => {},
      onRunPrepared: async (prepared) => {
        runId = prepared.runId;
        throw failure;
      },
    });
    const event = request(threadId, messageId);
    const result = await runWithRequestContext(
      { userEmail: ownerEmail, run: {} },
      () => handler(event),
    );

    expect(event.res.status).toBe(409);
    expect(result).toEqual({ error: message, code, retryable: false });
    expect(engine.stream).not.toHaveBeenCalled();
    expect(await readRun(runId)).toEqual({
      status: "errored",
      terminal_reason: `error:${code}`,
      error_code: code,
      error_detail: failure.message,
    });
  },
);

it.each([
  new Error("preparation storage unavailable"),
  Object.assign(new Error("unrelated coded error"), {
    code: "queued_message_id_conflict",
  }),
  new QueuedSubmissionAdmissionError(
    "queued_message_already_submitted",
    "message-already-submitted",
  ),
])(
  "persists unrelated preparation errors as retryable failures and rethrows: %s",
  async (failure) => {
    const threadId = `thread-${randomUUID()}`;
    await createThread(ownerEmail, { id: threadId });
    let runId = "";
    const engine = testEngine();
    const handler = createProductionAgentHandler({
      systemPrompt: "Test",
      engine,
      assertAiSetupReady: async () => {},
      onRunPrepared: async (prepared) => {
        runId = prepared.runId;
        throw failure;
      },
    });
    const event = request(threadId, `message-${randomUUID()}`);

    await expect(
      runWithRequestContext({ userEmail: ownerEmail, run: {} }, () =>
        handler(event),
      ),
    ).rejects.toBe(failure);
    expect(engine.stream).not.toHaveBeenCalled();
    expect(await readRun(runId)).toEqual({
      status: "errored",
      terminal_reason: "run_preparation_failed",
      error_code: "run_preparation_failed",
      error_detail: failure.message,
    });
  },
);

it("does not overwrite a run already terminal when preparation fails", async () => {
  const threadId = `thread-${randomUUID()}`;
  await createThread(ownerEmail, { id: threadId });
  let runId = "";
  const failure = new Error("late preparation failure");
  const handler = createProductionAgentHandler({
    systemPrompt: "Test",
    engine: testEngine(),
    assertAiSetupReady: async () => {},
    onRunPrepared: async (prepared) => {
      runId = prepared.runId;
      await updateRunTerminalStateIfRunning(runId, {
        status: "errored",
        terminalReason: "error:earlier_failure",
        errorCode: "earlier_failure",
        errorDetail: "Earlier failure",
      });
      throw failure;
    },
  });
  const event = request(threadId, `message-${randomUUID()}`);
  await expect(
    runWithRequestContext({ userEmail: ownerEmail, run: {} }, () =>
      handler(event),
    ),
  ).rejects.toBe(failure);
  expect(await readRun(runId)).toEqual({
    status: "errored",
    terminal_reason: "error:earlier_failure",
    error_code: "earlier_failure",
    error_detail: "Earlier failure",
  });
});

function request(threadId: string, messageId: string) {
  return mockEvent(
    new Request("http://app.example.com/_agent-native/agent-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Run",
        threadId,
        agentKitMessageId: messageId,
      }),
    }),
  );
}

function testEngine(): AgentEngine {
  return {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    stream: vi.fn(),
  };
}

async function readRun(runId: string) {
  const rows = await getDbExec().execute({
    sql: "SELECT status, terminal_reason, error_code, error_detail FROM agent_runs WHERE id = ?",
    args: [runId],
  });
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0];
}
