import { describe, expect, it } from "vitest";

import {
  CREDITS_LIMIT_DAILY_MESSAGE,
  CREDITS_LIMIT_GENERIC_MESSAGE,
  CREDITS_LIMIT_MONTHLY_MESSAGE,
  creditsLimitWindowFromCode,
  formatCreditsLimitMessage,
  normalizeAgentCreditsTerminology,
  parseCreditsLimitInfo,
} from "./credits-limit.js";
import { isCreditsLimitErrorCode } from "./error-detail.js";

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

  // A zero allowance would be rendered as "your plan includes 0 credits", which
  // is a different (and wrong) claim from "the gateway did not say".
  it("treats a missing or zero allowance as absent, never as a real number", () => {
    const info = parseCreditsLimitInfo(
      { usageInfo: { limit: 0, used: null } },
      "credits-limit-daily",
    );
    expect(info.limit).toBeUndefined();
    expect(info.used).toBeUndefined();
  });

  // A zero consumed count is real, unlike a zero allowance: dropping it falls
  // through to the "used all" wording, which reports the opposite.
  it("keeps a zero consumed count", () => {
    const info = parseCreditsLimitInfo(
      { usageInfo: { limit: 25, used: 0 } },
      "credits-limit-daily",
    );
    expect(info.used).toBe(0);
    expect(formatCreditsLimitMessage(info)).toBe(
      "You've used 0 of 25 daily Agent Credits included with your current plan.",
    );
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
      "You've used all 25 daily Agent Credits included with the Free plan.",
    );
  });

  it("reports partial consumption when used is below the limit", () => {
    expect(
      formatCreditsLimitMessage({ window: "monthly", limit: 500, used: 480 }),
    ).toBe(
      "You've used 480 of 500 monthly Agent Credits included with your current plan.",
    );
  });

  // Builder.io resets free credits at 12 AM PST and paid monthly credits on the
  // subscription's billing date, so no schedule is safe to state without the
  // reader's plan. Only a measured Retry-After is a fact this module owns.
  it("never invents a reset schedule the reader's plan may not follow", () => {
    const unmeasured = [
      formatCreditsLimitMessage({ window: "daily" }),
      formatCreditsLimitMessage({ window: "monthly" }),
      formatCreditsLimitMessage({ window: "daily", plan: "free", limit: 25 }),
    ];
    for (const message of unmeasured) {
      expect(message).not.toMatch(/midnight|UTC|first of the month/i);
      expect(message).not.toMatch(/reset/i);
    }
  });

  it("states the reset only when Retry-After measured it", () => {
    expect(
      formatCreditsLimitMessage({ window: "daily", resetsInMs: 2 * 3600_000 }),
    ).toBe(
      "You've reached the daily Agent Credits limit for your current plan. They reset in about 2 hours.",
    );
    // A 90-minute wait rounded to "2 hours" overstates it by a third.
    expect(
      formatCreditsLimitMessage({ window: "daily", resetsInMs: 90 * 60_000 }),
    ).toContain("about 90 minutes");
  });

  // Replacing a specific gateway sentence with a generic one deletes
  // information the reader had before this function existed.
  it("keeps the gateway sentence when it cannot say anything more specific", () => {
    expect(
      formatCreditsLimitMessage(
        { window: "unknown" },
        "You have used all AI credits for this month",
      ),
    ).toBe("You have used all Agent Credits for this month.");
  });

  it("appends a known reset to the carried gateway sentence", () => {
    expect(
      formatCreditsLimitMessage(
        { window: "unknown", resetsInMs: 3 * 3600_000 },
        "You have used all AI credits for this month",
      ),
    ).toBe(
      "You have used all Agent Credits for this month. They reset in about 3 hours.",
    );
  });

  it("falls back to the generic line when the gateway sent no sentence", () => {
    expect(formatCreditsLimitMessage({ window: "unknown" }, "   ")).toBe(
      CREDITS_LIMIT_GENERIC_MESSAGE,
    );
  });

  it("renders a multi-hour reset as hours, not the retry cap", () => {
    expect(
      formatCreditsLimitMessage({ window: "daily", resetsInMs: 7 * 3600_000 }),
    ).toContain("about 7 hours");
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
    expect(isCreditsLimitErrorCode("credits-limit-daily")).toBe(true);
    expect(isCreditsLimitErrorCode("credits-limit-monthly")).toBe(true);
    expect(isCreditsLimitErrorCode("credits-limit-reached")).toBe(true);
    expect(isCreditsLimitErrorCode("rate_limit_exceeded")).toBe(false);
    expect(isCreditsLimitErrorCode(undefined)).toBe(false);
  });

  // The server treats a bare 402 as quota too, so the client must agree or the
  // rejection that explains itself least is the one that loses the docs CTA.
  it("matches the bare 402 the server also treats as quota", () => {
    expect(isCreditsLimitErrorCode("http_402")).toBe(true);
    expect(isCreditsLimitErrorCode("http_403")).toBe(false);
  });

  it("maps codes to their window", () => {
    expect(creditsLimitWindowFromCode("credits-limit-daily")).toBe("daily");
    expect(creditsLimitWindowFromCode("credits-limit-monthly")).toBe("monthly");
    expect(creditsLimitWindowFromCode("credits-limit-reached")).toBe("unknown");
  });
});
