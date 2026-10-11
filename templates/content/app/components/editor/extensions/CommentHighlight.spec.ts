import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import {
  commentHighlightKey,
  createCommentHighlightPlugin,
} from "./CommentHighlight";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    blockquote: { group: "block", content: "block+" },
    text: {},
  },
  marks: {},
});

function doc(text: string): ProseMirrorNode {
  return schema.node("doc", null, [
    schema.node("paragraph", null, schema.text(text)),
  ]);
}

function highlightClasses(state: EditorState) {
  return Object.fromEntries(
    commentHighlightKey
      .getState(state)!
      .decorations.find()
      .map((decoration) => {
        const attributes = (decoration as any).type.attrs as Record<
          string,
          string
        >;
        return [attributes["data-comment-thread"], attributes.class];
      }),
  );
}

describe("CommentHighlight", () => {
  it("keeps selection stronger than hover and clears hover independently", () => {
    let state = EditorState.create({
      doc: doc("alpha beta"),
      plugins: [createCommentHighlightPlugin()],
    });
    state = state.apply(
      state.tr.setMeta(commentHighlightKey, {
        specs: [
          { threadId: "selected", from: 1, to: 6 },
          { threadId: "hovered", from: 7, to: 11 },
        ],
        activeId: "selected",
        hoveredId: "hovered",
      }),
    );

    expect(highlightClasses(state)).toEqual({
      selected: "comment-highlight comment-highlight--active",
      hovered: "comment-highlight comment-highlight--hovered",
    });

    state = state.apply(
      state.tr.setMeta(commentHighlightKey, { hoveredId: "selected" }),
    );
    expect(highlightClasses(state).selected).toBe(
      "comment-highlight comment-highlight--active",
    );

    state = state.apply(
      state.tr.setMeta(commentHighlightKey, { hoveredId: null }),
    );
    expect(commentHighlightKey.getState(state)).toMatchObject({
      activeId: "selected",
      hoveredId: null,
    });
    expect(highlightClasses(state)).toEqual({
      selected: "comment-highlight comment-highlight--active",
      hovered: "comment-highlight",
    });
  });

  it("survives an identical document swap but not deletion of its text", () => {
    let state = EditorState.create({
      doc: doc("alpha beta"),
      plugins: [createCommentHighlightPlugin()],
    });
    state = state.apply(
      state.tr.setMeta(commentHighlightKey, {
        specs: [{ threadId: "t1", from: 7, to: 11 }],
      }),
    );

    const swapped = state.apply(
      state.tr.replaceWith(
        0,
        state.doc.content.size,
        doc("alpha beta").content,
      ),
    );
    expect(commentHighlightKey.getState(swapped)!.specs).toEqual([
      { threadId: "t1", from: 7, to: 11 },
    ]);

    const deleted = state.apply(state.tr.delete(6, 11));
    expect(commentHighlightKey.getState(deleted)!.specs).toEqual([]);
  });

  it("follows the changed text when a collaborative swap rewrites it", () => {
    const paragraphs = (...texts: string[]) =>
      texts.map((text) => schema.node("paragraph", null, schema.text(text)));
    let state = EditorState.create({
      doc: schema.node("doc", null, paragraphs("Intro.", "ships Friday pm.")),
      plugins: [createCommentHighlightPlugin()],
    });
    // "Friday pm" in the second paragraph.
    state = state.apply(
      state.tr.setMeta(commentHighlightKey, {
        specs: [{ threadId: "t1", from: 15, to: 24 }],
      }),
    );
    const swap = (...texts: string[]) =>
      state.apply(
        state.tr.replaceWith(0, state.doc.content.size, paragraphs(...texts)),
      );
    const highlighted = (next: EditorState) =>
      commentHighlightKey
        .getState(next)!
        .specs.map(({ from, to }) => next.doc.textBetween(from, to));

    expect(highlighted(swap("Intro.", "ships Friday at 2 pm."))).toEqual([
      "Friday at 2 pm",
    ]);
    expect(highlighted(swap("Intro.", "ships Friday 2 pm."))).toEqual([
      "Friday 2 pm",
    ]);
    expect(highlighted(swap("New intro.", "ships Friday pm."))).toEqual([
      "Friday pm",
    ]);
    expect(highlighted(swap("Intro.", "We ship Fri."))).toEqual([]);
  });

  it("drops a highlight whose word was deleted ahead of an identical one", () => {
    let state = EditorState.create({
      doc: doc("alpha alpha"),
      plugins: [createCommentHighlightPlugin()],
    });
    state = state.apply(
      state.tr.setMeta(commentHighlightKey, {
        specs: [{ threadId: "t1", from: 1, to: 6 }],
      }),
    );

    const deleted = state.apply(state.tr.delete(1, 7));
    expect(commentHighlightKey.getState(deleted)!.specs).toEqual([]);
  });

  it("drops a highlight when a swap keeps the text but moves it into a quote", () => {
    const paragraph = (text: string) =>
      schema.node("paragraph", null, schema.text(text));
    const quoted = (text: string) =>
      schema.node("blockquote", null, [paragraph(text)]);
    let state = EditorState.create({
      doc: schema.node("doc", null, [paragraph("alpha"), quoted("beta")]),
      plugins: [createCommentHighlightPlugin()],
    });
    state = state.apply(
      state.tr.setMeta(commentHighlightKey, {
        specs: [{ threadId: "t1", from: 1, to: 6 }],
      }),
    );

    const moved = state.apply(
      state.tr.replaceWith(0, state.doc.content.size, [
        quoted("alpha"),
        paragraph("beta"),
      ]),
    );
    expect(commentHighlightKey.getState(moved)!.specs).toEqual([]);
  });
});
