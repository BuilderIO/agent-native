import { describe, expect, it } from "vitest";

import type { ChatThreadSummary } from "../use-chat-threads.js";
import { mostRecentlyUpdatedThread } from "./AgentContextTab.js";

function thread(
  id: string,
  updatedAt: number,
  pinnedAt?: number,
): ChatThreadSummary {
  return {
    id,
    title: id,
    preview: "",
    messageCount: 1,
    createdAt: updatedAt,
    updatedAt,
    scope: null,
    ...(pinnedAt !== undefined ? { pinnedAt } : {}),
  };
}

describe("mostRecentlyUpdatedThread", () => {
  it("selects the newest update when pinned ordering puts an older thread first", () => {
    const oldPinned = thread("old-pinned", 100, 500);
    const newest = thread("newest", 300);
    const older = thread("older", 200);

    expect(mostRecentlyUpdatedThread([oldPinned, newest, older])).toBe(newest);
  });

  it("returns undefined when no threads exist", () => {
    expect(mostRecentlyUpdatedThread([])).toBeUndefined();
  });
});
