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
});
