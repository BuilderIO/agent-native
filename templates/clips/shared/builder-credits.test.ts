import { describe, expect, it } from "vitest";

import {
  BUILDER_CREDITS_UPGRADE_URL,
  createBuilderCreditsExhaustedStatus,
  isBuilderCreditsExhaustedMessage,
  normalizeBuilderCreditsStatus,
} from "./builder-credits.js";

describe("builder credit status helpers", () => {
  it("detects Builder transcription and gateway credit-limit messages", () => {
    expect(
      isBuilderCreditsExhaustedMessage(
        "Builder transcription credits exhausted. Upgrade your Builder.io plan.",
      ),
    ).toBe(true);
    expect(
      isBuilderCreditsExhaustedMessage(
        "Builder gateway returned credits-limit-monthly",
      ),
    ).toBe(true);
    expect(
      isBuilderCreditsExhaustedMessage(
        "You have reached your monthly AI credits limit.",
      ),
    ).toBe(true);
  });

  // Core composes this copy with Builder.io's product name, and the numeric
  // variant carries none of the other phrases this matcher looks for.
  it("detects the Agent Credits wording core now emits", () => {
    expect(
      isBuilderCreditsExhaustedMessage(
        "You've reached the daily Agent Credits limit for your current plan. Daily credits reset at midnight UTC.",
      ),
    ).toBe(true);
    expect(
      isBuilderCreditsExhaustedMessage(
        "You've used all 25 daily Agent Credits included with the Free plan.",
      ),
    ).toBe(true);
  });

  it("does not treat unrelated provider quota errors as Builder credit limits", () => {
    expect(isBuilderCreditsExhaustedMessage("Groq quota exceeded")).toBe(false);
    expect(isBuilderCreditsExhaustedMessage("rate limit exceeded")).toBe(false);
    expect(isBuilderCreditsExhaustedMessage(null)).toBe(false);
  });

  it("normalizes missing state to a non-exhausted status", () => {
    expect(normalizeBuilderCreditsStatus(null)).toEqual({
      exhausted: false,
      upgradeUrl: BUILDER_CREDITS_UPGRADE_URL,
      features: ["backup-transcription", "cleanup", "summaries", "titles"],
    });
  });

  it("creates a stable exhausted status for UI and actions", () => {
    const status = createBuilderCreditsExhaustedStatus({
      source: "cleanup",
      message: "credits-limit-daily",
      now: "2026-06-28T12:00:00.000Z",
    });

    expect(normalizeBuilderCreditsStatus(status)).toEqual({
      exhausted: true,
      source: "cleanup",
      message: "credits-limit-daily",
      upgradeUrl: BUILDER_CREDITS_UPGRADE_URL,
      updatedAt: "2026-06-28T12:00:00.000Z",
      features: ["backup-transcription", "cleanup", "summaries", "titles"],
    });
  });
});
