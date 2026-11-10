// @vitest-environment happy-dom

import { Editor, Extension, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { prosemirrorToYDoc } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

/** A block id like the ones apps add to paragraphs, so blocks with the same text differ. */
const BlockId = Extension.create({
  name: "blockId",
  addGlobalAttributes() {
    return [
      { types: ["paragraph"], attributes: { blockId: { default: null } } },
    ];
  },
});

function pageUpdate(page: string | JSONContent) {
  const seed = new Editor({
    extensions: [...createRichMarkdownExtensions(), BlockId],
    content: page,
  });
  const update = Y.encodeStateAsUpdate(
    prosemirrorToYDoc(seed.state.doc, "default"),
  );
  seed.destroy();
  return update;
}

/** Opens the same page in two collaborating editors with fixed client ids. */
function twoEditors(
  page: string | JSONContent,
  clientIds: [number, number] = [1, 2],
) {
  const update = pageUpdate(page);
  const [a, b] = clientIds.map((clientId) => {
    const ydoc = new Y.Doc();
    ydoc.clientID = clientId;
    Y.applyUpdate(ydoc, update, "remote");
    const editor = new Editor({
      extensions: [...createRichMarkdownExtensions({ ydoc }), BlockId],
    });
    editors.push(editor);
    return { editor, ydoc };
  }) as [{ editor: Editor; ydoc: Y.Doc }, { editor: Editor; ydoc: Y.Doc }];
  // Each editor writes to its doc as it opens; share that as a provider would.
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc), "remote");
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc), "remote");
  return [a, b] as const;
}

/** Queues one doc's local updates for delivery to the other on demand. */
function outbox(from: Y.Doc, to: Y.Doc) {
  const pending: Uint8Array[] = [];
  from.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote") pending.push(update);
  });
  return {
    deliver(count = pending.length) {
      for (const update of pending.splice(0, count)) {
        Y.applyUpdate(to, update, "remote");
      }
    },
    /** Delivers every queued update as one, as when a connection catches up. */
    deliverMerged() {
      Y.applyUpdate(to, Y.mergeUpdates(pending.splice(0)), "remote");
    },
  };
}

function blockStart(editor: Editor, index: number): number {
  let start = 0;
  editor.state.doc.forEach((_node, offset, i) => {
    if (i === index) start = offset + 1;
  });
  return start;
}

function placeCursor(editor: Editor, pos: number) {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
}

function type(editor: Editor, text: string) {
  editor.view.dispatch(editor.state.tr.insertText(text));
}

function cursorBlock(editor: Editor) {
  const $head = editor.state.selection.$head;
  return {
    index: $head.index(0),
    text: $head.parent.textContent,
    offset: $head.parentOffset,
  };
}

/** Moves a node to another spot in one transaction, as a drag handle does. */
function moveNode(editor: Editor, from: number, to: number) {
  const node = editor.state.doc.nodeAt(from)!;
  const tr = editor.state.tr.delete(from, from + node.nodeSize);
  editor.view.dispatch(tr.insert(tr.mapping.map(to), node));
}

function paragraphs(...texts: string[]): JSONContent[] {
  return texts.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  }));
}

describe("cursor after a collaborator's change", () => {
  it("keeps typing in order when a collaborator types at the same spot", () => {
    // Updates from A reach B at once; B's reach A three keystrokes late. With
    // these client ids, y-tiptap alone moved A's cursor back into its own
    // word: "Book the venue by Friday. AskCheck the wifi too. about parking."
    const [a, b] = twoEditors("Book the venue by Friday.", [948, 1335]);
    const toB = outbox(a.ydoc, b.ydoc);
    const toA = outbox(b.ydoc, a.ydoc);
    const end = blockStart(a.editor, 0) + "Book the venue by Friday.".length;
    placeCursor(a.editor, end);
    placeCursor(b.editor, end);
    const textA = " Ask about parking.";
    const textB = " Check the wifi too.";
    const lagged: number[] = [];
    for (let i = 0; i < Math.max(textA.length, textB.length); i++) {
      if (i < textA.length) type(a.editor, textA[i]!);
      if (i < textB.length) type(b.editor, textB[i]!);
      lagged.push(i < textB.length ? 1 : 0);
      if (lagged.length > 3) toA.deliver(lagged.shift());
      toB.deliver();
    }
    toA.deliver();

    const final = a.editor.state.doc.textContent;
    expect(b.editor.state.doc.textContent).toBe(final);
    expect(final).toContain(textA);
    expect(final).toContain(textB);
  });

  it("keeps the cursor after a letter both people typed at once", () => {
    // Both type "h" at the end of "Hello " before either update arrives.
    // y-tiptap alone put B's cursor between the two h's, so B's next letters
    // split them: "Hello helloh".
    const [a, b] = twoEditors({
      type: "doc",
      content: paragraphs("Hello ", "Another line"),
    });
    const toB = outbox(a.ydoc, b.ydoc);
    const end = blockStart(a.editor, 0) + "Hello ".length;
    placeCursor(a.editor, end);
    placeCursor(b.editor, end);
    type(a.editor, "h");
    type(b.editor, "h");
    toB.deliver();

    expect(b.editor.state.selection.head).toBe(end + 2);
    for (const letter of "ello") type(b.editor, letter);
    expect(b.editor.state.doc.child(0).textContent).toBe("Hello hhello");
  });

  it.each([
    ["at the end, after a period both blocks share", "end"],
    ["in the middle", "middle"],
    ["at the start", "start"],
  ] as const)(
    "follows a block a collaborator moves, with the cursor %s",
    (_label, where) => {
      const texts = ["Alpha one.", "Beta two.", "Gamma three."];
      const [a, b] = twoEditors(texts.join("\n\n"));
      const toA = outbox(b.ydoc, a.ydoc);
      const offset =
        where === "end" ? texts[2]!.length : where === "middle" ? 3 : 0;
      placeCursor(a.editor, blockStart(a.editor, 2) + offset);

      // B moves the last block to the top: deletes it, inserts it again first.
      const moved = b.editor.state.doc.child(2);
      const from = blockStart(b.editor, 2) - 1;
      b.editor.view.dispatch(
        b.editor.state.tr.delete(from, from + moved.nodeSize).insert(0, moved),
      );
      toA.deliver();

      expect(cursorBlock(a.editor)).toEqual({
        index: 0,
        text: texts[2],
        offset,
      });
    },
  );

  it("follows a block a collaborator moves inside a quote, with the cursor at the end", () => {
    // y-sync rewrites both paragraphs' text in place, keeping the "e." they
    // share, so the Yjs position stays after the period in the second one.
    const texts = ["Alpha one.", "Gamma three."];
    const [a, b] = twoEditors({
      type: "doc",
      content: [{ type: "blockquote", content: paragraphs(...texts) }],
    });
    const toA = outbox(b.ydoc, a.ydoc);
    // The quote opens at 0 and its first paragraph at 1.
    const second = 1 + a.editor.state.doc.child(0).child(0).nodeSize;
    placeCursor(a.editor, second + 1 + texts[1]!.length);

    moveNode(b.editor, second, 1);
    toA.deliver();

    const $head = a.editor.state.selection.$head;
    expect([
      $head.index(1),
      $head.parent.textContent,
      $head.parentOffset,
    ]).toEqual([0, texts[1], texts[1]!.length]);
  });

  it("stays in its block when a collaborator edits it and adds a copy of its old text", () => {
    // Nothing moved, though the block's old text now sits in another block.
    const texts = ["Alpha one.", "Gamma three."];
    const [a, b] = twoEditors(texts.join("\n\n"));
    const toA = outbox(b.ydoc, a.ydoc);
    placeCursor(a.editor, blockStart(a.editor, 1) + texts[1]!.length);

    const copy = b.editor.state.doc.child(1);
    placeCursor(b.editor, blockStart(b.editor, 1));
    type(b.editor, "Note: ");
    const { state } = b.editor;
    b.editor.view.dispatch(state.tr.insert(state.doc.content.size, copy));
    toA.deliverMerged();

    const edited = `Note: ${texts[1]}`;
    expect(cursorBlock(a.editor)).toEqual({
      index: 1,
      text: edited,
      offset: edited.length,
    });
  });

  it.each([
    ["at the start", 0],
    ["in the middle", 2],
    ["at the end", 4],
  ] as const)(
    "follows its own block when a collaborator swaps two with the same text, with the cursor %s",
    (_label, offset) => {
      const [a, b] = twoEditors({
        type: "doc",
        content: paragraphs("Same", "Same").map((block, i) => ({
          ...block,
          attrs: { blockId: `p${i}` },
        })),
      });
      const toA = outbox(b.ydoc, a.ydoc);
      placeCursor(a.editor, blockStart(a.editor, 0) + offset);

      moveNode(b.editor, 0, b.editor.state.doc.content.size);
      toA.deliver();

      const $head = a.editor.state.selection.$head;
      expect([$head.parent.attrs.blockId, $head.parentOffset]).toEqual([
        "p0",
        offset,
      ]);
    },
  );
});
