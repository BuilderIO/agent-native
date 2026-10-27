// @vitest-environment happy-dom

import { derivedVideoBlockId } from "@shared/comment-block-anchor";
import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { prosemirrorToYDoc, ySyncPluginKey } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, it } from "vitest";

import { assertNoNewlySharedVideoIds } from "../../../../server/lib/video-block-ids";
import { commentAnchorBlockList } from "../comment-block-anchors";
import { createVisualEditorExtensions } from "../VisualEditor";

function found<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected the fixture to have it");
  return value;
}

const A = "https://example.com/a.mp4";
const B = "https://example.com/b.mp4";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(nfm: string, canMutateMedia?: () => boolean) {
  editor = new Editor({
    extensions: createVisualEditorExtensions(
      canMutateMedia ? { canMutateMedia } : {},
    ),
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
  const positions: number[] = [];
  target.state.doc.descendants((node, pos) => {
    if (node.type.name === "video") positions.push(pos);
  });
  return found(positions[index]);
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

  it("writes down the derived id when the first edit resizes the video", () => {
    const target = open(`<video src="${A}"></video>\nIntro`);
    const pos = videoPos(target, 0);
    const { attrs } = found(target.state.doc.nodeAt(pos));
    target.view.dispatch(
      target.state.tr.setNodeMarkup(pos, undefined, { ...attrs, width: 320 }),
    );
    expect(videoIds(target)).toEqual([derivedVideoBlockId(A, 0)]);
  });

  it("keeps each video's derived id when the first edit moves one", () => {
    const target = open(
      `<video src="${A}"></video>\n<video src="${A}"></video>\nIntro`,
    );
    const pos = videoPos(target, 0);
    const first = found(target.state.doc.nodeAt(pos));
    const tr = target.state.tr.delete(pos, pos + first.nodeSize);
    target.view.dispatch(tr.insert(tr.doc.content.size, first));
    expect(videoIds(target)).toEqual([
      derivedVideoBlockId(A, 1),
      derivedVideoBlockId(A, 0),
    ]);
  });

  it("keeps a resized video's id when the same change deletes another with its source", () => {
    const target = open(
      `<video src="${A}"></video>\n<video src="${A}"></video>\nIntro`,
    );
    const first = found(target.state.doc.nodeAt(videoPos(target, 0)));
    const tr = target.state.tr.delete(0, first.nodeSize);
    const { attrs } = found(tr.doc.nodeAt(0));
    target.view.dispatch(
      tr.setNodeMarkup(0, undefined, { ...attrs, width: 320 }),
    );
    expect(videoIds(target)).toEqual([derivedVideoBlockId(A, 1)]);
  });

  it("keeps a moved video's id from a new video with its source", () => {
    const target = open(`<video src="${A}"></video>\nIntro`);
    const moved = found(target.state.doc.nodeAt(videoPos(target, 0)));
    const added = found(target.schema.nodes.video).create({ src: A });
    const tr = target.state.tr.delete(0, moved.nodeSize).insert(0, added);
    target.view.dispatch(tr.insert(tr.doc.content.size, moved));
    const ids = videoIds(target);
    expect(ids[1]).toBe(derivedVideoBlockId(A, 0));
    expect(ids[0]).toMatch(/^video-/);
    expect(ids[0]).not.toBe(derivedVideoBlockId(A, 0));
  });

  it("keeps the original's id when a copy is pasted above or below it", () => {
    const target = open(
      `Intro\n<video src="${A}" id="video-original"></video>`,
    );
    const original = found(
      target.state.doc.nodeAt(videoPos(target, 0)),
    ).toJSON();

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

  it("leaves an id two videos share on both, rather than keeping it on the first", () => {
    const target = open(
      `<video src="${B}" id="video-shared"></video>
<video src="${A}" id="video-shared"></video>
Intro`,
    );
    typeAtEnd(target, "!");
    expect(videoIds(target)).toEqual(["video-shared", "video-shared"]);
  });

  it("gives a copy of a video that shares an id a new one, and leaves the pair theirs", () => {
    const pair = `<video src="${B}" id="video-shared"></video>
<video src="${A}" id="video-shared"></video>
Intro`;
    const target = open(pair);
    const copy = found(target.state.doc.nodeAt(videoPos(target, 1))).toJSON();
    target.commands.insertContentAt(target.state.doc.content.size, copy);
    target.commands.insertContentAt(0, copy);
    expect(
      () =>
        assertNoNewlySharedVideoIds(pair, docToNfm(target.getJSON() as never)),
      "the page still saves",
    ).not.toThrow();
    const ids = videoIds(target);
    expect(ids.slice(1, 3)).toEqual(["video-shared", "video-shared"]);
    expect(ids[0]).toMatch(/^video-/);
    expect(ids[3]).toMatch(/^video-/);
    expect(new Set(ids).size).toBe(3);
  });

  it("keeps a pair's id on the one moved or resized", () => {
    const target = open(`<video src="${B}" id="video-shared"></video>
<video src="${A}" id="video-shared"></video>
Intro`);
    const moved = found(target.state.doc.nodeAt(videoPos(target, 0)));
    const tr = target.state.tr.delete(0, moved.nodeSize);
    target.view.dispatch(tr.insert(tr.doc.content.size, moved));
    expect(videoIds(target)).toEqual(["video-shared", "video-shared"]);

    const pos = videoPos(target, 1);
    const { attrs } = found(target.state.doc.nodeAt(pos));
    target.view.dispatch(
      target.state.tr.setNodeMarkup(pos, undefined, { ...attrs, width: 320 }),
    );
    expect(videoIds(target)).toEqual(["video-shared", "video-shared"]);
  });

  it("gives a video saved without an id a new one when another video saved the id it derives", () => {
    const derived = derivedVideoBlockId(A, 0);
    const target = open(
      `<video src="${A}"></video>
<video src="${A}" id="${derived}"></video>
Intro`,
    );
    typeAtEnd(target, "!");
    const [unsaved, saved] = videoIds(target);
    expect(saved).toBe(derived);
    expect(unsaved).toMatch(/^video-/);
    expect(unsaved).not.toBe(derived);
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

  it("keeps the id every reader derives when a shared page's first edit is undone", () => {
    const seed = open(`<video src="${A}"></video>\nIntro`);
    const ydoc = prosemirrorToYDoc(seed.state.doc, "default");
    seed.destroy();
    const target = (editor = new Editor({
      extensions: createVisualEditorExtensions({ ydoc }),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    }));
    const derived = derivedVideoBlockId(A, 0);
    typeAtEnd(target, "!");
    expect(videoIds(target)).toEqual([derived]);
    target.commands.undo();
    expect(
      commentAnchorBlockList(target.state.doc).map(({ blockId }) => blockId),
    ).toEqual([derived]);
    target.commands.redo();
    expect(videoIds(target)).toEqual([derived]);
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
    const original = found(target.state.doc.nodeAt(videoPos(target, 0)));
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
