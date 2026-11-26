// @vitest-environment happy-dom

import { getSchema } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Plugin } from "@tiptap/pm/state";
import {
  initProseMirrorDoc,
  updateYFragment,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { anchorTable, findAnchoredTable } from "./table-anchor";
import { findTableByIndex, tableIndexAt } from "./table-commands";
import { createVisualEditorExtensions } from "./VisualEditor";

const schema = getSchema(createVisualEditorExtensions());

function paragraph(text: string) {
  return schema.node("paragraph", null, schema.text(text));
}

function table(rows: string[][]) {
  return schema.node(
    "table",
    null,
    rows.map((row) =>
      schema.node(
        "tableRow",
        null,
        row.map((text) => schema.node("tableCell", null, paragraph(text))),
      ),
    ),
  );
}

function livePage(...blocks: ProseMirrorNode[]) {
  const ydoc = new Y.Doc();
  const page = ydoc.getXmlFragment("default");
  updateYFragment(ydoc, page, schema.node("doc", null, blocks), {
    mapping: new Map(),
    isOMark: new Map(),
  });
  const read = () => {
    const { doc, mapping } = initProseMirrorDoc(page, schema);
    const binding = { type: page, mapping };
    return EditorState.create({
      doc,
      plugins: [
        new Plugin({
          key: ySyncPluginKey,
          state: { init: () => ({ binding }), apply: (_tr, value) => value },
        }),
      ],
    });
  };
  const liveTable = () => page.get(1) as Y.XmlElement;
  return { page, read, liveTable };
}

function firstTable(state: EditorState) {
  const target = findTableByIndex(state.doc, 0);
  if (!target) throw new Error("The page has no table");
  return target;
}

function setSpan(
  row: Y.XmlElement,
  index: number,
  name: "rowspan" | "colspan",
  value: number,
) {
  const cell = row.get(index) as unknown as Y.XmlElement<
    Record<string, number>
  >;
  cell.setAttribute(name, value);
}

describe("anchorTable", () => {
  it("finds the table again after a collaborator types in it and adds a table above it", () => {
    const live = livePage(
      paragraph("Before"),
      table([
        ["A", "B"],
        ["C", "D"],
      ]),
    );
    const before = live.read();
    const anchor = anchorTable(before, firstTable(before));
    expect(anchor.live?.table).toBe(live.liveTable());

    live.page.insert(1, [live.liveTable().clone()]);
    const row = (live.page.get(2) as Y.XmlElement).get(0) as Y.XmlElement;
    const cell = row.get(1) as Y.XmlElement;
    const text = (cell.get(0) as Y.XmlElement).get(0) as Y.XmlText;
    text.insert(1, "!");

    const state = live.read();
    const found = findAnchoredTable(state, anchor);
    expect(found?.node.textContent).toBe("AB!CD");
    expect(tableIndexAt(state.doc, found?.pos ?? -1)).toBe(1);
  });

  it("lets go of the table once a collaborator adds a row to it, or a cell", () => {
    const live = livePage(
      paragraph("Before"),
      table([
        ["A", "B"],
        ["C", "D"],
      ]),
    );
    const state = live.read();
    const anchor = anchorTable(state, firstTable(state));

    const row = live.liveTable().get(1) as Y.XmlElement;
    live.liveTable().insert(0, [row.clone()]);
    expect(findAnchoredTable(live.read(), anchor)).toBeNull();

    const other = livePage(
      paragraph("Before"),
      table([
        ["A", "B"],
        ["C", "D"],
      ]),
    );
    const otherState = other.read();
    const otherAnchor = anchorTable(otherState, firstTable(otherState));
    const otherRow = other.liveTable().get(1) as Y.XmlElement;
    otherRow.insert(1, [(otherRow.get(0) as Y.XmlElement).clone()]);
    expect(findAnchoredTable(other.read(), otherAnchor)).toBeNull();
  });

  it("lets go of the table once a collaborator changes how far a cell spans, with no cell added or removed", () => {
    const live = livePage(
      paragraph("Before"),
      table([
        ["A", "B"],
        ["C", "D"],
      ]),
    );
    const state = live.read();
    const anchor = anchorTable(state, firstTable(state));

    setSpan(live.liveTable().get(0) as Y.XmlElement, 0, "rowspan", 2);
    const changed = live.read();
    expect(firstTable(changed).node.firstChild?.firstChild?.attrs.rowspan).toBe(
      2,
    );
    expect(findAnchoredTable(changed, anchor)).toBeNull();

    const other = livePage(
      paragraph("Before"),
      table([
        ["A", "B"],
        ["C", "D"],
      ]),
    );
    const otherState = other.read();
    const otherAnchor = anchorTable(otherState, firstTable(otherState));
    setSpan(other.liveTable().get(1) as Y.XmlElement, 1, "colspan", 2);
    expect(findAnchoredTable(other.read(), otherAnchor)).toBeNull();
  });

  it("lets go of the table once a collaborator removes it", () => {
    const live = livePage(paragraph("Before"), table([["A"]]));
    const state = live.read();
    const anchor = anchorTable(state, firstTable(state));

    live.page.delete(1, 1);
    expect(findAnchoredTable(live.read(), anchor)).toBeNull();
  });

  it("holds without a live copy only while the page is unchanged", () => {
    const state = EditorState.create({
      doc: schema.node("doc", null, [paragraph("Before"), table([["A"]])]),
    });
    const anchor = anchorTable(state, firstTable(state));
    expect(anchor.live).toBeNull();
    expect(findAnchoredTable(state, anchor)?.pos).toBe(firstTable(state).pos);

    const typed = state.apply(state.tr.insertText("!", 1));
    expect(findAnchoredTable(typed, anchor)).toBeNull();
  });
});
