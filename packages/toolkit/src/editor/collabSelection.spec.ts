// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { prosemirrorToYDoc } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createRichMarkdownExtensions } from "./RichMarkdownEditor.js";

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function pageUpdate(page: string) {
  const seed = new Editor({
    extensions: createRichMarkdownExtensions(),
    content: page,
  });
  const update = Y.encodeStateAsUpdate(
    prosemirrorToYDoc(seed.state.doc, "default"),
  );
  seed.destroy();
  return update;
}

/** Opens the same page in two collaborating editors with fixed client ids. */
function twoEditors(page: string, clientIds: [number, number] = [1, 2]) {
  const update = pageUpdate(page);
  return clientIds.map((clientId) => {
    const ydoc = new Y.Doc();
    ydoc.clientID = clientId;
    Y.applyUpdate(ydoc, update, "remote");
    const editor = new Editor({
      extensions: createRichMarkdownExtensions({ ydoc }),
    });
    editors.push(editor);
    return { editor, ydoc };
  }) as [{ editor: Editor; ydoc: Y.Doc }, { editor: Editor; ydoc: Y.Doc }];
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
});
