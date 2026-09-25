// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it } from "vitest";

import { createVisualEditorExtensions } from "./VisualEditor";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, "compatMode", {
    configurable: true,
    value: "CSS1Compat",
  });
});

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

it("renders an editable aligned table and saves its cell changes", async () => {
  const source =
    "Before.\n| Name | Price |\n| :--- | ---: |\n| **A** | $1 | extra |\nAfter.";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const editor = new Editor({
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(source),
  });
  cleanup.push(() => {
    act(() => root.unmount());
    editor.destroy();
    container.remove();
  });

  await act(async () => root.render(<EditorContent editor={editor} />));

  const table =
    container.querySelector(".notion-editor table") ??
    container.querySelector("table");
  expect(table).not.toBeNull();
  expect(table?.querySelectorAll("tr")).toHaveLength(2);
  expect(table?.querySelectorAll("td")).toHaveLength(6);
  expect(table?.querySelector("strong")?.textContent).toBe("A");
  expect(table?.querySelectorAll('td[data-alignment="right"]')).toHaveLength(2);
  expect(container.textContent).not.toContain("Unresolved GFM table");
  const firstCell = editor.state.doc.child(1).firstChild!.firstChild!;
  expect(firstCell.attrs.textAlign).toBe("left");
  let pricePosition = -1;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "tableCell" && node.textContent === "$1") {
      pricePosition = position + 2;
      return false;
    }
    return true;
  });
  expect(pricePosition).toBeGreaterThan(0);
  await act(async () => {
    editor.view.dispatch(editor.state.tr.insertText("Edited ", pricePosition));
  });

  const after = editor.state.doc.lastChild;
  expect(after?.type.name).toBe("paragraph");
  await act(async () => {
    const position = editor.state.doc.content.size - after!.nodeSize + 1;
    editor.view.dispatch(editor.state.tr.insertText("Changed ", position));
  });
  expect(docToNfm(editor.getJSON())).toContain('align="right"');
  expect(docToNfm(editor.getJSON())).toContain("Edited \\$1");
  expect(docToNfm(editor.getJSON())).toContain("extra");
  expect(docToNfm(editor.getJSON())).toContain("Changed After.");
});

it("keeps column alignment when a row is added to an imported table", () => {
  const editor = new Editor({
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc("| Name | Price |\n| :--- | ---: |\n| A | $1 |"),
  });
  cleanup.push(() => editor.destroy());

  let pricePosition = -1;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "tableCell" && node.textContent === "$1") {
      pricePosition = position + 2;
      return false;
    }
    return true;
  });
  expect(pricePosition).toBeGreaterThan(0);
  expect(
    editor.chain().setTextSelection(pricePosition).addRowAfter().run(),
  ).toBe(true);
  const table = editor.state.doc.firstChild!;
  expect(table.childCount).toBe(3);
  expect(
    Array.from(
      { length: table.child(2).childCount },
      (_, index) => table.child(2).child(index).attrs.textAlign,
    ),
  ).toEqual(["left", "right"]);
  expect(docToNfm(editor.getJSON())).toContain(
    '<td align="left"></td>\n<td align="right"></td>',
  );

  let newPricePosition = -1;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "tableCell" && node.textContent === "$1") {
      newPricePosition = position + 2;
      return false;
    }
    return true;
  });
  expect(
    editor.chain().setTextSelection(newPricePosition).addColumnAfter().run(),
  ).toBe(true);
  const expanded = editor.state.doc.firstChild!;
  expect(
    Array.from(
      { length: expanded.childCount },
      (_, index) => expanded.child(index).childCount,
    ),
  ).toEqual([3, 3, 3]);
  expect(
    Array.from(
      { length: expanded.child(2).childCount },
      (_, index) => expanded.child(2).child(index).attrs.textAlign,
    ),
  ).toEqual(["left", "right", null]);
});

it("does not impose alignment from one cell on a mixed-alignment table", () => {
  const source = [
    '<table header-row="true">',
    "<tr>",
    '<td align="right">Price</td>',
    "</tr>",
    "<tr>",
    "<td>$1</td>",
    "</tr>",
    "</table>",
  ].join("\n");
  const editor = new Editor({
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(source),
  });
  cleanup.push(() => editor.destroy());
  let cellPosition = -1;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "tableCell" && node.textContent === "$1") {
      cellPosition = position + 2;
      return false;
    }
    return true;
  });
  expect(
    editor.chain().setTextSelection(cellPosition).addRowAfter().run(),
  ).toBe(true);
  expect(
    editor.state.doc.firstChild!.child(2).child(0).attrs.textAlign,
  ).toBeNull();
});

it("does not copy alignment into a table inserted before an aligned table", () => {
  const editor = new Editor({
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc("| Name | Price |\n| :--- | ---: |\n| A | $1 |"),
  });
  cleanup.push(() => editor.destroy());
  const inserted = nfmToDoc("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |")
    .content[0];
  expect(editor.commands.insertContentAt(0, inserted)).toBe(true);

  const firstTable = editor.state.doc.firstChild!;
  expect(firstTable.type.name).toBe("table");
  expect(firstTable.childCount).toBe(3);
  for (let rowIndex = 0; rowIndex < firstTable.childCount; rowIndex++) {
    const row = firstTable.child(rowIndex);
    for (let cellIndex = 0; cellIndex < row.childCount; cellIndex++) {
      expect(row.child(cellIndex).attrs.textAlign).toBeNull();
    }
  }
});
