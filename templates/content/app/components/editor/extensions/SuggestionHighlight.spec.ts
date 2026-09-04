// @vitest-environment jsdom

import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import {
  createSuggestionHighlightPlugin,
  suggestionHighlightKey,
  type SuggestionHighlightSpec,
} from "./SuggestionHighlight";

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
    schema.node("paragraph", null, text ? schema.text(text) : undefined),
  ]);
}

function state(text = "Before after"): EditorState {
  return EditorState.create({
    doc: doc(text),
    plugins: [createSuggestionHighlightPlugin()],
  });
}

function setSpecs(
  editorState: EditorState,
  specs: SuggestionHighlightSpec[],
  activeId: string | null = null,
): EditorState {
  return editorState.apply(
    editorState.tr.setMeta(suggestionHighlightKey, { specs, activeId }),
  );
}

describe("SuggestionHighlight", () => {
  it("renders deletion, replacement, insertion, block, and mark decorations without document marks", () => {
    const editorState = setSpecs(
      state(),
      [
        { suggestionId: "delete", kind: "delete", from: 1, to: 7 },
        {
          suggestionId: "replace",
          kind: "replace",
          from: 8,
          to: 13,
          insertedText: "new",
        },
        {
          suggestionId: "insert",
          kind: "insert",
          from: 1,
          to: 1,
          insertedText: "added",
        },
        {
          suggestionId: "block",
          kind: "add_block",
          from: 13,
          to: 13,
          insertedText: "New block",
        },
        { suggestionId: "mark", kind: "mark", from: 1, to: 7 },
      ],
      "replace",
    );
    const decorations = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find();

    expect(editorState.doc.textContent).toBe("Before after");
    expect(decorations).toHaveLength(6);
    expect(
      decorations.find((deco) => deco.spec.key === "replace:inserted")?.from,
    ).toBe(13);
    expect(
      decorations.find((deco) => deco.spec.key === "insert:inserted")?.from,
    ).toBe(1);
    const deleted = decorations.find(
      (deco) => (deco as any).type.attrs?.class === "suggestion-delete",
    ) as any;
    const changed = decorations.find(
      (deco) => (deco as any).type.attrs?.class === "suggestion-change",
    ) as any;
    expect(deleted.type.attrs).toMatchObject({
      class: "suggestion-delete",
      "data-suggestion-id": "delete",
      role: "button",
      tabindex: "0",
    });
    expect(changed.type.attrs).toMatchObject({
      class: "suggestion-change",
      "data-suggestion-id": "mark",
    });
    const replacement = decorations.find(
      (deco) => deco.spec.key === "replace:inserted",
    ) as any;
    expect(replacement.type.toDOM().className).toContain(
      "suggestion-highlight--active",
    );
  });

  it("maps persisted ranges across document transactions and preserves stable ids", () => {
    let editorState = setSpecs(state("Hello world"), [
      { suggestionId: "stable", kind: "delete", from: 7, to: 12 },
      {
        suggestionId: "insert",
        kind: "insert",
        from: 6,
        to: 6,
        insertedText: "brave ",
      },
    ]);
    editorState = editorState.apply(editorState.tr.insertText("big ", 1));
    const highlight = suggestionHighlightKey.getState(editorState)!;

    expect(highlight.specs).toEqual([
      { suggestionId: "stable", kind: "delete", from: 11, to: 16 },
      {
        suggestionId: "insert",
        kind: "insert",
        from: 10,
        to: 10,
        insertedText: "brave ",
      },
    ]);
  });

  it("clamps invalid ranges and keeps widget proposal text DOM-safe", () => {
    const editorState = setSpecs(state("Safe"), [
      { suggestionId: "bad", kind: "delete", from: -10, to: 99 },
      {
        suggestionId: "safe",
        kind: "insert",
        from: 999,
        to: 999,
        insertedText: "<img src=x>",
      },
    ]);
    const decorations = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find();
    const widget = decorations.find(
      (deco) => deco.spec.key === "safe:inserted",
    )!;
    const dom = (widget as any).type.toDOM();

    expect(
      decorations.find(
        (deco) => (deco as any).type.attrs?.["data-suggestion-id"] === "bad",
      )?.from,
    ).toBe(0);
    expect(widget.from).toBe(editorState.doc.content.size);
    expect(dom.textContent).toBe("<img src=x>");
    expect(dom.querySelector("img")).toBeNull();
    expect(dom.getAttribute("data-suggestion-id")).toBe("safe");
  });

  it("renders draft deletions as keyboard-focusable deletion widgets", () => {
    const editorState = setSpecs(state("Keep this"), [
      {
        suggestionId: "draft-delete",
        kind: "delete",
        from: 5,
        to: 5,
        deletedText: "removed",
      },
    ]);
    const decoration = suggestionHighlightKey
      .getState(editorState)!
      .decorations.find()[0] as any;
    const dom = decoration.type.toDOM();

    expect(dom.className).toContain("suggestion-delete-widget");
    expect(dom.textContent).toBe("removed");
    expect(dom.getAttribute("data-suggestion-id")).toBe("draft-delete");
  });
});
