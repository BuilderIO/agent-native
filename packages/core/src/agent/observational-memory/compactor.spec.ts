import { describe, it, expect, vi, beforeEach } from "vitest";

import type { EngineMessage } from "../engine/types.js";

const observerMod = vi.hoisted(() => ({ runObserver: vi.fn() }));
const reflectorMod = vi.hoisted(() => ({ runReflector: vi.fn() }));
const threadStoreMod = vi.hoisted(() => ({ getThread: vi.fn() }));
const threadBuilderMod = vi.hoisted(() => ({
  threadDataToEngineMessages: vi.fn(),
}));

vi.mock("./observer.js", () => observerMod);
vi.mock("./reflector.js", () => reflectorMod);
vi.mock("../../chat-threads/store.js", () => threadStoreMod);
vi.mock("../thread-data-builder.js", () => threadBuilderMod);

const { maybeCompactThread } = await import("./compactor.js");

beforeEach(() => {
  vi.clearAllMocks();
  observerMod.runObserver.mockResolvedValue({
    observed: false,
    unobservedTokens: 0,
  });
  reflectorMod.runReflector.mockResolvedValue({
    reflected: false,
    observationLogTokens: 0,
  });
});

describe("maybeCompactThread", () => {
  it("runs Observer then Reflector with the supplied messages", async () => {
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];

    const result = await maybeCompactThread({
      threadId: "t1",
      ownerEmail: "alice@example.com",
      messages,
    });

    expect(observerMod.runObserver).toHaveBeenCalledTimes(1);
    expect(observerMod.runObserver.mock.calls[0][0].messages).toBe(messages);
    expect(reflectorMod.runReflector).toHaveBeenCalledTimes(1);
    // Both threaded the same owner scope through.
    expect(observerMod.runObserver.mock.calls[0][0].ownerEmail).toBe(
      "alice@example.com",
    );
    expect(reflectorMod.runReflector.mock.calls[0][0].ownerEmail).toBe(
      "alice@example.com",
    );
    expect(result.observer.observed).toBe(false);
    expect(result.reflector.reflected).toBe(false);
    // No thread load needed when messages are supplied.
    expect(threadStoreMod.getThread).not.toHaveBeenCalled();
  });

  it("loads thread messages from the store when none are supplied", async () => {
    threadStoreMod.getThread.mockResolvedValue({
      threadData: '{"messages":[]}',
    });
    const loaded: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "loaded" }] },
    ];
    threadBuilderMod.threadDataToEngineMessages.mockReturnValue(loaded);

    await maybeCompactThread({
      threadId: "t1",
      ownerEmail: "alice@example.com",
    });

    expect(threadStoreMod.getThread).toHaveBeenCalledWith("t1");
    expect(threadBuilderMod.threadDataToEngineMessages).toHaveBeenCalledWith(
      '{"messages":[]}',
    );
    expect(observerMod.runObserver.mock.calls[0][0].messages).toBe(loaded);
  });
});
