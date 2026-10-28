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
  const untitled = {
    title: "Untitled recording",
    createdAt: "2026-10-28T12:04:30Z",
  };

  it("polls a recent default title until a generated title is visible", () => {
    expect(shouldPollGeneratedTitle(untitled, "ready", now)).toBe(true);
    expect(
      shouldPollGeneratedTitle(
        { ...untitled, title: "Generated title" },
        "ready",
        now,
      ),
    ).toBe(false);
  });

  it("bounds polling when refinement never completes and stops for failed transcripts", () => {
    expect(shouldPollGeneratedTitle(untitled, "ready", now + 120_000)).toBe(
      false,
    );
    expect(shouldPollGeneratedTitle(untitled, "failed", now)).toBe(false);
  });
});
