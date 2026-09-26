// @vitest-environment happy-dom

import {
  consumeAgentChatHomeHandoff,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_CHAT_STORAGE_KEY,
  ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
  discardAnalyticsChatHandoffOnSettings,
  hasRecentAnalyticsChat,
  isAnalyticsSettingsPath,
  markAnalyticsChatActivity,
  updateAnalyticsChatHandoffForRun,
} from "./chat-handoff";

describe("analytics chat handoff recency", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  it("is false before any chat activity", () => {
    expect(hasRecentAnalyticsChat(1_000)).toBe(false);
  });

  it("keeps chat activity recent for the configured handoff window", () => {
    markAnalyticsChatActivity(1_000);

    expect(hasRecentAnalyticsChat(1_000 + 1)).toBe(true);
    expect(
      hasRecentAnalyticsChat(1_000 + ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS + 1),
    ).toBe(false);
  });
});

describe("analytics chat handoff destinations", () => {
  it.each(["/settings", "/settings/agent", "/settings/keys"])(
    "identifies %s as Settings",
    (pathname) => {
      expect(isAnalyticsSettingsPath(pathname)).toBe(true);
    },
  );

  it("allows non-Settings routes to receive a handoff", () => {
    expect(isAnalyticsSettingsPath("/dashboards/revenue")).toBe(false);
  });

  it("discards a pending handoff on Settings", () => {
    markAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY);

    discardAnalyticsChatHandoffOnSettings("/settings/agent");

    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(false);
  });

  it("preserves handoffs for other routes", () => {
    markAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY);

    discardAnalyticsChatHandoffOnSettings("/dashboards/revenue");

    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(true);
  });

  it("refreshes a long-running chat handoff after returning to Ask", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const runningTabs = new Set<string>();

    updateAnalyticsChatHandoffForRun(runningTabs, {
      isRunning: true,
      tabId: "chat-1",
    });
    vi.setSystemTime(1_000 + ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS + 1);
    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(false);

    updateAnalyticsChatHandoffForRun(runningTabs, {
      isRunning: false,
      tabId: "chat-1",
    });

    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(true);
  });

  it("does not create a handoff for an unrelated run completion", () => {
    updateAnalyticsChatHandoffForRun(new Set(), {
      isRunning: false,
      tabId: "chat-1",
    });

    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(false);
  });
});
