import { createApp } from "h3";
import { expect, it, vi } from "vitest";

import { QueuedSubmissionAdmissionError } from "../chat-threads/store.js";
import { runWithRequestContext } from "../server/request-context.js";
import type { AgentEngine } from "./engine/types.js";
import { createProductionAgentHandler } from "./production-agent.js";

it("returns a non-retryable 409 when a submission conflicts during run preparation", async () => {
  const messageId = "conflicting-message";
  const stream = vi.fn();
  const engine: AgentEngine = {
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
    stream,
  };
  const onRunPrepared = vi.fn(async () => {
    throw new QueuedSubmissionAdmissionError(
      "queued_message_id_conflict",
      messageId,
    );
  });
  const handler = createProductionAgentHandler({
    systemPrompt: "Test",
    engine,
    assertAiSetupReady: async () => {},
    onRunPrepared,
  });
  const app = createApp();
  app.use("/_agent-native/agent-chat", handler);
  const response = await runWithRequestContext(
    { userEmail: "owner@example.com", run: {} },
    () =>
      app.fetch(
        new Request("http://app.example.com/_agent-native/agent-chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Run", queuedMessageId: messageId }),
        }),
      ),
  );

  expect(onRunPrepared).toHaveBeenCalledOnce();
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    error: "This message ID was already used for a different submission",
    code: "queued_message_id_conflict",
    retryable: false,
  });
  expect(stream).not.toHaveBeenCalled();
});
