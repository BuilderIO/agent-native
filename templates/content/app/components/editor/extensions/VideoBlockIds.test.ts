// @vitest-environment happy-dom

import { derivedVideoBlockId } from "@shared/comment-block-anchor";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, it } from "vitest";

import { createVisualEditorExtensions } from "../VisualEditor";

const A = "https://example.com/a.mp4";
const B = "https://example.com/b.mp4";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(nfm: string, canMutateMedia?: () => boolean) {
  editor = new Editor({
    extensions: createVisualEditorExtensions({ canMutateMedia }),
    content: nfmToDoc(nfm),
  });
  return editor;
}

function videoIds(target: Editor) {
  const ids: Array<string | null> = [];
  target.state.doc.descendants((node) => {
    if (node.type.name === "video") ids.push(node.attrs.blockId ?? null);
  });
  return ids;
}

function typeAtEnd(target: Editor, text: string) {
  target.view.dispatch(
    target.state.tr.insertText(text, target.state.doc.content.size - 1),
  );
}

function videoPos(target: Editor, index: number) {
  const found: number[] = [];
  target.state.doc.descendants((node, pos) => {
    if (node.type.name === "video") found.push(pos);
  });
  return found[index];
}

describe("video block ids", () => {
  it("gives an inserted video an id", () => {
    const target = open("Intro");
    target.commands.insertContentAt(0, { type: "video", attrs: { src: A } });
    const [id] = videoIds(target);
    expect(id).toMatch(/^video-[a-z0-9]{8}$/);
    expect(docToNfm(target.getJSON() as never)).toContain(`id="${id}"`);
  });

  it("gives a video saved without an id the id every reader derives for it", () => {
    const target = open(`<video src="${A}"></video>\nIntro`);
    expect(videoIds(target)).toEqual([null]);
    typeAtEnd(target, "!");
    expect(videoIds(target)).toEqual([derivedVideoBlockId(A, 0)]);
  });

  it("keeps the original's id when a copy is pasted above or below it", () => {
    const target = open(
      `Intro\n<video src="${A}" id="video-original"></video>`,
    );
    const original = target.state.doc.nodeAt(videoPos(target, 0))!.toJSON();

    target.commands.insertContentAt(0, original);
    let ids = videoIds(target);
    expect(ids[1]).toBe("video-original");
    expect(ids[0]).toMatch(/^video-/);
    expect(ids[0]).not.toBe("video-original");

    target.commands.insertContentAt(target.state.doc.content.size, original);
    ids = videoIds(target);
    expect(ids[1]).toBe("video-original");
    expect(new Set(ids).size).toBe(3);
  });

  it("keeps ids through undo and redo", () => {
    const target = open("Intro");
    target.commands.insertContentAt(0, { type: "video", attrs: { src: B } });
    const [id] = videoIds(target);
    typeAtEnd(target, " more");
    target.commands.undo();
    expect(videoIds(target)).toEqual([id]);
    target.commands.undo();
    expect(videoIds(target)).toEqual([]);
    target.commands.redo();
    expect(videoIds(target)).toEqual([id]);
  });

  it("writes no id while media can't be changed, as when suggesting", () => {
    const target = open(`<video src="${A}"></video>\nIntro`, () => false);
    typeAtEnd(target, "!");
    expect(videoIds(target)).toEqual([null]);
  });

  it("leaves another tab's change for that tab to number", () => {
    const target = open(`<video src="${A}"></video>\nIntro`);
    target.view.dispatch(
      target.state.tr
        .insertText("!", target.state.doc.content.size - 1)
        .setMeta(ySyncPluginKey, { isChangeOrigin: true }),
    );
    expect(videoIds(target)).toEqual([null]);
  });

  it("leaves another tab's copy alone while this tab tidies up after it", () => {
    const target = open(`Intro
<video src="${A}" id="video-original"></video>`);
    const original = target.state.doc.nodeAt(videoPos(target, 0))!;
    const end = target.state.doc.content.size;
    target.view.dispatch(
      target.state.tr
        .insert(end, original)
        .setMeta(ySyncPluginKey, { isChangeOrigin: true }),
    );
    expect(
      target.state.doc.lastChild?.type.name,
      "a paragraph after the copy",
    ).toBe("paragraph");
    expect(videoIds(target)).toEqual(["video-original", "video-original"]);
  });
});
