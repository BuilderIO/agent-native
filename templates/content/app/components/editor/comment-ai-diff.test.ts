import { describe, expect, it } from "vitest";

import { trimDiffContext, wordDiff } from "./comment-ai-diff";

describe("wordDiff", () => {
  it("marks whole words that were added and removed", () => {
    expect(
      wordDiff(
        "the contrast is a little soft.",
        "the contrast is soft in the recording.",
      ),
    ).toEqual([
      { kind: "same", text: "the contrast is " },
      { kind: "removed", text: "a little soft." },
      { kind: "added", text: "soft in the recording." },
    ]);
  });

  it("keeps unchanged words between separate changes", () => {
    expect(
      wordDiff(
        "hold the view briefly while the page settles",
        "hold this view longer while the page settles",
      ),
    ).toEqual([
      { kind: "same", text: "hold " },
      { kind: "removed", text: "the " },
      { kind: "added", text: "this " },
      { kind: "same", text: "view " },
      { kind: "removed", text: "briefly " },
      { kind: "added", text: "longer " },
      { kind: "same", text: "while the page settles" },
    ]);
  });

  it("reads a mostly rewritten line as the old text struck and the new inserted", () => {
    expect(
      wordDiff(
        "It turns out that a lot of people in town had the same problem, and the response was much bigger than expected.",
        "Plenty of neighbors had the same problem, and the shelf grew.",
      ),
    ).toEqual([
      {
        kind: "removed",
        text: "It turns out that a lot of people in town had the same problem, and the response was much bigger than expected.",
      },
      {
        kind: "added",
        text: "Plenty of neighbors had the same problem, and the shelf grew.",
      },
    ]);
    expect(wordDiff("hold the view briefly", "hold this view longer")).toEqual([
      { kind: "same", text: "hold " },
      { kind: "removed", text: "the view briefly" },
      { kind: "added", text: "this view longer" },
    ]);
  });

  it("reads a busy rewrite as one old phrase and one new phrase", () => {
    expect(
      wordDiff(
        "could make those details harder to distinguish, especially on smaller screens or in playback.",
        "could make those details, like status labels, harder to distinguish on phones, laptops, or in playback.",
      ),
    ).toEqual([
      { kind: "same", text: "could make those " },
      {
        kind: "removed",
        text: "details harder to distinguish, especially on smaller screens ",
      },
      {
        kind: "added",
        text: "details, like status labels, harder to distinguish on phones, laptops, ",
      },
      { kind: "same", text: "or in playback." },
    ]);
  });

  it("shows a pure insertion or deletion as one segment", () => {
    expect(wordDiff("Hold it.", "Hold it longer.")).toEqual([
      { kind: "same", text: "Hold " },
      { kind: "removed", text: "it." },
      { kind: "added", text: "it longer." },
    ]);
    expect(wordDiff("Keep this", "")).toEqual([
      { kind: "removed", text: "Keep this" },
    ]);
  });
});

describe("trimDiffContext", () => {
  it("shortens long unchanged ends on word boundaries", () => {
    const trimmed = trimDiffContext(
      [
        { kind: "same", text: "one two three four five six seven eight " },
        { kind: "added", text: "nine " },
        { kind: "same", text: "ten eleven twelve thirteen fourteen fifteen" },
      ],
      20,
    );
    expect(trimmed[0]).toEqual({ kind: "same", text: "…six seven eight " });
    expect(trimmed[2]).toEqual({ kind: "same", text: "ten eleven twelve…" });
  });
});
