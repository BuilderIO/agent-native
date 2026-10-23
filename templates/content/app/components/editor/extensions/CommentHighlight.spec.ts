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
    video: {
      group: "block",
      atom: true,
      attrs: { src: { default: null }, blockId: { default: null } },
    },
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
    // Separate edits on either side of the quote leave its text alone.
    expect(
      highlighted(swap("New intro.", "ships Friday pm.", "Added.")),
    ).toEqual(["Friday pm"]);
    expect(
      highlighted(swap("Intro.", "Team ships Friday pm, always.")),
    ).toEqual(["Friday pm"]);
    expect(highlighted(swap("Intro.", "ships on Friday pm."))).toEqual([
      "Friday pm",
    ]);
    expect(highlighted(swap("Intro.", "ships Friday pm now."))).toEqual([
      "Friday pm",
    ]);
    // Nothing is left of a quote rewritten from end to end, and a
    // collaborator's rewrite does not re-anchor it.
    expect(highlighted(swap("Intro.", "X."))).toEqual([]);
    expect(highlighted(swap("Intro.", "ships XYZ."))).toEqual([]);
    // Typing over the whole quote leaves nothing of it either.
    expect(
      highlighted(state.apply(state.tr.insertText("XYZ", 15, 24))),
    ).toEqual([]);
    expect(
      highlighted(
        state.apply(state.tr.insertText("X", 15, 20).insertText("YZ", 16, 20)),
      ),
    ).toEqual([]);
    // A copy of the quote added ahead of it does not take its highlight.
    expect(
      commentHighlightKey.getState(
        swap("Intro.", "Friday pm ships Friday pm, always."),
      )!.specs,
    ).toEqual([{ threadId: "t1", from: 25, to: 34 }]);
    // Deleting the quote while editing next to it drops the highlight.
    expect(highlighted(swap("Intro.", "Ships."))).toEqual([]);
  });

  it("drops a highlight whose text a rewrite shares only letters with", () => {
    let state = EditorState.create({
      doc: doc("Hand edits are gold."),
      plugins: [createCommentHighlightPlugin()],
    });
    state = state.apply(
      state.tr.setMeta(commentHighlightKey, {
        specs: [{ threadId: "t1", from: 1, to: 20 }],
      }),
    );

    const rewritten = state.apply(
      state.tr.replaceWith(
        0,
        state.doc.content.size,
        doc("Something else entirely here.").content,
      ),
    );
    expect(commentHighlightKey.getState(rewritten)!.specs).toEqual([]);
  });

  it("drops a highlight whose word was deleted ahead of an identical one", () => {
    let state = EditorState.create({
      doc: doc("alpha alpha"),
      // The quote is still in the document, as the copy that is left.
      plugins: [
        createCommentHighlightPlugin({ findQuote: () => ({ from: 1, to: 6 }) }),
      ],
    });
    state = state.apply(
      state.tr.setMeta(commentHighlightKey, {
        specs: [{ threadId: "t1", from: 1, to: 6 }],
      }),
    );

    const deleted = state.apply(state.tr.delete(1, 7));
    expect(commentHighlightKey.getState(deleted)!.specs).toEqual([]);
  });

  it("follows its text when a swap moves it into a quote", () => {
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
    expect(commentHighlightKey.getState(moved)!.specs).toEqual([
      { threadId: "t1", from: 2, to: 7 },
    ]);
    expect(moved.doc.textBetween(2, 7)).toBe("alpha");
  });

  describe("a thread on a whole block", () => {
    const paragraph = (text: string) =>
      schema.node("paragraph", null, schema.text(text));
    const video = (blockId: string) =>
      schema.node("video", { src: "https://example.com/a.mp4", blockId });
    const start = () => {
      // "Intro" is 1-6; the video sits at 7.
      let state = EditorState.create({
        doc: schema.node("doc", null, [paragraph("Intro"), video("video-1")]),
        plugins: [createCommentHighlightPlugin()],
      });
      state = state.apply(
        state.tr.setMeta(commentHighlightKey, {
          specs: [{ threadId: "v", from: 7, to: 8, blockId: "video-1" }],
          activeId: "v",
        }),
      );
      return state;
    };

    it("marks the block itself, carrying its thread", () => {
      const state = start();
      const [decoration] = commentHighlightKey
        .getState(state)!
        .decorations.find();
      expect(decoration).toMatchObject({ from: 7, to: 8 });
      expect((decoration as any).type.attrs).toEqual({
        class:
          "comment-highlight comment-highlight--block comment-highlight--active",
        "data-comment-block-threads": "v",
      });
    });

    it("names every thread on the block on one mark", () => {
      let state = start();
      state = state.apply(
        state.tr.setMeta(commentHighlightKey, {
          specs: [
            { threadId: "v", from: 7, to: 8, blockId: "video-1" },
            { threadId: "w", from: 7, to: 8, blockId: "video-1" },
          ],
          activeId: null,
          hoveredId: "w",
        }),
      );
      const decorations = commentHighlightKey
        .getState(state)!
        .decorations.find();
      expect(decorations).toHaveLength(1);
      expect((decorations[0] as any).type.attrs).toEqual({
        class:
          "comment-highlight comment-highlight--block comment-highlight--hovered",
        "data-comment-block-threads": "v w",
      });
    });

    it("follows the block through edits and swaps, and goes with it", () => {
      let state = start();
      state = state.apply(state.tr.insertText("New ", 1));
      expect(commentHighlightKey.getState(state)!.specs).toEqual([
        { threadId: "v", from: 11, to: 12, blockId: "video-1" },
      ]);

      const swapped = state.apply(
        state.tr.replaceWith(0, state.doc.content.size, [
          video("video-1"),
          paragraph("New intro"),
        ]),
      );
      expect(commentHighlightKey.getState(swapped)!.specs).toEqual([
        { threadId: "v", from: 0, to: 1, blockId: "video-1" },
      ]);

      const deleted = state.apply(state.tr.delete(11, 12));
      expect(commentHighlightKey.getState(deleted)!.specs).toEqual([]);
    });

    it("marks a block waiting for its first comment", () => {
      let state = EditorState.create({
        doc: schema.node("doc", null, [paragraph("Intro"), video("video-1")]),
        plugins: [createCommentHighlightPlugin()],
      });
      state = state.apply(
        state.tr.setMeta(commentHighlightKey, {
          pending: { from: 7, to: 8, blockId: "video-1" },
        }),
      );
      const [decoration] = commentHighlightKey
        .getState(state)!
        .decorations.find();
      expect(decoration).toMatchObject({ from: 7, to: 8 });
      expect((decoration as any).type.attrs.class).toBe(
        "comment-highlight comment-highlight--block comment-highlight--pending",
      );
    });
  });
});
