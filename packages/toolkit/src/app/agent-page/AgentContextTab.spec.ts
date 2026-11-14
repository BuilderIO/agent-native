import type { ChatThreadSummary } from "@agent-native/core/client/agent-chat";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AgentContextTab,
  mostRecentlyUpdatedThread,
} from "./AgentContextTab.js";

const hooks = vi.hoisted(() => ({
  threads: vi.fn(),
  query: vi.fn((..._args: unknown[]) => ({})),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useChatThreads: hooks.threads,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: hooks.query,
}));
vi.mock("../context-xray/index.js", () => ({
  ContextMeter: () => null,
  ContextTreemap: () => null,
}));

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

  it("requests only owned lifecycle summaries before choosing the latest snapshot", () => {
    hooks.threads.mockReturnValue({
      threads: [thread("old-pinned", 100, 500), thread("newest", 300)],
    });
    hooks.query.mockClear();
    renderToStaticMarkup(createElement(AgentContextTab, { scope: "user" }));

    expect(hooks.threads).toHaveBeenCalledWith(
      undefined,
      "agent-context-page",
      null,
      {
        autoCreate: false,
        restoreActiveThread: false,
        ownership: "mine",
      },
    );
    expect(hooks.query.mock.calls).toEqual([
      ["context-preview-get", { scope: "user" }, { staleTime: 5_000 }],
      [
        "context-manifest-get",
        { threadId: "newest" },
        { enabled: true, staleTime: 1_000 },
      ],
    ]);
  });
});
