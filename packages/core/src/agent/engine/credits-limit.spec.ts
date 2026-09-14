import { describe, expect, it } from "vitest";

import {
  CREDITS_LIMIT_DAILY_MESSAGE,
  CREDITS_LIMIT_GENERIC_MESSAGE,
  CREDITS_LIMIT_MONTHLY_MESSAGE,
  creditsLimitWindowFromCode,
  formatCreditsLimitMessage,
  isCreditsLimitCode,
  normalizeAgentCreditsTerminology,
  parseCreditsLimitInfo,
} from "./credits-limit.js";

describe("parseCreditsLimitInfo", () => {
  it("reads the window from usageInfo ahead of the code", () => {
    const info = parseCreditsLimitInfo(
      { usageInfo: { plan: "free", limitExceeded: "monthly" } },
      "credits-limit-reached",
    );
    expect(info.window).toBe("monthly");
    expect(info.plan).toBe("free");
  });

  it("falls back to the error code when usageInfo is absent", () => {
    expect(parseCreditsLimitInfo({}, "credits-limit-daily").window).toBe(
      "daily",
    );
    expect(
      parseCreditsLimitInfo(undefined, "credits-limit-reached").window,
    ).toBe("unknown");
  });

  // A zero here would be rendered as "your plan includes 0 credits", which is a
  // different (and wrong) claim from "the gateway did not say".
  it("treats a missing or zero count as absent, never as a real number", () => {
    const info = parseCreditsLimitInfo(
      { usageInfo: { limit: 0, used: null } },
      "credits-limit-daily",
    );
    expect(info.limit).toBeUndefined();
    expect(info.used).toBeUndefined();
  });

  it("carries the retry window through as the reset hint", () => {
    const info = parseCreditsLimitInfo({}, "credits-limit-daily", 3 * 3600_000);
    expect(info.resetsInMs).toBe(3 * 3600_000);
  });
});

describe("formatCreditsLimitMessage", () => {
  it("names the exceeded window and its reset when the gateway sends no counts", () => {
    expect(formatCreditsLimitMessage({ window: "daily" })).toBe(
      CREDITS_LIMIT_DAILY_MESSAGE,
    );
    expect(formatCreditsLimitMessage({ window: "monthly" })).toBe(
      CREDITS_LIMIT_MONTHLY_MESSAGE,
    );
    expect(formatCreditsLimitMessage({ window: "unknown" })).toBe(
      CREDITS_LIMIT_GENERIC_MESSAGE,
    );
  });

  it("states the allowance and the plan once the gateway reports them", () => {
    expect(
      formatCreditsLimitMessage({ window: "daily", plan: "free", limit: 25 }),
    ).toBe(
      "You've used all 25 daily Agent Credits included with the Free plan. Daily credits reset at midnight UTC.",
    );
  });

  it("reports partial consumption when used is below the limit", () => {
    expect(
      formatCreditsLimitMessage({ window: "monthly", limit: 500, used: 480 }),
    ).toBe(
      "You've used 480 of 500 monthly Agent Credits included with your current plan. Monthly credits reset on the first of the month.",
    );
  });

  it("prefers a concrete reset window over the generic policy sentence", () => {
    expect(
      formatCreditsLimitMessage({ window: "daily", resetsInMs: 2 * 3600_000 }),
    ).toBe(
      "You've reached the daily Agent Credits limit for your current plan. They reset in about 2 hours.",
    );
  });

  it("never says AI credits", () => {
    const messages = [
      formatCreditsLimitMessage({ window: "daily" }),
      formatCreditsLimitMessage({ window: "monthly" }),
      formatCreditsLimitMessage({ window: "unknown" }),
      formatCreditsLimitMessage({ window: "daily", plan: "pro", limit: 500 }),
    ];
    for (const message of messages) {
      expect(message).not.toMatch(/AI credits/i);
      expect(message).toContain("Agent Credits");
    }
  });
});

describe("normalizeAgentCreditsTerminology", () => {
  it("rewrites the gateway's wording to Builder.io's product name", () => {
    expect(
      normalizeAgentCreditsTerminology(
        "You've reached the daily AI credits limit for your current plan.",
      ),
    ).toBe(
      "You've reached the daily Agent Credits limit for your current plan.",
    );
    expect(
      normalizeAgentCreditsTerminology("You have used all AI Credits."),
    ).toBe("You have used all Agent Credits.");
    expect(normalizeAgentCreditsTerminology("1 AI credit remaining")).toBe(
      "1 Agent Credit remaining",
    );
  });

  it("leaves unrelated prose alone", () => {
    const text = "The AI provider temporarily refused this request.";
    expect(normalizeAgentCreditsTerminology(text)).toBe(text);
  });
});

describe("code helpers", () => {
  it("recognizes every credits-limit variant", () => {
    expect(isCreditsLimitCode("credits-limit-daily")).toBe(true);
    expect(isCreditsLimitCode("credits-limit-monthly")).toBe(true);
    expect(isCreditsLimitCode("credits-limit-reached")).toBe(true);
    expect(isCreditsLimitCode("rate_limit_exceeded")).toBe(false);
    expect(isCreditsLimitCode(undefined)).toBe(false);
  });

  it("maps codes to their window", () => {
    expect(creditsLimitWindowFromCode("credits-limit-daily")).toBe("daily");
    expect(creditsLimitWindowFromCode("credits-limit-monthly")).toBe("monthly");
    expect(creditsLimitWindowFromCode("credits-limit-reached")).toBe("unknown");
  });
});
