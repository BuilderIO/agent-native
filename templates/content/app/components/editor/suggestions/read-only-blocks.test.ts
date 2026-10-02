import { RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION } from "@agent-native/toolkit/editor";
import { createContentEditorStructuralSchema } from "@shared/content-editor-structural-schema";
import { nfmToDoc } from "@shared/nfm";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { DecorationSet } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";

import {
  suggestingReadOnlyBlocksPlugin,
  unsupportedSuggestionRanges,
} from "./read-only-blocks";

const schema = createContentEditorStructuralSchema();

const PAGE = [
  "Intro paragraph.",
  "",
  "| Name | Value |",
  "| --- | --- |",
  "| cell text | other |",
  "",
  "Closing paragraph.",
].join("\n");

function stateFor(markdown: string, suggesting = true) {
  return EditorState.create({
    doc: schema.nodeFromJSON(nfmToDoc(markdown)),
    plugins: [suggestingReadOnlyBlocksPlugin(() => suggesting)],
  });
}

function textPosition(state: EditorState, text: string): number {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    const index = node.isText ? (node.text ?? "").indexOf(text) : -1;
    if (index >= 0) found = pos + index;
    return true;
  });
  if (found < 0) throw new Error(`"${text}" is not in the document`);
  return found;
}

function tableRange(state: EditorState) {
  let range: { from: number; to: number } | null = null;
  state.doc.forEach((node, offset) => {
    if (node.type.name === "table") {
      range = { from: offset, to: offset + node.nodeSize };
    }
  });
  if (!range) throw new Error("The document has no table");
  return range as { from: number; to: number };
}

function applies(state: EditorState, transaction: Transaction): boolean {
  return state.apply(transaction) !== state;
}

describe("suggesting read-only blocks", () => {
  it("refuses typing in a table cell", () => {
    const state = stateFor(PAGE);
    const at = textPosition(state, "cell text");
    expect(applies(state, state.tr.insertText("X", at))).toBe(false);
  });

  it("allows typing in a paragraph", () => {
    const state = stateFor(PAGE);
    const at = textPosition(state, "Closing");
    const next = state.apply(state.tr.insertText("X", at));
    expect(next.doc.textContent).toContain("XClosing paragraph.");
  });

  it("refuses a deletion that spans the table", () => {
    const state = stateFor(PAGE);
    const from = textPosition(state, "paragraph.");
    const to = textPosition(state, "Closing");
    expect(applies(state, state.tr.delete(from, to))).toBe(false);
  });

  it("refuses deleting the table", () => {
    const state = stateFor(PAGE);
    const { from, to } = tableRange(state);
    expect(applies(state, state.tr.delete(from, to))).toBe(false);
  });

  it("refuses a mark inside a table cell", () => {
    const state = stateFor(PAGE);
    const from = textPosition(state, "cell text");
    const transaction = state.tr.addMark(
      from,
      from + "cell".length,
      schema.marks.bold!.create(),
    );
    expect(applies(state, transaction)).toBe(false);
  });

  it("allows a block inserted next to the table", () => {
    const state = stateFor(PAGE);
    const { to } = tableRange(state);
    const transaction = state.tr.insert(
      to,
      schema.nodes.paragraph!.create(null, schema.text("After")),
    );
    expect(applies(state, transaction)).toBe(true);
  });

  it("allows loading a whole document outside undo history", () => {
    const state = stateFor(PAGE);
    const draft = schema.nodeFromJSON(nfmToDoc(`${PAGE}\n\nMore.`));
    const transaction = state.tr
      .replaceWith(0, state.doc.content.size, draft.content)
      .setMeta("addToHistory", false);
    expect(applies(state, transaction)).toBe(true);
  });

  it("refuses pasting a table into a paragraph", () => {
    const state = stateFor(PAGE);
    const at = textPosition(state, "Closing");
    const pasted = schema.nodeFromJSON(nfmToDoc(PAGE)).child(1);
    expect(pasted.type.name).toBe("table");
    expect(applies(state, state.tr.insert(at, pasted))).toBe(false);
  });

  it("allows a programmatic reconcile across the table", () => {
    const state = stateFor(PAGE);
    const { from, to } = tableRange(state);
    const transaction = state.tr
      .delete(from, to)
      .setMeta("addToHistory", false)
      .setMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION, true);
    expect(applies(state, transaction)).toBe(true);
  });

  it("refuses a partial update across the table outside undo history", () => {
    const state = stateFor(PAGE);
    const { from, to } = tableRange(state);
    const transaction = state.tr
      .delete(from, to)
      .setMeta("addToHistory", false);
    expect(applies(state, transaction)).toBe(false);
  });

  it("refuses typing over a select-all", () => {
    const state = stateFor(PAGE);
    const transaction = state.tr.insertText("X", 0, state.doc.content.size);
    expect(applies(state, transaction)).toBe(false);
  });

  it("leaves tables editable outside suggesting", () => {
    const state = stateFor(PAGE, false);
    const at = textPosition(state, "cell text");
    expect(applies(state, state.tr.insertText("X", at))).toBe(true);
  });

  it("marks only unsupported nodes read-only", () => {
    const state = stateFor(PAGE);
    expect(unsupportedSuggestionRanges(state.doc)).toEqual([tableRange(state)]);
    const plugin = state.plugins[0]!;
    const decorations = plugin.props.decorations!.call(
      plugin,
      state,
    ) as DecorationSet;
    expect(decorations.find().map(({ from, to }) => ({ from, to }))).toEqual([
      tableRange(state),
    ]);
  });
});
