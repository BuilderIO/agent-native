// @vitest-environment happy-dom

import { BLOCK_IDENTITY_ATTR } from "@shared/block-identity-ids";
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
