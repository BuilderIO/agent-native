// @vitest-environment happy-dom

import type { ChatThreadSummary } from "@agent-native/core/client/agent-chat";
import { describe, expect, it } from "vitest";

import {
  getStoredVisibilityFilter,
  matchesVisibilityFilter,
  setStoredVisibilityFilter,
  threadMatchesVisibilityFilter,
} from "./Sidebar";

function makeThread(
  overrides: Partial<ChatThreadSummary> & { visibility?: unknown } = {},
): ChatThreadSummary {
  return {
    id: "thread-1",
    title: "Thread",
    preview: "",
    messageCount: 1,
    createdAt: 1,
    updatedAt: 1,
    scope: null,
    source: null,
    pinnedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe("Sidebar visibility helpers", () => {
  it("defaults dashboard visibility to all when nothing is stored", () => {
    window.localStorage.removeItem("analytics-sidebar-dashboard-visibility");
    expect(
      getStoredVisibilityFilter("analytics-sidebar-dashboard-visibility"),
    ).toBe("all");
  });

  it("persists and restores dashboard visibility choices", () => {
    const key = "analytics-sidebar-dashboard-visibility";

    setStoredVisibilityFilter(key, "private");
    expect(window.localStorage.getItem(key)).toBe("private");
    expect(getStoredVisibilityFilter(key)).toBe("private");

    setStoredVisibilityFilter(key, "all");
    expect(window.localStorage.getItem(key)).toBe("all");
    expect(getStoredVisibilityFilter(key)).toBe("all");
  });

  it("treats private items as mine and org/public items as shared", () => {
    expect(matchesVisibilityFilter({ visibility: "private" }, "private")).toBe(
      true,
    );
    expect(matchesVisibilityFilter({ visibility: "org" }, "private")).toBe(
      false,
    );
    expect(matchesVisibilityFilter({ visibility: "public" }, "shared")).toBe(
      true,
    );
  });

  it("keeps another user's private dashboard out of Mine", () => {
    const dashboard = {
      visibility: "private" as const,
      ownerEmail: "owner@example.com",
    };

    expect(
      matchesVisibilityFilter(dashboard, "private", "viewer@example.com"),
    ).toBe(false);
    expect(
      matchesVisibilityFilter(dashboard, "shared", "viewer@example.com"),
    ).toBe(true);
    expect(
      matchesVisibilityFilter(dashboard, "private", "OWNER@example.com"),
    ).toBe(true);
    expect(
      matchesVisibilityFilter(
        { visibility: "private", ownerEmail: null },
        "private",
        "viewer@example.com",
      ),
    ).toBe(false);
  });

  it("keeps legacy private dashboards without ownership metadata in Mine", () => {
    expect(
      matchesVisibilityFilter(
        { visibility: "private" },
        "private",
        "viewer@example.com",
      ),
    ).toBe(true);
    expect(
      matchesVisibilityFilter(
        { visibility: "private" },
        "shared",
        "viewer@example.com",
      ),
    ).toBe(false);
  });

  it("defaults chats without runtime visibility metadata to mine", () => {
    expect(threadMatchesVisibilityFilter(makeThread(), "private")).toBe(true);
    expect(threadMatchesVisibilityFilter(makeThread(), "shared")).toBe(false);
  });

  it("reads runtime chat visibility when the server includes it", () => {
    expect(
      threadMatchesVisibilityFilter(
        makeThread({ visibility: "org" }),
        "shared",
      ),
    ).toBe(true);
    expect(
      threadMatchesVisibilityFilter(
        makeThread({ visibility: "org" }),
        "private",
      ),
    ).toBe(false);
  });
});
