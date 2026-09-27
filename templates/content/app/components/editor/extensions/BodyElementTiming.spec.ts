import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it } from "vitest";

import {
  CONTENT_BODY_DOM_MARK,
  CONTENT_BODY_ELEMENT_TIMING,
} from "@/lib/startup-timing";

import { createBodyElementTimingPlugin } from "./BodyElementTiming";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
  },
  marks: {},
});

function doc(...texts: string[]): ProseMirrorNode {
  return schema.node(
    "doc",
    null,
    texts.map((text) =>
      schema.node("paragraph", null, text ? schema.text(text) : undefined),
    ),
  );
}

function timedBlocks(state: EditorState) {
  const plugin = state.plugins[0];
  const decorations = plugin.props.decorations!.call(plugin, state) as any;
  return decorations.find().map((decoration: any) => ({
    from: decoration.from,
    attribute: decoration.type.attrs.elementtiming,
  }));
}

afterEach(() => {
  performance.clearMarks(CONTENT_BODY_DOM_MARK);
});

describe("BodyElementTiming", () => {
  it("tags only the first non-empty text block", () => {
    const state = EditorState.create({
      doc: doc("", "First words", "Later words"),
      plugins: [createBodyElementTimingPlugin("doc-1")],
    });

    expect(timedBlocks(state)).toEqual([
      { from: 2, attribute: CONTENT_BODY_ELEMENT_TIMING },
    ]);
  });

  it("tags nothing while the body is empty", () => {
    const state = EditorState.create({
      doc: doc("", ""),
      plugins: [createBodyElementTimingPlugin("doc-1")],
    });

    expect(timedBlocks(state)).toEqual([]);
  });

  it("marks the first DOM commit with text once per editor", () => {
    const plugin = createBodyElementTimingPlugin("doc-1");
    const empty = EditorState.create({ doc: doc(""), plugins: [plugin] });
    const view = { state: empty } as unknown as EditorView;
    const pluginView = plugin.spec.view!(view);

    expect(performance.getEntriesByName(CONTENT_BODY_DOM_MARK)).toHaveLength(0);

    (view as { state: EditorState }).state = EditorState.create({
      doc: doc("Body"),
      plugins: [plugin],
    });
    pluginView.update!(view, empty);
    pluginView.update!(view, empty);

    const marks = performance.getEntriesByName(
      CONTENT_BODY_DOM_MARK,
    ) as PerformanceMark[];
    expect(marks).toHaveLength(1);
    expect(marks[0].detail).toEqual({ documentId: "doc-1" });
  });
});
