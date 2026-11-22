// @vitest-environment happy-dom

import { tableCollectionSeedSchema } from "@shared/table-collection-seed";
import { getSchema } from "@tiptap/core";
import { history, undo, undoDepth } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Plugin, type Transaction } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import {
  initProseMirrorDoc,
  updateYFragment,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  collectionTableContent,
  findInlineCollection,
  followTable,
  replaceBlockAsOneUndoStep,
  seedFitsCollection,
  tableCollectionSeed,
  tableFitsCollection,
} from "./table-collection";
import { findTableByIndex, getTableHeaders } from "./table-commands";
import { createVisualEditorExtensions } from "./VisualEditor";

const schema = getSchema(createVisualEditorExtensions());

function cell(spec: string, attrs: Record<string, unknown> = {}) {
  const header = spec.startsWith("h:");
  const text = header ? spec.slice(2) : spec;
  return schema.node(
    header ? "tableHeader" : "tableCell",
    attrs,
    schema.node("paragraph", null, text ? schema.text(text) : undefined),
  );
}

function table(rows: (string | ProseMirrorNode)[][]) {
  return schema.node(
    "table",
    null,
    rows.map((row) =>
      schema.node(
        "tableRow",
        null,
        row.map((spec) => (typeof spec === "string" ? cell(spec) : spec)),
      ),
    ),
  );
}

describe("tableCollectionSeed", () => {
  it("titles rows by the first column and names properties by the header row", () => {
    const seed = tableCollectionSeed(
      table([
        ["h:Task", "h:Owner", "h:Due"],
        ["Write brief", "Ana", "Monday"],
        ["Review", "", "Friday"],
      ]),
    );
    expect(seed).toEqual({
      properties: ["Owner", "Due"],
      rows: [
        ["Write brief", "Ana", "Monday"],
        ["Review", "", "Friday"],
      ],
    });
    expect(tableCollectionSeedSchema.parse(seed)).toEqual(seed);
  });

  it("keeps every row and names properties by column without a header row", () => {
    const seed = tableCollectionSeed(
      table([
        ["Alpha", "1"],
        ["Beta", "2"],
      ]),
    );
    expect(seed).toEqual({
      properties: ["Column 2"],
      rows: [
        ["Alpha", "1"],
        ["Beta", "2"],
      ],
    });
  });

  it("names a blank header for its column and tells repeated names apart", () => {
    const seed = tableCollectionSeed(
      table([
        ["h:Name", "h:", "h:Notes", "h:notes"],
        ["One", "a", "b", "c"],
      ]),
    );
    expect(seed.properties).toEqual(["Column 2", "Notes", "notes 2"]);
  });

  it("keeps a cell's lines, and puts a title on one line", () => {
    const multiline = schema.node("tableCell", null, [
      schema.node("paragraph", null, [
        schema.text("First"),
        schema.node("hardBreak"),
        schema.text("second"),
      ]),
      schema.node("paragraph", null, schema.text("Third")),
    ]);
    const seed = tableCollectionSeed(table([[multiline, multiline]]));
    expect(seed.rows).toEqual([["First second Third", "First\nsecond\nThird"]]);
  });

  it("keeps the text a mention or inline maths shows", () => {
    const atom = (tagName: string, label: string) =>
      schema.node("notionInlineAtom", { tagName, label });
    const withAtoms = schema.node(
      "tableCell",
      null,
      schema.node("paragraph", null, [
        schema.text("Ask "),
        atom("mention-user", "Ana"),
        schema.text(" about "),
        atom("math", "x^2"),
      ]),
    );
    expect(tableCollectionSeed(table([[withAtoms, withAtoms]])).rows).toEqual([
      ["Ask Ana about x^2", "Ask Ana about x^2"],
    ]);
  });

  it("puts a merged cell's text in its first row and column only", () => {
    const seed = tableCollectionSeed(
      table([
        ["h:Item", "h:Q1", "h:Q2"],
        ["Rent", cell("Same", { colspan: 2 })],
        [cell("Shared", { rowspan: 2 }), "1", "2"],
        ["3", "4"],
      ]),
    );
    expect(seed.rows).toEqual([
      ["Rent", "Same", ""],
      ["Shared", "1", "2"],
      ["", "3", "4"],
    ]);
  });

  it("gives a header-only table no rows", () => {
    expect(tableCollectionSeed(table([["h:Name", "h:Status"]]))).toEqual({
      properties: ["Status"],
      rows: [],
    });
  });
});

describe("tableFitsCollection", () => {
  it("takes up to 500 rows under a header and 50 columns", () => {
    const rows = (count: number, width = 2) =>
      Array.from({ length: count }, (_, row) =>
        Array.from({ length: width }, (_, column) => `${row}-${column}`),
      );
    expect(tableFitsCollection(table([["h:A", "h:B"], ...rows(500)]))).toBe(
      true,
    );
    expect(tableFitsCollection(table(rows(501)))).toBe(false);
    expect(tableFitsCollection(table(rows(1, 50)))).toBe(true);
    expect(tableFitsCollection(table(rows(1, 51)))).toBe(false);
  });
});

describe("seedFitsCollection", () => {
  it("keeps a long name whole, and turns away a table whose names or cells are too long", () => {
    const long = "x".repeat(501);
    const seed = tableCollectionSeed(table([[long, "a"]]));
    expect(seed.rows).toEqual([[long, "a"]]);
    expect(seedFitsCollection(seed)).toBe(false);
    expect(
      seedFitsCollection(
        tableCollectionSeed(table([["Name", "y".repeat(20_001)]])),
      ),
    ).toBe(false);
    expect(
      seedFitsCollection(tableCollectionSeed(table([["x".repeat(500), "a"]]))),
    ).toBe(true);
  });
});

const paragraph = (text: string) =>
  schema.node("paragraph", null, schema.text(text));

const original = table([
  ["h:Name", "h:Status"],
  ["One", "Done"],
]);

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
  return { page, read };
}

function tableAt(state: EditorState, index: number) {
  const found = findTableByIndex(state.doc, index);
  if (!found) throw new Error(`The page has no table ${index}`);
  return found;
}

function liveCellText(page: Y.XmlFragment, block: number) {
  const row = (page.get(block) as Y.XmlElement).get(1) as Y.XmlElement;
  const cell = row.get(1) as Y.XmlElement;
  return (cell.get(0) as Y.XmlElement).get(0) as Y.XmlText;
}

describe("followTable on a page without a live copy", () => {
  it("follows the table when text above it moves it", () => {
    const state = EditorState.create({
      doc: schema.node("doc", null, [paragraph("Hi"), original]),
    });
    const followed = followTable(state, tableAt(state, 0));
    const tr = state.tr.insertText(" there", 3);
    followed.map(tr);
    const after = state.apply(tr);
    expect(followed.find(after)).toEqual({
      node: original,
      pos: after.doc.child(0).nodeSize,
    });
  });

  it("lets go of a table someone changed, or deleted, even with a copy of it on the page", () => {
    const state = EditorState.create({
      doc: schema.node("doc", null, [original, paragraph("Between"), original]),
    });
    const edited = followTable(state, tableAt(state, 0));
    let afterDone = -1;
    state.doc.descendants((node, pos) => {
      if (afterDone < 0 && node.text === "Done") afterDone = pos + 4;
    });
    const typed = state.tr.insertText("!", afterDone);
    edited.map(typed);
    expect(edited.find(state.apply(typed))).toBeNull();

    const deleted = followTable(state, tableAt(state, 0));
    const removed = state.tr.delete(0, original.nodeSize);
    deleted.map(removed);
    const after = state.apply(removed);
    expect(findTableByIndex(after.doc, 0)?.node.eq(original)).toBe(true);
    expect(deleted.find(after)).toBeNull();
  });
});

describe("followTable on a page with a live copy", () => {
  it("follows the table when a collaborator adds text above it", () => {
    const live = livePage(paragraph("Hi"), original);
    const before = live.read();
    const followed = followTable(before, tableAt(before, 0));
    const text = (live.page.get(0) as Y.XmlElement).get(0) as Y.XmlText;
    text.insert(2, " there");
    const after = live.read();
    expect(followed.find(after)?.pos).toBe(after.doc.child(0).nodeSize);
  });

  it("lets go of the table a collaborator types in, not picking its copy", () => {
    const live = livePage(original, paragraph("Between"), original);
    const before = live.read();
    const followed = followTable(before, tableAt(before, 0));
    liveCellText(live.page, 0).insert(4, "!");
    const after = live.read();
    expect(tableAt(after, 1).node.eq(original)).toBe(true);
    expect(followed.find(after)).toBeNull();
  });
});

describe("replaceBlockAsOneUndoStep", () => {
  it("keeps the turn its own undo step, apart from edits to the table just before and to the block just after", () => {
    const view = new EditorView(document.createElement("div"), {
      state: EditorState.create({
        doc: schema.node("doc", null, [paragraph("Hi"), original]),
        plugins: [history()],
      }),
    });
    const dispatch = (tr: Transaction) => view.dispatch(tr);
    let afterDone = -1;
    view.state.doc.descendants((node, pos) => {
      if (afterDone < 0 && node.text === "Done") afterDone = pos + 4;
    });
    dispatch(view.state.tr.insertText("!", afterDone));
    replaceBlockAsOneUndoStep(
      view,
      tableAt(view.state, 0),
      paragraph("Collection"),
      "test-edit",
    );
    dispatch(view.state.tr.deleteSelection());
    expect(view.state.doc.textContent).toBe("Hi");
    expect(undoDepth(view.state)).toBe(3);

    undo(view.state, dispatch);
    expect(view.state.doc.textContent).toBe("HiCollection");
    undo(view.state, dispatch);
    expect(view.state.doc.textContent).toBe("HiNameStatusOneDone!");
    undo(view.state, dispatch);
    expect(view.state.doc.child(1).eq(original)).toBe(true);
    view.destroy();
  });
});

describe("collectionTableContent", () => {
  it("builds a table with a header row and a row per record that turns back into the same collection", () => {
    const built = schema.nodeFromJSON(
      collectionTableContent(
        ["Title", "Status", "Notes"],
        [
          ["Dune", "Read", ""],
          ["Emma", "Unread", "Line one\r\nLine two"],
        ],
      ),
    );

    built.check();
    expect(getTableHeaders(built)).toEqual({ row: true, column: false });
    expect(tableCollectionSeed(built)).toEqual({
      properties: ["Status", "Notes"],
      rows: [
        ["Dune", "Read", ""],
        ["Emma", "Unread", "Line one\nLine two"],
      ],
    });
  });
});

describe("findInlineCollection", () => {
  it("finds the block that owns a collection by its block ID", () => {
    const block = (blockId: string) =>
      schema.node("registryBlock", {
        blockType: "inline-database",
        blockId,
        __raw: `<InlineDatabase id="${blockId}" />`,
      });
    const doc = schema.node("doc", null, [
      paragraph("Hi"),
      block("inline-database-a"),
      block("inline-database-b"),
    ]);

    const found = findInlineCollection(doc, "inline-database-b");

    expect(found?.node.attrs.blockId).toBe("inline-database-b");
    expect(doc.nodeAt(found?.pos ?? -1)?.attrs.blockId).toBe(
      "inline-database-b",
    );
    expect(findInlineCollection(doc, "inline-database-c")).toBeNull();
  });
});
