import { describe, expect, it } from "vitest";

import { trimDiffContext, wordDiff } from "./comment-ai-diff";

describe("wordDiff", () => {
  it.each([
    ["the cat sat", "the cat"],
    ["the cat", "the cat sat"],
    ["one two three", "one three"],
    ["one two  three", "one two three"],
    ["keep this. drop it", "keep this. and add"],
    ["Charred leeks.", "Charred leeks (N)."],
    ["details harder", "details, like status labels, harder"],
    ["Hello\nWorld", "Hello!\nWorld"],
  ])("rebuilds both sides of %j and %j exactly", (before, after) => {
    const side = (kind: "removed" | "added") =>
      wordDiff(before, after)
        .filter((segment) => segment.kind === "same" || segment.kind === kind)
        .map(({ text }) => text)
        .join("");
    expect(side("removed")).toBe(before);
    expect(side("added")).toBe(after);
  });

  it("marks whole words that were added and removed", () => {
    expect(
      wordDiff(
        "the contrast is a little soft.",
        "the contrast is soft in the recording.",
      ),
    ).toEqual([
      { kind: "same", text: "the contrast is " },
      { kind: "removed", text: "a little soft" },
      { kind: "added", text: "soft in the recording" },
      { kind: "same", text: "." },
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
        text: "It turns out that a lot of people in town had the same problem, and the response was much bigger than expected",
      },
      {
        kind: "added",
        text: "Plenty of neighbors had the same problem, and the shelf grew",
      },
      { kind: "same", text: "." },
    ]);
    expect(wordDiff("hold the view briefly", "hold this view longer")).toEqual([
      { kind: "same", text: "hold " },
      { kind: "removed", text: "the view briefly" },
      { kind: "added", text: "this view longer" },
    ]);
  });

  it("decides paragraph by paragraph, as the page does", () => {
    const kept =
      "Stable context unchanged for many words in a separate paragraph.";
    expect(
      wordDiff(
        `It turns out that a lot of people in town had the same problem, and the response was much bigger than expected.\n\n${kept}\n\nThe red bird sang.`,
        `Plenty of neighbors had the same problem, and the shelf grew.\n\n${kept}\n\nThe blue bird sang.`,
      ),
    ).toEqual([
      {
        kind: "removed",
        text: "It turns out that a lot of people in town had the same problem, and the response was much bigger than expected",
      },
      {
        kind: "added",
        text: "Plenty of neighbors had the same problem, and the shelf grew",
      },
      { kind: "same", text: `.\n\n${kept}\n\nThe ` },
      { kind: "removed", text: "red " },
      { kind: "added", text: "blue " },
      { kind: "same", text: "bird sang." },
    ]);
  });

  it("reads a busy rewrite as one old phrase and one new phrase", () => {
    expect(
      wordDiff(
        "could make those details harder to distinguish, especially on smaller screens or in playback.",
        "could make these details hard to distinguish, mostly on smaller phones or in playback.",
      ),
    ).toEqual([
      { kind: "same", text: "could make " },
      {
        kind: "removed",
        text: "those details harder to distinguish, especially on smaller screens ",
      },
      {
        kind: "added",
        text: "these details hard to distinguish, mostly on smaller phones ",
      },
      { kind: "same", text: "or in playback." },
    ]);
  });

  it("shows a pure insertion or deletion as one segment", () => {
    expect(wordDiff("Hold it.", "Hold it longer.")).toEqual([
      { kind: "same", text: "Hold it" },
      { kind: "added", text: " longer" },
      { kind: "same", text: "." },
    ]);
    expect(wordDiff("Hold it longer.", "Hold it.")).toEqual([
      { kind: "same", text: "Hold it" },
      { kind: "removed", text: " longer" },
      { kind: "same", text: "." },
    ]);
    expect(wordDiff("Keep this", "")).toEqual([
      { kind: "removed", text: "Keep this" },
    ]);
  });

  it("shows text added before a period as an insertion, not a renamed word", () => {
    expect(
      wordDiff(
        "Charred leeks. Almond and roasted red pepper romesco.",
        "Charred leeks (N). Almond and roasted red pepper romesco.",
      ),
    ).toEqual([
      { kind: "same", text: "Charred leeks" },
      { kind: "added", text: " (N)" },
      { kind: "same", text: ". Almond and roasted red pepper romesco." },
    ]);
  });

  it("leaves the punctuation around a replaced word unchanged", () => {
    expect(wordDiff("Served with hazelnut.", "Served with sunflower.")).toEqual(
      [
        { kind: "same", text: "Served with " },
        { kind: "removed", text: "hazelnut" },
        { kind: "added", text: "sunflower" },
        { kind: "same", text: "." },
      ],
    );
    expect(wordDiff('Sounds "good".', 'Sounds "great".')).toEqual([
      { kind: "same", text: 'Sounds "' },
      { kind: "removed", text: "good" },
      { kind: "added", text: "great" },
      { kind: "same", text: '".' },
    ]);
    expect(wordDiff("don't stop", "do not stop")).toEqual([
      { kind: "removed", text: "don't " },
      { kind: "added", text: "do not " },
      { kind: "same", text: "stop" },
    ]);
  });

  it("keeps a space that added or removed punctuation only moves", () => {
    expect(
      wordDiff(
        "could make those details harder to distinguish",
        "could make those details, like status labels, harder to distinguish",
      ),
    ).toEqual([
      { kind: "same", text: "could make those details" },
      { kind: "added", text: ", like status labels," },
      { kind: "same", text: " harder to distinguish" },
    ]);
    expect(
      wordDiff("details, like status labels, harder", "details harder"),
    ).toEqual([
      { kind: "same", text: "details" },
      { kind: "removed", text: ", like status labels," },
      { kind: "same", text: " harder" },
    ]);
    expect(wordDiff("Hello\nWorld", "Hello!\nWorld")).toEqual([
      { kind: "same", text: "Hello" },
      { kind: "added", text: "!" },
      { kind: "same", text: "\nWorld" },
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
    expect(trimmed[0]).toEqual({ kind: "same", text: "one two …seven eight " });
    expect(trimmed[2]).toEqual({ kind: "same", text: "ten eleven twelve…" });
  });

  it("leads a change deep in a paragraph with the paragraph's first words", () => {
    const row = (before: string, after: string) =>
      trimDiffContext(wordDiff(before, after));
    expect(
      row(
        "Beetroot salad. Roasted beetroot on whipped feta, orange segments, toasted hazelnut crumb, aged balsamic.",
        "Beetroot salad. Roasted beetroot on whipped feta, orange segments, toasted sunflower seed crumb, aged balsamic.",
      ),
    ).toEqual([
      {
        kind: "same",
        text: "Beetroot salad. …feta, orange segments, toasted ",
      },
      { kind: "removed", text: "hazelnut " },
      { kind: "added", text: "sunflower seed " },
      { kind: "same", text: "crumb, aged balsamic." },
    ]);
    expect(
      row(
        "Roasted beetroot on whipped feta with orange segments, toasted hazelnut crumb and aged balsamic.",
        "Roasted beetroot on whipped feta with orange segments, toasted sunflower seed crumb and aged balsamic.",
      )[0],
    ).toEqual({
      kind: "same",
      text: "Roasted beetroot on …orange segments, toasted ",
    });
  });

  it("shows a change near its paragraph's start without skipping text", () => {
    expect(
      trimDiffContext(
        wordDiff(
          "Charred leeks. Almond and roasted red pepper romesco, crispy shallots.",
          "Charred leeks (N). Almond and roasted red pepper romesco, crispy shallots.",
        ),
      ),
    ).toEqual([
      { kind: "same", text: "Charred leeks" },
      { kind: "added", text: " (N)" },
      {
        kind: "same",
        text: ". Almond and roasted red pepper romesco, crispy…",
      },
    ]);
  });

  it("starts at the change's own paragraph", () => {
    expect(
      trimDiffContext(
        wordDiff(
          "A first paragraph long enough that the row would show its tail.\nShort rib. Red-wine braised.",
          "A first paragraph long enough that the row would show its tail.\nShort rib (D). Red-wine braised.",
        ),
      ),
    ).toEqual([
      { kind: "same", text: "Short rib" },
      { kind: "added", text: " (D)" },
      { kind: "same", text: ". Red-wine braised." },
    ]);
  });
});
