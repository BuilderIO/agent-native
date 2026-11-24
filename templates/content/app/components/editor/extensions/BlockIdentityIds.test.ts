// @vitest-environment happy-dom

import {
  BLOCK_IDENTITY_ATTR,
  blockIdentityIdOf,
} from "@shared/block-identity-ids";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, it } from "vitest";

import {
  blockPlaces,
  editorDocBlockIds,
  stampBlockIdentityIds,
} from "../block-links";
import { createVisualEditorExtensions } from "../VisualEditor";
import { copiedSlice, pastedSlice } from "./BlockIdentityIds";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(nfm: string) {
  editor = new Editor({
    extensions: createVisualEditorExtensions({}),
    content: nfmToDoc(nfm),
  });
  return editor;
}

function stamp(target: Editor, ids: string[]) {
  const { shape } = editorDocBlockIds(target.state.doc);
  const idsByPath = Object.fromEntries(
    ids.map((id, index) => [`${index}`, id]),
  );
  expect(stampBlockIdentityIds(target, { shape, idsByPath })).toBe("stamped");
}

function held(target: Editor) {
  return blockPlaces(target.state.doc)
    .filter(({ path }) => !path.includes("."))
    .map(({ node }) => [
      node.textContent,
      node.attrs[BLOCK_IDENTITY_ATTR] ?? null,
    ]);
}

function textEnd(target: Editor, index: number) {
  const place = blockPlaces(target.state.doc)
    .filter(({ path }) => !path.includes("."))
    .find((_, position) => position === index);
  if (!place) throw new Error("Expected the fixture to have the block");
  return place.pos + place.node.nodeSize - 1;
}

describe("block identity IDs in the editor", () => {
  it("keeps the ID on the first half of a split", () => {
    const target = open("Apples ripen. Pears bruise.");
    stamp(target, ["block_a"]);
    target.commands.setTextSelection(
      textEnd(target, 0) - " Pears bruise.".length,
    );
    target.commands.splitBlock();

    expect(held(target)).toEqual([
      ["Apples ripen.", "block_a"],
      [" Pears bruise.", null],
    ]);
  });

  it("keeps the ID on the block Enter pushes down, not the empty line above it", () => {
    const target = open("Apples ripen.");
    stamp(target, ["block_a"]);
    target.commands.setTextSelection(1);
    target.commands.splitBlock();

    expect(held(target)).toEqual([
      ["", null],
      ["Apples ripen.", "block_a"],
    ]);
  });

  it("leaves a duplicate without the original's ID", () => {
    const target = open("Apples ripen.\nPears bruise.");
    stamp(target, ["block_a", "block_b"]);
    const first = target.state.doc.child(0);
    target.view.dispatch(target.state.tr.insert(first.nodeSize, first));

    expect(held(target)).toEqual([
      ["Apples ripen.", "block_a"],
      ["Apples ripen.", null],
      ["Pears bruise.", "block_b"],
    ]);
  });

  it("keeps the ID through a change of type and a drag", () => {
    const target = open("Apples ripen.\nPears bruise.\nPlums fall.");
    stamp(target, ["block_a", "block_b", "block_c"]);
    target.commands.setTextSelection(2);
    target.commands.setNode("heading", { level: 1 });
    const first = target.state.doc.child(0);
    const tr = target.state.tr.delete(0, first.nodeSize);
    target.view.dispatch(tr.insert(tr.doc.child(0).nodeSize, first));

    expect(held(target)).toEqual([
      ["Pears bruise.", "block_b"],
      ["Apples ripen.", "block_a"],
      ["Plums fall.", "block_c"],
    ]);
    expect(target.state.doc.child(1).type.name).toBe("heading");
  });

  it("gives a deleted block's ID to no other block put in its place", () => {
    const target = open("Apples ripen.\nPears bruise.");
    stamp(target, ["block_a", "block_b"]);
    const first = target.state.doc.child(0);
    const other = target.state.schema.node(
      "paragraph",
      null,
      target.state.schema.text("Plums falling"),
    );
    expect(other.nodeSize).toBe(first.nodeSize);
    target.view.dispatch(target.state.tr.replaceWith(0, first.nodeSize, other));

    expect(held(target)).toEqual([
      ["Plums falling", null],
      ["Pears bruise.", "block_b"],
    ]);
  });

  it("leaves IDs alone in a change from another tab", () => {
    const target = open("Apples ripen.");
    stamp(target, ["block_a"]);
    const first = target.state.doc.child(0);
    target.view.dispatch(
      target.state.tr
        .insert(first.nodeSize, first)
        .setMeta(ySyncPluginKey, { isChangeOrigin: true }),
    );

    expect(held(target)).toEqual([
      ["Apples ripen.", "block_a"],
      ["Apples ripen.", "block_a"],
    ]);
  });

  it("never writes an ID into the page's Markdown or HTML", () => {
    const target = open("# Title\nApples ripen.");
    stamp(target, ["block_a", "block_b"]);

    expect(docToNfm(target.getJSON() as never)).toBe("# Title\nApples ripen.");
    expect(target.getHTML()).not.toContain("block_");
  });

  it("never copies an ID into the clipboard, even from inside a callout or list", () => {
    for (const nfm of [
      '<callout icon="💡">\n\tInside text\n</callout>',
      "- First item\n- Second item",
    ]) {
      editor?.destroy();
      const target = open(nfm);
      const places = blockPlaces(target.state.doc);
      const ids = Object.fromEntries(
        places.map(({ path }) => [path, `block_${path}`]),
      );
      const { shape } = editorDocBlockIds(target.state.doc);
      expect(stampBlockIdentityIds(target, { shape, idsByPath: ids })).toBe(
        "stamped",
      );
      const heldIds = () =>
        blockPlaces(target.state.doc)
          .flatMap(({ node }) => blockIdentityIdOf(node) ?? [])
          .sort((a, b) => a.localeCompare(b));
      const before = heldIds();
      const inner = places.find(({ node }) => node.isTextblock);
      if (!inner) throw new Error("Expected the fixture to have text");
      target.commands.setTextSelection({
        from: inner.pos + 2,
        to: inner.pos + 5,
      });

      const { dom, slice } = target.view.serializeForClipboard(
        target.state.selection.content(),
      );
      expect(slice.openStart).toBeGreaterThan(1);
      expect(dom.innerHTML).not.toContain("block_");
      expect(dom.innerHTML).not.toContain(
        `${BLOCK_IDENTITY_ATTR}&quot;:&quot;`,
      );

      const length = target.state.doc.textContent.length;
      target.commands.setTextSelection(target.state.doc.content.size - 1);
      target.view.pasteHTML(dom.innerHTML);
      expect(target.state.doc.textContent.length).toBe(length + 3);
      expect(heldIds()).toEqual(before);
    }
  });

  it("keeps the IDs of whole blocks a drag carries, and of no block it cuts", () => {
    const target = open("Apples ripen.\nPears bruise.\nPlums fall.");
    stamp(target, ["block_a", "block_b", "block_c"]);
    target.commands.setTextSelection({ from: 3, to: textEnd(target, 2) - 2 });

    const { dom, slice } = target.view.serializeForClipboard(
      target.state.selection.content(),
    );
    const ids = (dragged: boolean) => {
      const { content } = pastedSlice(slice, dragged);
      return Array.from({ length: content.childCount }, (_, index) =>
        blockIdentityIdOf(content.child(index)),
      );
    };
    expect(dom.innerHTML).not.toContain("block_");
    expect(ids(true)).toEqual([null, "block_b", null]);
    expect(ids(false)).toEqual([null, null, null]);
  });

  it("moves a dragged block's ID with it", () => {
    const target = open("Apples ripen.\nPears bruise.\nPlums fall.");
    stamp(target, ["block_a", "block_b", "block_c"]);
    const from = target.state.doc.child(0).nodeSize;
    const to = from + target.state.doc.child(1).nodeSize;
    const dragged = pastedSlice(
      copiedSlice(target.state.doc.slice(from, to)),
      true,
    );
    const tr = target.state.tr.delete(from, to);
    target.view.dispatch(
      tr.replace(tr.doc.content.size, tr.doc.content.size, dragged),
    );

    expect(held(target)).toEqual([
      ["Apples ripen.", "block_a"],
      ["Plums fall.", "block_c"],
      ["Pears bruise.", "block_b"],
    ]);
  });

  it("stamps only a tree with the shape the IDs were read from, and never over an ID", () => {
    const target = open("Apples ripen.\nPears bruise.");
    const { shape } = editorDocBlockIds(target.state.doc);
    expect(
      stampBlockIdentityIds(target, {
        shape: "shape_other",
        idsByPath: { "0": "block_a" },
      }),
    ).toBe("mismatch");
    expect(
      stampBlockIdentityIds(target, { shape, idsByPath: { "0": "block_a" } }),
    ).toBe("stamped");
    expect(
      stampBlockIdentityIds(target, {
        shape,
        idsByPath: { "0": "block_z", "1": "block_a" },
      }),
    ).toBe("unchanged");

    expect(held(target)).toEqual([
      ["Apples ripen.", "block_a"],
      ["Pears bruise.", null],
    ]);
  });

  it("isn't undone by undo", () => {
    const target = open("Apples ripen.");
    target.view.dispatch(target.state.tr.insertText("!", textEnd(target, 0)));
    stamp(target, ["block_a"]);
    target.commands.undo();

    expect(held(target)).toEqual([["Apples ripen.", "block_a"]]);
  });
});
