// @vitest-environment happy-dom

import {
  consumeAgentChatHomeHandoff,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client/agent-chat";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_CHAT_STORAGE_KEY,
  ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
  type AnalyticsChatRunningRuns,
  discardAnalyticsChatHandoffOnSettings,
  hasTrackedAnalyticsChatRun,
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
    const runningRuns: AnalyticsChatRunningRuns = new Map();

    updateAnalyticsChatHandoffForRun(
      runningRuns,
      {
        isRunning: true,
        tabId: "chat-1",
        runId: "run-1",
      },
      "/ask",
    );
    vi.setSystemTime(1_000 + ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS + 1);
    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(false);

    updateAnalyticsChatHandoffForRun(
      runningRuns,
      {
        isRunning: false,
        tabId: "chat-1",
        runId: "run-1",
      },
      "/ask",
    );

    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(true);
  });

  it("does not create a handoff for an unrelated run completion", () => {
    updateAnalyticsChatHandoffForRun(
      new Map(),
      {
        isRunning: false,
        tabId: "chat-1",
      },
      "/ask",
    );

    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(false);
  });

  it("retires a tracked run completed after leaving Ask without refreshing it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const runningRuns: AnalyticsChatRunningRuns = new Map();
    updateAnalyticsChatHandoffForRun(
      runningRuns,
      { isRunning: true, tabId: "chat-1", runId: "run-1" },
      "/ask",
    );
    vi.setSystemTime(1_000 + ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS + 1);
    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(false);

    updateAnalyticsChatHandoffForRun(
      runningRuns,
      { isRunning: false, tabId: "chat-1", runId: "run-1" },
      "/dashboards/revenue",
    );

    expect(runningRuns.has("chat-1")).toBe(false);
    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(false);
  });

  it("keeps the successor turn tracked through same-tab completion events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const runningRuns: AnalyticsChatRunningRuns = new Map();

    updateAnalyticsChatHandoffForRun(
      runningRuns,
      { isRunning: true, tabId: "chat-1", turnId: "turn-a" },
      "/ask",
    );
    vi.setSystemTime(1_000 + ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS + 1);
    updateAnalyticsChatHandoffForRun(
      runningRuns,
      { isRunning: true, tabId: "chat-1", turnId: "turn-b" },
      "/ask",
    );
    vi.setSystemTime(1_001 + ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS + 1);

    updateAnalyticsChatHandoffForRun(
      runningRuns,
      { isRunning: false, tabId: "chat-1", turnId: "turn-a" },
      "/ask",
    );
    updateAnalyticsChatHandoffForRun(
      runningRuns,
      { isRunning: false, tabId: "chat-1" },
      "/ask",
    );

    vi.setSystemTime(1_002 + 2 * ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS + 1);
    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(false);
    expect(runningRuns.get("chat-1")?.has("turn-b")).toBe(true);

    updateAnalyticsChatHandoffForRun(
      runningRuns,
      { isRunning: false, tabId: "chat-1", turnId: "turn-b" },
      "/ask",
    );

    expect(
      consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
        ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
      }),
    ).toBe(true);
    expect(runningRuns.has("chat-1")).toBe(false);
  });

  it("tracks only handoffs for runs with an identity", () => {
    const runningRuns: AnalyticsChatRunningRuns = new Map();
    updateAnalyticsChatHandoffForRun(
      runningRuns,
      { isRunning: true, tabId: "chat-1" },
      "/ask",
    );
    expect(hasTrackedAnalyticsChatRun(runningRuns)).toBe(false);

    updateAnalyticsChatHandoffForRun(
      runningRuns,
      { isRunning: true, tabId: "chat-1", turnId: "turn-a" },
      "/ask",
    );
    expect(hasTrackedAnalyticsChatRun(runningRuns)).toBe(true);
  });
});
