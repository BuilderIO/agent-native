import { describe, it, expect, vi } from "vitest";
import {
  getChatThreadsEmitter,
  emitChatThreadChange,
  type ChatThreadEvent,
} from "./emitter.js";

describe("getChatThreadsEmitter", () => {
  it("returns a singleton EventEmitter", () => {
    const a = getChatThreadsEmitter();
    const b = getChatThreadsEmitter();
    expect(a).toBe(b);
  });
});

describe("emitChatThreadChange", () => {
  it("emits a chat-threads change event", () => {
    const emitter = getChatThreadsEmitter();
    const handler = vi.fn();
    emitter.on("chat-threads", handler);

    emitChatThreadChange("thread-123");

    expect(handler).toHaveBeenCalledOnce();
    const event: ChatThreadEvent = handler.mock.calls[0][0];
    expect(event.source).toBe("chat-threads");
    expect(event.type).toBe("change");
    expect(event.key).toBe("thread-123");

    emitter.removeListener("chat-threads", handler);
  });

  it("emits with correct thread ID each time", () => {
    const emitter = getChatThreadsEmitter();
    const handler = vi.fn();
    emitter.on("chat-threads", handler);

    emitChatThreadChange("a");
    emitChatThreadChange("b");

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0].key).toBe("a");
    expect(handler.mock.calls[1][0].key).toBe("b");

    emitter.removeListener("chat-threads", handler);
  });
});
