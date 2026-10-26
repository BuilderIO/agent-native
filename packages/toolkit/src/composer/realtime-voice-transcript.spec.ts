import { describe, expect, it, vi } from "vitest";

import {
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

  it("streams updates for one id until the final transcript lands", () => {
    const registry = createRealtimeVoiceTranscriptRegistry();
    const append = vi.fn(() => true);
    registry.register({ threadId: "thread-1", active: true, append });

    registry.publish(transcript({ text: "Open", status: "streaming" }));
    registry.publish(transcript({ text: "Open sour", status: "streaming" }));
    registry.publish(transcript({ text: "Open sources" }));
    registry.publish(
      transcript({ text: "Open sources late", status: "streaming" }),
    );

    expect(append.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({ text: "Open", status: "streaming" }),
      expect.objectContaining({ text: "Open sour", status: "streaming" }),
      expect.objectContaining({ text: "Open sources", status: "complete" }),
    ]);
  });

  it("keeps only the newest queued text while the sink defers", () => {
    const registry = createRealtimeVoiceTranscriptRegistry();
    registry.register({
      threadId: "thread-1",
      active: true,
      append: () => false,
    });
    registry.publish(transcript({ text: "Open", status: "streaming" }));
    registry.publish(transcript({ text: "Open sources", status: "streaming" }));
    expect(registry.pendingCount()).toBe(1);

    const append = vi.fn(() => true);
    registry.register({ threadId: "thread-1", active: true, append });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Open sources", status: "streaming" }),
    );
  });

  it("asks a sink whether it is on screen when picking the active thread", () => {
    const registry = createRealtimeVoiceTranscriptRegistry();
    let visible = false;
    registry.register({
      threadId: "thread-1",
      active: () => visible,
      append: () => true,
    });
    expect(registry.activeThreadId()).toBeUndefined();
    visible = true;
    expect(registry.activeThreadId()).toBe("thread-1");
  });

  it("queues a tool call until its thread's sink takes it, finished over running", () => {
    const registry = createRealtimeVoiceTranscriptRegistry();
    const call = {
      id: "call-1",
      threadId: "thread-1",
      name: "web-search",
      startedAt: "2026-07-10T20:00:00.000Z",
    };
    registry.publishWork({ ...call, status: "running" });
    registry.publishWork({
      ...call,
      status: "completed",
      completedAt: "2026-07-10T20:00:02.000Z",
    });
    registry.publishWork({ ...call, status: "running" });
    expect(registry.pendingCount()).toBe(1);

    const appendWork = vi.fn(() => true);
    registry.register({
      threadId: "thread-1",
      active: true,
      append: vi.fn(() => true),
      appendWork,
    });
    expect(appendWork).toHaveBeenCalledOnce();
    expect(appendWork).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" }),
    );
    expect(registry.pendingCount()).toBe(0);
  });
});
