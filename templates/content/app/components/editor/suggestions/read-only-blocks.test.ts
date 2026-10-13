import { RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION } from "@agent-native/toolkit/editor";
import { createContentEditorStructuralSchema } from "@shared/content-editor-structural-schema";
import { nfmToDoc } from "@shared/nfm";
import {
  joinBackward,
  joinForward,
  lift,
  liftEmptyBlock,
} from "@tiptap/pm/commands";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  type Command,
  EditorState,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import type { DecorationSet } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";

import {
  frozenSuggestionRanges,
  suggestingReadOnlyBlocksPlugin,
} from "./read-only-blocks";

const schema = createContentEditorStructuralSchema();
const TAB = "\t";

const PAGE = [
  "Intro paragraph.",
  "",
  "| Name | Value |",
  "| --- | --- |",
  "| cell text | other |",
  "",
  '<callout icon="💡">',
  `${TAB}Callout text`,
  "</callout>",
  "",
  "<details open>",
  "<summary>Toggle title</summary>",
  `${TAB}Toggle text`,
  "</details>",
  "",
  "<columns>",
  `${TAB}<column>`,
  `${TAB}${TAB}Left text`,
  `${TAB}</column>`,
  `${TAB}<column>`,
  `${TAB}${TAB}Right text`,
  `${TAB}</column>`,
  "</columns>",
  "",
  "![Diagram](https://example.com/diagram.png)",
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

function nodeRange(state: EditorState, type: string) {
  let range: { from: number; to: number; node: ProseMirrorNode } | null = null;
  state.doc.descendants((node, pos) => {
    if (range) return false;
    if (node.type.name === type) {
      range = { from: pos, to: pos + node.nodeSize, node };
    }
    return true;
  });
  if (!range) throw new Error(`The document has no ${type}`);
  return range as { from: number; to: number; node: ProseMirrorNode };
}

function applies(state: EditorState, transaction: Transaction): boolean {
  return state.apply(transaction) !== state;
}

describe("suggesting read-only blocks", () => {
  it("parses every frame and the frozen image", () => {
    const state = stateFor(PAGE);
    for (const type of [
      "table",
      "notionCallout",
      "notionToggle",
      "notionColumns",
      "image",
    ]) {
      expect(nodeRange(state, type).node.type.name).toBe(type);
    }
  });

  it.each(["cell text", "Callout text", "Toggle text", "Left text"])(
    "allows typing in %s",
    (text) => {
      const state = stateFor(PAGE);
      const next = state.apply(
        state.tr.insertText("X", textPosition(state, text)),
      );
      expect(next.doc.textContent).toContain(`X${text}`);
    },
  );

  it("allows typing in a paragraph", () => {
    const state = stateFor(PAGE);
    const at = textPosition(state, "Closing");
    expect(applies(state, state.tr.insertText("X", at))).toBe(true);
  });

  it("allows bold inside a table cell", () => {
    const state = stateFor(PAGE);
    const from = textPosition(state, "cell text");
    const transaction = state.tr.addMark(
      from,
      from + "cell".length,
      schema.marks.bold!.create(),
    );
    expect(applies(state, transaction)).toBe(true);
  });

  it("refuses a deletion that spans the table", () => {
    const state = stateFor(PAGE);
    const from = textPosition(state, "paragraph.");
    const to = textPosition(state, "Callout text");
    expect(applies(state, state.tr.delete(from, to))).toBe(false);
  });

  it.each(["table", "notionCallout", "notionToggle", "notionColumns"])(
    "refuses deleting a whole %s",
    (type) => {
      const state = stateFor(PAGE);
      const { from, to } = nodeRange(state, type);
      expect(applies(state, state.tr.delete(from, to))).toBe(false);
    },
  );

  it("refuses adding a table row", () => {
    const state = stateFor(PAGE);
    const row = nodeRange(state, "tableRow");
    expect(
      applies(state, state.tr.insert(row.to, row.node.copy(row.node.content))),
    ).toBe(false);
  });

  it("refuses splitting a paragraph inside a table cell", () => {
    const state = stateFor(PAGE);
    const at = textPosition(state, "text") + "te".length;
    expect(applies(state, state.tr.split(at))).toBe(false);
  });

  it.each(["Callout text", "Toggle text", "Left text"])(
    "allows adding and removing a paragraph after %s",
    (text) => {
      const state = stateFor(PAGE);
      const at = textPosition(state, text) + text.length;
      const added = state.apply(state.tr.split(at));
      expect(added).not.toBe(state);
      expect(added.doc.childCount).toBe(state.doc.childCount);
      expect(applies(added, added.tr.join(at + 1))).toBe(true);
    },
  );

  it("refuses adding a column", () => {
    const state = stateFor(PAGE);
    const column = nodeRange(state, "notionColumn");
    expect(
      applies(
        state,
        state.tr.insert(column.to, column.node.copy(column.node.content)),
      ),
    ).toBe(false);
  });

  it("refuses changing a callout icon or a toggle title", () => {
    const state = stateFor(PAGE);
    const callout = nodeRange(state, "notionCallout");
    const toggle = nodeRange(state, "notionToggle");
    expect(
      applies(
        state,
        state.tr.setNodeMarkup(callout.from, undefined, {
          ...callout.node.attrs,
          icon: "🔥",
        }),
      ),
    ).toBe(false);
    expect(
      applies(
        state,
        state.tr.setNodeMarkup(toggle.from, undefined, {
          ...toggle.node.attrs,
          summary: "New title",
        }),
      ),
    ).toBe(false);
  });

  it("refuses deleting the image", () => {
    const state = stateFor(PAGE);
    const { from, to } = nodeRange(state, "image");
    expect(applies(state, state.tr.delete(from, to))).toBe(false);
  });

  it("allows a block inserted next to the table", () => {
    const state = stateFor(PAGE);
    const { to } = nodeRange(state, "table");
    const transaction = state.tr.insert(
      to,
      schema.nodes.paragraph!.create(null, schema.text("After")),
    );
    expect(applies(state, transaction)).toBe(true);
  });

  it("refuses pasting a table into a paragraph", () => {
    const state = stateFor(PAGE);
    const at = textPosition(state, "Closing");
    const pasted = nodeRange(state, "table").node;
    expect(applies(state, state.tr.insert(at, pasted))).toBe(false);
  });

  it("allows loading a whole document outside undo history", () => {
    const state = stateFor(PAGE);
    const draft = schema.nodeFromJSON(nfmToDoc(`${PAGE}\n\nMore.`));
    const transaction = state.tr
      .replaceWith(0, state.doc.content.size, draft.content)
      .setMeta("addToHistory", false);
    expect(applies(state, transaction)).toBe(true);
  });

  it("checks the steps after a load against the loaded body", () => {
    const state = stateFor("Intro paragraph.");
    const loaded = stateFor(`${PAGE}\n\nMore.`);
    const row = nodeRange(loaded, "tableRow");
    const load = () =>
      state.tr
        .replaceWith(0, state.doc.content.size, loaded.doc.content)
        .setMeta("addToHistory", false);
    expect(
      applies(state, load().insertText("X", textPosition(loaded, "cell text"))),
    ).toBe(true);
    expect(
      applies(state, load().insert(row.to, row.node.copy(row.node.content))),
    ).toBe(false);
  });

  it("allows a programmatic reconcile across the table", () => {
    const state = stateFor(PAGE);
    const { from, to } = nodeRange(state, "table");
    const transaction = state.tr
      .delete(from, to)
      .setMeta("addToHistory", false)
      .setMeta(RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION, true);
    expect(applies(state, transaction)).toBe(true);
  });

  it("refuses a partial update across the table outside undo history", () => {
    const state = stateFor(PAGE);
    const { from, to } = nodeRange(state, "table");
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

  it("leaves every block editable outside suggesting", () => {
    const state = stateFor(PAGE, false);
    const row = nodeRange(state, "tableRow");
    const image = nodeRange(state, "image");
    expect(
      applies(state, state.tr.insert(row.to, row.node.copy(row.node.content))),
    ).toBe(true);
    expect(applies(state, state.tr.delete(image.from, image.to))).toBe(true);
  });

  it("marks only frozen nodes read-only", () => {
    const state = stateFor(PAGE);
    const image = nodeRange(state, "image");
    const expected = [{ from: image.from, to: image.to }];
    expect(frozenSuggestionRanges(state.doc)).toEqual(expected);
    const plugin = state.plugins[0]!;
    const decorations = plugin.props.decorations!.call(
      plugin,
      state,
    ) as DecorationSet;
    expect(decorations.find().map(({ from, to }) => ({ from, to }))).toEqual(
      expected,
    );
  });
});

describe("text at a frame's edge while suggesting", () => {
  const EDGES = [
    "Intro.",
    "",
    '<callout icon="💡">',
    `${TAB}Callout text`,
    `${TAB}Last callout line`,
    "</callout>",
    "",
    "After callout",
    "",
    "<details open>",
    "<summary>Toggle title</summary>",
    `${TAB}Toggle one`,
    `${TAB}Toggle two`,
    "</details>",
    "",
    "After toggle",
  ].join("\n");

  function run(state: EditorState, at: number, command: Command) {
    const selected = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, at)),
    );
    let transaction: Transaction | undefined;
    expect(
      command(selected, (next) => {
        transaction = next;
      }),
    ).toBe(true);
    return applies(selected, transaction!);
  }

  // Shift-Tab and a drag move a block with a deletion and an insertion.
  function moveOutOfToggle(state: EditorState) {
    const $at = state.doc.resolve(textPosition(state, "Toggle two"));
    const child = $at.parent;
    const childPos = $at.before();
    const togglePos = $at.before($at.depth - 1);
    const transaction = state.tr.delete(childPos, childPos + child.nodeSize);
    const toggle = transaction.doc.nodeAt(togglePos)!;
    return transaction.insert(togglePos + toggle.nodeSize, child);
  }

  it.each([
    ["Backspace after a callout", "After callout", 0, joinBackward],
    ["Backspace after a toggle", "After toggle", 0, joinBackward],
    ["Delete at the end of a callout", "Last callout line", 17, joinForward],
    ["lifting a paragraph out of a toggle", "Toggle two", 0, lift],
  ] as const)("refuses %s", (_, text, offset, command) => {
    const state = stateFor(EDGES);
    expect(run(state, textPosition(state, text) + offset, command)).toBe(false);
  });

  it("refuses deleting across a callout's end", () => {
    const state = stateFor(EDGES);
    const from = textPosition(state, "line");
    const to = textPosition(state, "After callout") + "After ".length;
    expect(applies(state, state.tr.delete(from, to))).toBe(false);
  });

  it("refuses moving a block out of a toggle", () => {
    const state = stateFor(EDGES);
    expect(applies(state, moveOutOfToggle(state))).toBe(false);
    expect(applies(stateFor(EDGES, false), moveOutOfToggle(state))).toBe(true);
  });

  it("refuses Enter on an empty last paragraph in a callout", () => {
    const state = stateFor(EDGES);
    const at = textPosition(state, "Last callout line") + 17;
    const added = state.apply(state.tr.split(at));
    expect(added).not.toBe(state);
    expect(run(added, at + 2, liftEmptyBlock)).toBe(false);
  });

  it("allows joining two paragraphs inside a callout", () => {
    const state = stateFor(EDGES);
    expect(
      run(state, textPosition(state, "Last callout line"), joinBackward),
    ).toBe(true);
  });

  it("allows clearing two table cells in one transaction", () => {
    const state = stateFor(PAGE);
    const first = textPosition(state, "cell text");
    const second = textPosition(state, "other");
    const transaction = state.tr
      .delete(second, second + "other".length)
      .delete(first, first + "cell text".length);
    expect(applies(state, transaction)).toBe(true);
  });

  it("allows moving a paragraph within the page", () => {
    const state = stateFor(EDGES);
    const $intro = state.doc.resolve(textPosition(state, "Intro."));
    const intro = $intro.parent;
    const transaction = state.tr
      .insert(state.doc.content.size, intro)
      .delete($intro.before(), $intro.after());
    expect(applies(state, transaction)).toBe(true);
  });
});
