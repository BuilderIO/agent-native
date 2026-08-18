import { describe, expect, it, vi } from "vitest";

import {
  appendRealtimeVoiceTranscriptToRepository,
  createRealtimeVoiceTranscriptRegistry,
  type RealtimeVoiceTranscriptMessage,
} from "./realtime-voice-transcript.js";

function transcript(
  overrides: Partial<RealtimeVoiceTranscriptMessage> = {},
): RealtimeVoiceTranscriptMessage {
  return {
    id: "voice-1",
    threadId: "thread-1",
    role: "user",
    text: "Open sources",
    createdAt: "2026-07-10T20:00:00.000Z",
    ...overrides,
  };
}

describe("realtime voice transcript registry", () => {
  it("captures the latest active thread and buffers until its sink mounts", () => {
    const registry = createRealtimeVoiceTranscriptRegistry();
    registry.register({
      threadId: "thread-old",
      active: true,
      append: vi.fn(() => true),
    });
    registry.register({
      threadId: "thread-1",
      active: true,
      // Simulate the chat surface being selected but not yet ready to apply
      // the completed transcript. The registry must retain it for the sink
      // that mounts once the surface is ready.
      append: vi.fn(() => false),
    });
    expect(registry.activeThreadId()).toBe("thread-1");

    registry.publish(transcript());
    expect(registry.pendingCount()).toBe(1);
    const append = vi.fn(() => true);
    registry.register({ threadId: "thread-1", active: false, append });
    expect(append).toHaveBeenCalledOnce();
    expect(registry.pendingCount()).toBe(0);
  });

  it("deduplicates completed provider transcript events", () => {
    const registry = createRealtimeVoiceTranscriptRegistry();
    const append = vi.fn(() => true);
    registry.register({ threadId: "thread-1", active: true, append });
    registry.publish(transcript());
    registry.publish(transcript());
    expect(append).toHaveBeenCalledOnce();
  });
});

describe("appendRealtimeVoiceTranscriptToRepository", () => {
  it("links completed user and assistant messages without starting a run", () => {
    const first = appendRealtimeVoiceTranscriptToRepository({}, transcript());
    const second = appendRealtimeVoiceTranscriptToRepository(
      first.repository,
      transcript({
        id: "voice-2",
        role: "assistant",
        text: "Opening Sources.",
      }),
    );
    expect(second.repository.headId).toBe("voice-2");
    expect(second.repository.messages).toMatchObject([
      {
        parentId: null,
        message: {
          id: "voice-1",
          role: "user",
          metadata: { custom: { source: "realtime-voice" } },
        },
      },
      {
        parentId: "voice-1",
        message: {
          id: "voice-2",
          role: "assistant",
          status: { type: "complete", reason: "stop" },
        },
      },
    ]);
    expect(
      appendRealtimeVoiceTranscriptToRepository(
        second.repository,
        transcript({ id: "voice-2" }),
      ).appended,
    ).toBe(false);
  });
});
