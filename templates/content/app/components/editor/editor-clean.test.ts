import { describe, expect, it } from "vitest";

import { isEditorContentClean, type EditorCleanInput } from "./editor-clean";

const clean: EditorCleanInput = {
  liveMarkdown: "Alpha\n\nBravo",
  normalize: (markdown) => markdown.trim().replace(/\n+/g, "\n"),
  saveQueued: false,
  saveInFlight: false,
  recoveryPending: false,
  journalContents: [],
  suggesting: false,
};

describe("isEditorContentClean", () => {
  it("is clean when nothing is pending", () => {
    expect(isEditorContentClean(clean)).toBe(true);
  });

  it("ignores a journal draft the live doc already equals", () => {
    expect(
      isEditorContentClean({ ...clean, journalContents: ["Alpha\nBravo"] }),
    ).toBe(true);
  });

  it.each([
    ["a debounced save still queued", { saveQueued: true }],
    ["a save in flight", { saveInFlight: true }],
    ["a reconcile recovery draft", { recoveryPending: true }],
    [
      "a journaled draft with text the doc lacks",
      { journalContents: ["Alpha\nBravo typed"] },
    ],
    [
      "one stale and one unsaved journal draft",
      { journalContents: ["Alpha\nBravo", "Alpha\nBravo typed"] },
    ],
    ["an unreadable recovery journal", { journalContents: null }],
    ["suggesting mode", { suggesting: true }],
  ] satisfies Array<[string, Partial<EditorCleanInput>]>)(
    "is dirty with %s",
    (_name, override) => {
      expect(isEditorContentClean({ ...clean, ...override })).toBe(false);
    },
  );
});
