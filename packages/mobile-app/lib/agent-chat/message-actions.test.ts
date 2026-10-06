import type { AgentKitController } from "@agent-native/agentkit";
import type { AgentMessage } from "@agent-native/agentkit/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  forkAndResubmitMobileMessage,
  submitMobileMessageFeedback,
} from "./message-actions";

describe("mobile AgentKit message actions", () => {
  it("forks before the selected user message and resubmits its prompt and files", async () => {
    const messages: AgentMessage[] = [
      {
        id: "earlier",
        role: "assistant",
        parts: [{ type: "text", text: "Earlier" }],
      },
      {
        id: "user-1",
        role: "user",
        parts: [
          { type: "text", text: "Original prompt" },
          {
            type: "file",
            name: "reference.png",
            mediaType: "image/png",
            url: "https://example.test/reference.png",
          },
        ],
        metadata: { model: "model-a", requestMode: "plan" },
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Response" }],
      },
    ];
    const forkedThread = { id: "fork-1" };
    const client = {
      loadThread: vi.fn(async () => ({ messages }) as never),
      forkThread: vi.fn(async () => forkedThread as never),
      sendMessage: vi.fn(async () => ({ runId: "run-2" }) as never),
    } as unknown as AgentKitController;

    await expect(
      forkAndResubmitMobileMessage(
        client,
        "thread-1",
        "user-1",
        "Edited prompt",
      ),
    ).resolves.toEqual(forkedThread);

    expect(client.forkThread).toHaveBeenCalledWith("thread-1", "earlier");
    expect(client.sendMessage).toHaveBeenCalledWith({
      threadId: "fork-1",
      text: "Edited prompt",
      attachments: [messages[1]!.parts[1]],
      options: {
        model: "model-a",
        mode: "plan",
        metadata: messages[1]!.metadata,
      },
      metadata: messages[1]!.metadata,
    });
  });

  it("regenerates an assistant reply from its preceding user message", async () => {
    const messages: AgentMessage[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Question" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Answer" }],
      },
    ];
    const client = {
      loadThread: vi.fn(async () => ({ messages }) as never),
      forkThread: vi.fn(async () => ({ id: "fork-2" }) as never),
      sendMessage: vi.fn(async () => ({ runId: "run-3" }) as never),
    } as unknown as AgentKitController;

    await forkAndResubmitMobileMessage(client, "thread-1", "assistant-1");

    expect(client.forkThread).toHaveBeenCalledWith("thread-1", undefined);
    expect(client.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "fork-2", text: "Question" }),
    );
  });

  it("submits feedback with the transcript sequence and run trace", async () => {
    const submitFeedback = vi.fn(async () => undefined);
    const client = {
      getThread: () => ({
        messages: [
          { id: "user-1", role: "user", parts: [] },
          { id: "assistant-1", role: "assistant", parts: [] },
        ],
        events: [
          {
            id: "event-1",
            threadId: "thread-1",
            runId: "run-1",
            sequence: 1,
            occurredAt: "2026-09-26T00:00:00.000Z",
            type: "message.delta",
            messageId: "assistant-1",
            text: "Answer",
          },
        ],
      }),
      submitFeedback,
    } as unknown as AgentKitController;

    await submitMobileMessageFeedback(
      client,
      "thread-1",
      "assistant-1",
      "positive",
    );

    expect(submitFeedback).toHaveBeenCalledWith(
      "thread-1",
      "assistant-1",
      "positive",
      {
        runId: "run-1",
        messageSeq: 1,
      },
    );
  });
});
