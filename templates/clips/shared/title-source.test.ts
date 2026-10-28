import { describe, expect, it } from "vitest";

import {
  isAutoTitleReplaceable,
  shouldPollGeneratedTitle,
} from "./title-source";

it("preserves a manually chosen default title for automatic work", () => {
  expect(isAutoTitleReplaceable("Untitled recording", "manual")).toBe(false);
  expect(isAutoTitleReplaceable("Untitled recording", "default")).toBe(true);
});

describe("title refinement polling", () => {
  const now = Date.parse("2026-10-28T12:05:00Z");
  const provisional = {
    title: "A provisional title",
    titleSource: "context",
    createdAt: "2026-10-28T12:00:00Z",
    updatedAt: "2026-10-28T12:04:30Z",
  };

  it("continues polling after a provisional title arrives, until refinement is visible", () => {
    expect(shouldPollGeneratedTitle(provisional, "ready", now)).toBe(true);
    expect(
      shouldPollGeneratedTitle(
        { ...provisional, titleSource: "ai" },
        "ready",
        now,
      ),
    ).toBe(false);
  });

  it("bounds polling when refinement never completes and stops for failed transcripts", () => {
    expect(shouldPollGeneratedTitle(provisional, "ready", now + 120_000)).toBe(
      false,
    );
    expect(shouldPollGeneratedTitle(provisional, "failed", now)).toBe(false);
  });
});
