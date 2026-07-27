// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
  hasRecentAnalyticsChat,
  markAnalyticsChatActivity,
} from "./chat-handoff";

describe("analytics chat handoff recency", () => {
  afterEach(() => {
    window.sessionStorage.clear();
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
