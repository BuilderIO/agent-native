// @vitest-environment jsdom
// happy-dom can't parse a pasted table: it rejects one of the editor's parse
// rule selectors when it meets the table's <colgroup>.

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import {
  isSpreadsheetPicture,
  parseSpreadsheetText,
} from "./spreadsheet-clipboard";
import { createVisualEditorExtensions } from "./VisualEditor";

// Clipboards in the shapes Google Sheets and Excel write for a 3 by 3 range: a
// bold header row, a quoted name, a number, a two-line cell and an empty cell.
// Sheets marks its HTML with data-sheets-root; Excel writes a whole Office
// document with fragment comments around the cells.
const SHEETS_TEXT =
  'Name\tScore\tNotes\r\nAda "the first"\t1234.5\t"line one\nline two"\r\nGrace\t42\t';

const sheetsCell = (text: string, style = "") =>
  `<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;${style}">${text}</td>`;

const SHEETS_HTML =
  '<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>' +
  '<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1">' +
  '<colgroup><col width="100"/><col width="100"/><col width="100"/></colgroup><tbody>' +
  `<tr style="height:21px;">${sheetsCell("Name", "font-weight:bold;")}${sheetsCell("Score", "font-weight:bold;")}${sheetsCell("Notes", "font-weight:bold;")}</tr>` +
  `<tr style="height:21px;">${sheetsCell("Ada &quot;the first&quot;")}${sheetsCell("1234.5", "text-align:right;")}${sheetsCell("line one<br>line two", "white-space:normal;")}</tr>` +
  `<tr style="height:21px;">${sheetsCell("Grace")}${sheetsCell("42", "text-align:right;")}${sheetsCell("")}</tr>` +
  "</tbody></table></google-sheets-html-origin>";

const EXCEL_TEXT =
  'Name\tScore\tNotes\r\nAda "the first"\t1234.5\t"line one\nline two"\r\nGrace\t42\t\r\n';

const EXCEL_HTML = `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=ProgId content=Excel.Sheet>
<meta name=Generator content="Microsoft Excel 15">
<style>
<!--td
	{padding-top:1px;
	color:black;
	font-size:11.0pt;
	font-family:Calibri, sans-serif;
	white-space:nowrap;}
.xl65
	{font-weight:700;}
-->
</style>
</head>
<body link="#0563C1" vlink="#954F72">
<table border=0 cellpadding=0 cellspacing=0 width=192 style='border-collapse:
 collapse;width:144pt'>
 <col width=64 span=3 style='width:48pt'>
 <tr height=20 style='height:15.0pt'>
<!--StartFragment-->
  <td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt'>Name</td>
  <td class=xl65 width=64 style='width:48pt'>Score</td>
  <td class=xl65 width=64 style='width:48pt'>Notes</td>
 </tr>
 <tr height=40 style='height:30.0pt'>
  <td height=40 style='height:30.0pt'>Ada &quot;the first&quot;</td>
  <td align=right>1234.5</td>
  <td width=64 style='white-space:normal;width:48pt'>line one<br>
    line two</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 style='height:15.0pt'>Grace</td>
  <td align=right>42</td>
  <td></td>
<!--EndFragment-->
 </tr>
</table>
</body>
</html>`;

const ROWS = [
  ["Name", "Score", "Notes"],
  ['Ada "the first"', "1234.5", "line one\nline two"],
  ["Grace", "42", ""],
];

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function createEditor(content = "", isSuggesting = () => false) {
  editor = new Editor({
    extensions: createVisualEditorExtensions({ isSuggesting }),
    content: content
      ? nfmToDoc(content)
      : { type: "doc", content: [{ type: "paragraph" }] },
  });
  return editor;
}

// jsdom has no DataTransfer, so the clipboard is a stand-in with the formats.
function paste(target: Editor, data: Record<string, string>) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (format: string) => data[format] ?? "",
      types: Object.keys(data),
      files: [],
      items: [],
    },
  });
  target.view.dom.dispatchEvent(event);
}

function tables(target: Editor) {
  const found: Array<{ node: ProseMirrorNode; pos: number }> = [];
  target.state.doc.descendants((node, pos) => {
    if (node.type.name === "table") found.push({ node, pos });
  });
  return found;
}

function onlyTable(target: Editor) {
  const found = tables(target);
  expect(found).toHaveLength(1);
  for (const table of found) return table;
  throw new Error("The document has no table");
}

// Each cell's text, with a hard break read as a line break.
function cellTexts(table: ProseMirrorNode) {
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) =>
      cells.push(
        cell.textBetween(0, cell.content.size, "\n", (leaf) =>
          leaf.type.name === "hardBreak" ? "\n" : "",
        ),
      ),
    );
    rows.push(cells);
  });
  return rows;
}

function columnWidths(table: ProseMirrorNode) {
  const rows: unknown[][] = [];
  table.forEach((row) => {
    const widths: unknown[] = [];
    row.forEach((cell) => widths.push(cell.attrs.colwidth));
    rows.push(widths);
  });
  return rows;
}

function markNames(node: ProseMirrorNode) {
  const names = new Set<string>();
  node.descendants((child) => {
    for (const mark of child.marks) names.add(mark.type.name);
  });
  return [...names].sort();
}

function copiedText(target: Editor) {
  const slice = target.state.selection.content();
  return (
    target.view.someProp("clipboardTextSerializer", (serialize) =>
      serialize(slice, target.view),
    ) ?? ""
  );
}

describe("reading tab-separated text", () => {
  it("reads quoted cells the way Sheets and Excel write them", () => {
    expect(parseSpreadsheetText(SHEETS_TEXT)).toEqual(ROWS);
    expect(parseSpreadsheetText(EXCEL_TEXT)).toEqual(ROWS);
  });

  it("reads a cell that only starts with a quote as written", () => {
    expect(parseSpreadsheetText('"Quoted" word\tx\ny\tz')).toEqual([
      ['"Quoted" word', "x"],
      ["y", "z"],
    ]);
  });

  it.each([
    ["one row", "Name\tScore"],
    ["no tabs", "Name\nScore"],
    ["ragged rows", "a\tb\nc"],
    ["tab-indented lines", "\tfirst()\n\tsecond()"],
    ["lines indented with spaces and a tab", "  \tfirst()\n  \tsecond()"],
    ["one column", "a\nb"],
  ])("leaves %s as text", (_case, text) => {
    expect(parseSpreadsheetText(text)).toBeNull();
  });
});

describe("pasting cells from a spreadsheet", () => {
  it.each([
    ["Google Sheets", SHEETS_HTML, SHEETS_TEXT, 100],
    // Excel gives its three columns one <col span=3>.
    ["Excel", EXCEL_HTML, EXCEL_TEXT, 64],
  ])("makes a table from %s", (_source, html, text, columnWidth) => {
    const target = createEditor();
    paste(target, { "text/html": html, "text/plain": text });

    const table = onlyTable(target).node;
    expect(
      cellTexts(table).map((row) => row.map((cell) => cell.trim())),
    ).toEqual(ROWS);
    // The sheet's font and cell styles stay behind; bold headers may come along.
    expect(markNames(table).filter((name) => name !== "bold")).toEqual([]);
    // Every column keeps the sheet's width, so they share the page alike.
    expect(columnWidths(table)).toEqual(
      ROWS.map((row) => row.map(() => [columnWidth])),
    );
  });

  it("makes a table from tab-separated text with no HTML", () => {
    const target = createEditor();
    paste(target, { "text/plain": SHEETS_TEXT });

    expect(cellTexts(onlyTable(target).node)).toEqual(ROWS);

    const reloaded = createEditor(docToNfm(target.state.doc.toJSON()));
    expect(cellTexts(onlyTable(reloaded).node)).toEqual(ROWS);
  });

  it("keeps Markdown characters in cells as typed", () => {
    const target = createEditor();
    paste(target, { "text/plain": "**bold**\tx\n~~strike~~\t`code`" });

    const table = onlyTable(target).node;
    expect(cellTexts(table)).toEqual([
      ["**bold**", "x"],
      ["~~strike~~", "`code`"],
    ]);
    expect(markNames(table)).toEqual([]);
  });

  it("pastes cells as text while suggesting, which can't add a table", () => {
    const target = createEditor("", () => true);
    paste(target, { "text/plain": "x\ty\nz\tw" });

    expect(tables(target)).toHaveLength(0);
    expect(target.state.doc.textContent).toBe("x\tyz\tw");
  });

  it("fills the table under the caret instead of nesting a new one", () => {
    const target = createEditor(
      "<table>\n<tr>\n<td>a</td>\n<td>b</td>\n</tr>\n<tr>\n<td>c</td>\n<td>d</td>\n</tr>\n</table>",
    );
    // The caret in the first cell's text.
    target.view.dispatch(
      target.state.tr.setSelection(
        TextSelection.create(target.state.doc, onlyTable(target).pos + 4),
      ),
    );
    paste(target, { "text/plain": "x\ty\nz\tw" });

    expect(cellTexts(onlyTable(target).node)).toEqual([
      ["x", "y"],
      ["z", "w"],
    ]);
  });

  it("keeps tab-separated text literal when pasted as plain text", () => {
    const target = createEditor();
    const input = (
      target.view as unknown as {
        input: { shiftKey: boolean; lastKeyCode: number | null };
      }
    ).input;
    input.shiftKey = true;
    input.lastKeyCode = 86;
    paste(target, { "text/plain": "x\ty\nz\tw" });

    expect(tables(target)).toHaveLength(0);
    expect(target.state.doc.textContent).toBe("x\tyz\tw");
  });
});

describe("a picture pasted beside cells", () => {
  const png = new File(["png"], "cells.png", { type: "image/png" });
  const clipboard = (html: string, files: File[]) =>
    ({
      getData: (format: string) => (format === "text/html" ? html : ""),
      files,
    }) as unknown as DataTransfer;

  it("is Excel's picture of the cells when the HTML is only a table", () => {
    expect(isSpreadsheetPicture(clipboard(EXCEL_HTML, [png]))).toBe(true);
  });

  it.each([
    [
      "HTML with an image of its own",
      clipboard('<table><tr><td>a</td></tr></table><img src="a.png">', [png]),
    ],
    ["a table only in an HTML comment", clipboard("<!-- <table> -->", [png])],
    [
      "a video file",
      clipboard(EXCEL_HTML, [
        new File(["mp4"], "clip.mp4", { type: "video/mp4" }),
      ]),
    ],
    ["no file", clipboard(EXCEL_HTML, [])],
  ])("is real media, or none, with %s", (_case, data) => {
    expect(isSpreadsheetPicture(data)).toBe(false);
  });
});

describe("copying a table", () => {
  it("gives tab-separated text for the whole table", () => {
    const target = createEditor();
    paste(target, { "text/plain": SHEETS_TEXT });
    target.view.dispatch(
      target.state.tr.setSelection(
        NodeSelection.create(target.state.doc, onlyTable(target).pos),
      ),
    );

    const text = copiedText(target);
    expect(text).toBe(
      'Name\tScore\tNotes\nAda "the first"\t1234.5\t"line one\nline two"\nGrace\t42\t',
    );
    expect(parseSpreadsheetText(text)).toEqual(ROWS);
  });

  it("gives tab-separated text for selected cells", () => {
    const target = createEditor();
    paste(target, { "text/plain": SHEETS_TEXT });
    const table = onlyTable(target);
    const map = TableMap.get(table.node);
    const cellAt = (row: number, column: number) =>
      table.pos + 1 + map.positionAt(row, column, table.node);
    // From "Score" in the first row to "42" in the last.
    target.view.dispatch(
      target.state.tr.setSelection(
        CellSelection.create(target.state.doc, cellAt(0, 1), cellAt(2, 1)),
      ),
    );

    expect(copiedText(target)).toBe("Score\n1234.5\n42");
  });

  it("keeps Markdown for text selected inside a cell", () => {
    const target = createEditor();
    paste(target, { "text/plain": SHEETS_TEXT });
    // "Score", the text of the first row's second cell.
    const table = onlyTable(target);
    const cell =
      table.pos + 1 + TableMap.get(table.node).positionAt(0, 1, table.node);
    target.view.dispatch(
      target.state.tr.setSelection(
        TextSelection.create(target.state.doc, cell + 2, cell + 7),
      ),
    );

    expect(copiedText(target)).toBe("| Score |\n| --- |\n");
  });

  it("keeps Markdown for a table copied with other blocks", () => {
    const target = createEditor(
      "Before\n<table>\n<tr>\n<td>a</td>\n<td>b</td>\n</tr>\n</table>",
    );
    target.view.dispatch(
      target.state.tr.setSelection(new AllSelection(target.state.doc)),
    );

    const text = copiedText(target);
    expect(text).toContain("Before");
    expect(text).toContain("| a | b |");
  });
});
