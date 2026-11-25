import { parseAgentEvent } from "@agent-native/agentkit/protocol";
import { describe, expect, it } from "vitest";

import { sanitizeThreadDataForPrivateActions } from "../../agent/thread-data-builder.js";
import { createAgentNativeAgentKitTransport } from "./agentkit-agent-native.js";

const threadId = "private-import-thread";
const runId = "private-import-run";
const prompt = "Create a presentation from my uploaded document.";
const privateText = "Private document content that must stay omitted";
const occurredAt = "2026-11-23T00:00:00.000Z";

function event(payload: Record<string, unknown>, sequence = 1) {
  return {
    id: `event-${sequence}`,
    threadId,
    runId,
    sequence,
    occurredAt,
    ...payload,
  };
}

function transportFor(events: unknown[], redact = true) {
  const repository = {
    messages: [],
    agentKit: {
      messages: [
        {
          id: "user-message",
          role: "user",
          parts: [{ type: "text", text: prompt }],
        },
      ],
      events,
      runs: [{ id: runId, threadId, status: "completed", lastSequence: 3 }],
    },
  };
  const stored = {
    id: threadId,
    title: prompt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    threadData: JSON.stringify(
      redact
        ? sanitizeThreadDataForPrivateActions(repository, new Set(), [
            { runId, omitFromPersistedHistory: true },
          ])
        : repository,
    ),
  };
  return createAgentNativeAgentKitTransport({
    fetch: async (input) =>
      Response.json(
        String(input).includes("/runs/active")
          ? { active: false, status: "idle" }
          : stored,
      ),
  });
}

const assistant = {
  id: "assistant-message",
  role: "assistant",
  parts: [{ type: "text", text: privateText }],
};

describe("private imported-document conversation restoration", () => {
  it.each([
    { type: "message.created", message: assistant },
    { type: "message.delta", messageId: assistant.id, text: privateText },
    { type: "reasoning.delta", messageId: assistant.id, text: privateText },
    {
      type: "tool.started",
      toolCall: { id: "tool-1", name: "get-import", status: "running" },
    },
    {
      type: "tool.updated",
      toolCall: { id: "tool-1", name: "get-import", status: "running" },
    },
    {
      type: "tool.delta",
      toolCallId: "tool-1",
      inputTextDelta: privateText,
    },
    {
      type: "activity.updated",
      activity: {
        kind: "tool",
        id: "activity-1",
        label: privateText,
        status: "running",
      },
    },
  ])("restores a conversation after redacting $type", async (payload) => {
    parseAgentEvent(event(payload, 2));
    const transport = transportFor([
      event({ type: "run.started" }),
      event(payload, 2),
      event({ type: "run.completed" }, 3),
    ]);
    try {
      const snapshot = await transport.getThreadSnapshot?.({ threadId });
      expect(snapshot?.messages).toMatchObject([
        {
          id: "user-message",
          role: "user",
          parts: [{ type: "text", text: prompt }],
        },
      ]);
      expect(snapshot?.events?.map(({ sequence }) => sequence)).toEqual([
        1, 2, 3,
      ]);
      expect(snapshot?.events?.[1]).toMatchObject({
        type: "x-agent-native.persisted-event-omission",
        sequence: 2,
      });
      expect(snapshot?.runs?.[0]?.status).toBe("completed");
      expect(JSON.stringify(snapshot)).not.toContain(privateText);
      expect(await transport.getThreadSnapshot?.({ threadId })).toEqual(
        snapshot,
      );
    } finally {
      await transport.dispose();
    }
  });

  it.each([
    event({ type: "message.created" }),
    event({
      type: "message.created",
      omitFromPersistedHistory: true,
      message: null,
    }),
    event({
      type: "message.delta",
      omitFromPersistedHistory: true,
      text: null,
    }),
    event({ type: "message.delta", omitFromPersistedHistory: true }),
    event({ type: "run.status", omitFromPersistedHistory: true }),
    event({
      type: "message.delta",
      messageId: assistant.id,
      omitFromPersistedHistory: true,
      format: "invalid",
    }),
    event({
      type: "client.effect",
      omitFromPersistedHistory: true,
      data: null,
    }),
    event({
      type: "message.created",
      omitFromPersistedHistory: true,
      message: { id: assistant.id },
    }),
    event({
      type: "message.created",
      omitFromPersistedHistory: true,
      sequence: "bad",
    }),
  ])(
    "rejects corrupt history without discarding its validation error, case %#",
    async (storedEvent) => {
      const transport = transportFor([storedEvent], false);
      try {
        await expect(
          transport.getThreadSnapshot?.({ threadId }),
        ).rejects.toMatchObject({
          name: "AgentProtocolValidationError",
        });
      } finally {
        await transport.dispose();
      }
    },
  );
});
