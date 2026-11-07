import { createContentEditorStructuralSchema } from "@shared/content-editor-structural-schema";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { caretAfterPageSwap } from "./keep-caret";

const schema = createContentEditorStructuralSchema();
const doc = (...paragraphs: string[]) =>
  schema.node(
    "doc",
    null,
    paragraphs.map((text) => schema.node("paragraph", null, schema.text(text))),
  );

/** The position just after `text` in the document. */
function after(document: ProseMirrorNode, text: string) {
  const found: number[] = [];
  document.descendants((node, position) => {
    const index = node.isText ? (node.text?.indexOf(text) ?? -1) : -1;
    if (index >= 0) found.push(position + index + text.length);
  });
  if (found.length === 0) throw new Error(`No "${text}" in the fixture`);
  return found[0];
}

/** What the caret's paragraph reads before and after it. */
function around(document: ProseMirrorNode, position: number | null) {
  if (position === null) throw new Error("No place for the caret");
  const $position = document.resolve(position);
  const text = $position.parent.textContent;
  return [
    text.slice(0, $position.parentOffset),
    text.slice($position.parentOffset),
  ];
}

describe("caretAfterPageSwap", () => {
  it("keeps the caret in its paragraph when another one changed", () => {
    const before = doc("First words here.", "Second words.", "Third words.");
    const next = doc("First words here.", "Second words, edited.", "Third.");
    const at = caretAfterPageSwap(before, after(before, "First words"), next);
    expect(around(next, at)).toEqual(["First words", " here."]);
  });

  it("finds the caret's paragraph between two changed ones", () => {
    const before = doc("Alpha one.", "Beta two.", "Gamma three.");
    const next = doc("Alpha one!", "Beta two.", "Gamma three!");
    const at = caretAfterPageSwap(before, after(before, "Beta"), next);
    expect(around(next, at)).toEqual(["Beta", " two."]);
  });

  it("puts a caret after this tab's own saved words where they were", () => {
    // The saved suggestion leaves the draft's text and shows as a mark, and
    // another tab changed the next paragraph.
    const before = doc("Opening line. Suggested words.", "Closing line.");
    const next = doc("Opening line.", "Closing line, edited.");
    const at = caretAfterPageSwap(
      before,
      after(before, "Suggested words."),
      next,
    );
    expect(around(next, at)).toEqual(["Opening line.", ""]);
  });

  it("keeps a caret before the changed text in its paragraph", () => {
    const before = doc("Keep this start and an old ending.");
    const next = doc("Keep this start and a new ending.");
    const at = caretAfterPageSwap(before, after(before, "Keep this"), next);
    expect(around(next, at)).toEqual(["Keep this", " start and a new ending."]);
  });

  it("keeps a caret after the changed text in its paragraph", () => {
    const before = doc("An old start, then the same ending.");
    const next = doc("A new start, then the same ending.");
    const at = caretAfterPageSwap(before, after(before, "the same"), next);
    expect(around(next, at)).toEqual([
      "A new start, then the same",
      " ending.",
    ]);
  });

  it("follows the paragraphs after an added one", () => {
    const before = doc("One.", "Two.", "Three.");
    const next = doc("One.", "Inserted.", "Two.", "Three.");
    const at = caretAfterPageSwap(before, after(before, "Thr"), next);
    expect(around(next, at)).toEqual(["Thr", "ee."]);
  });

  it("gives up when paragraphs were added around a changed one", () => {
    const before = doc("One.", "Two.", "Three.");
    const next = doc("One!", "Inserted.", "Two!", "Three.");
    expect(caretAfterPageSwap(before, after(before, "Tw"), next)).toBeNull();
  });
});
