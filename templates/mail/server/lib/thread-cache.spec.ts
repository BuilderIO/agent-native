import { beforeEach, describe, expect, it } from "vitest";

import {
  invalidateThreadCache,
  threadCacheKey,
  threadMessagesCache,
} from "./thread-cache.js";

describe("thread message cache mailbox scope", () => {
  beforeEach(() => threadMessagesCache.clear());

  it("keeps same-owner thread IDs separate by mailbox and invalidates the matching key", () => {
    const firstKey = threadCacheKey(
      "owner@example.test",
      "shared-thread",
      "first@example.test",
    );
    const secondKey = threadCacheKey(
      "owner@example.test",
      "shared-thread",
      "second@example.test",
    );

    threadMessagesCache.set(firstKey, {
      messages: [{ id: "first-message" } as never],
      expiresAt: Date.now() + 60_000,
    });
    threadMessagesCache.set(secondKey, {
      messages: [{ id: "second-message" } as never],
      expiresAt: Date.now() + 60_000,
    });

    expect(firstKey).not.toBe(secondKey);
    invalidateThreadCache(
      "owner@example.test",
      "shared-thread",
      "FIRST@example.test",
    );
    expect(threadMessagesCache.has(firstKey)).toBe(false);
    expect(threadMessagesCache.has(secondKey)).toBe(true);

    invalidateThreadCache("owner@example.test", "shared-thread");
    expect(threadMessagesCache.size).toBe(0);
  });
});
