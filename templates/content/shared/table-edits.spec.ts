import { describe, expect, it } from "vitest";

import { resolveDocumentTextEdits } from "./document-text-edits.js";
import { nfmToDoc, type PMNode } from "./nfm.js";
import {
  countNfmTables,
  editNfmTable,
  TableEditError,
  type TableOperation,
} from "./table-edits.js";

const TABLE = [
  '<table header-row="true">',
  "<tr>",
  "<td>Item</td>",
  "<td>State</td>",
  "</tr>",
  "<tr>",
  "<td>Alpha</td>",
  "<td>Draft</td>",
  "</tr>",
  "<tr>",
  "<td>Beta</td>",
  "<td>Ready</td>",
  "</tr>",
  "</table>",
].join("\n");

const PAGE = `Before the table.\n${TABLE}\nAfter the table.`;

function edit(
  markdown: string,
  table: number,
  operations: TableOperation[],
): { markdown: string; result: ReturnType<typeof editNfmTable> } {
  const result = editNfmTable(markdown, table, operations);
  const applied = resolveDocumentTextEdits(markdown, [result.edit]);
  if (!applied.ok) throw new Error(JSON.stringify(applied.error));
  expect(result.markdown).toBe(applied.content);
  return { markdown: applied.content, result };
}

function text(node: PMNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(text).join("");
}

function tables(markdown: string): PMNode[] {
  const found: PMNode[] = [];
  const visit = (nodes: PMNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "table") found.push(node);
      else visit(node.content);
    }
  };
  visit(nfmToDoc(markdown).content);
  return found;
}

function tableAt(markdown: string, number = 1): PMNode {
  const table = tables(markdown).find((_, at) => at === number - 1);
  if (!table) throw new Error(`The page has no table ${number}.`);
  return table;
}

function grid(markdown: string, number = 1): string[][] {
  return (tableAt(markdown, number).content ?? []).map((row) =>
    (row.content ?? []).map(text),
  );
}

function oneCell(text: string): string {
  return ["<table>", "<tr>", `<td>${text}</td>`, "</tr>", "</table>"].join(
    "\n",
  );
}

const ZEBRA: TableOperation[] = [
  { op: "set-cell", row: 1, column: 1, text: "Zebra" },
];

function refusal(run: () => unknown): TableEditError {
  try {
    run();
  } catch (error) {
    if (error instanceof TableEditError) return error;
    throw error;
  }
  throw new Error("Expected a TableEditError");
}

describe("editNfmTable rows", () => {
  it("adds a row at the bottom with its cells, touching only the table's lines", () => {
    const { markdown, result } = edit(PAGE, 1, [
      { op: "insert-row", cells: ["Gamma", "**Done**"] },
    ]);
    expect(grid(markdown)).toEqual([
      ["Item", "State"],
      ["Alpha", "Draft"],
      ["Beta", "Ready"],
      ["Gamma", "Done"],
    ]);
    expect(markdown).toContain("<td>**Done**</td>");
    expect(markdown.startsWith("Before the table.\n<table")).toBe(true);
    expect(markdown.endsWith("</table>\nAfter the table.")).toBe(true);
    expect(result.edit.find).toBe(TABLE);
    expect(result.summary).toEqual({
      table: 1,
      rows: 4,
      columns: 2,
      headerRow: true,
      headerColumn: false,
      fitPageWidth: false,
    });
    expect(result.changed).toBe(true);
  });

  it("inserts, moves, duplicates, clears and deletes rows in order", () => {
    const { markdown } = edit(PAGE, 1, [
      { op: "insert-row", at: 2, cells: ["New"] },
      { op: "move-row", row: 4, to: 2 },
      { op: "duplicate-row", row: 2 },
      { op: "clear-row", row: 3 },
      { op: "delete-row", row: 5 },
    ]);
    expect(grid(markdown)).toEqual([
      ["Item", "State"],
      ["Beta", "Ready"],
      ["", ""],
      ["New", ""],
    ]);
  });

  it("keeps the header on whatever row ends up first", () => {
    const { markdown } = edit(PAGE, 1, [{ op: "move-row", row: 3, to: 1 }]);
    const table = tableAt(markdown);
    expect(table.attrs?.headerRow).toBe(true);
    expect(table.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(grid(markdown)[0]).toEqual(["Beta", "Ready"]);
  });

  it("refuses to delete a table's last row", () => {
    const one = "<table>\n<tr>\n<td>Only</td>\n</tr>\n</table>";
    const error = refusal(() =>
      editNfmTable(one, 1, [{ op: "delete-row", row: 1 }]),
    );
    expect(error.code).toBe("TABLE_OPERATION_INVALID");
    expect(error.message).toContain("edit-document");
  });

  it("names the rows a table has when a row is out of range", () => {
    const error = refusal(() =>
      editNfmTable(PAGE, 1, [
        { op: "insert-row" },
        { op: "set-cell", row: 6, column: 1, text: "x" },
      ]),
    );
    expect(error.code).toBe("TABLE_POSITION_OUT_OF_RANGE");
    expect(error.message).toBe(
      "Operation 2: row 6 is out of range; the table has rows 1 to 4.",
    );
  });

  it("gives a new row the alignment its whole column shares", () => {
    const pipe = "| Name | Count |\n| :-- | --: |\n| a | 1 |";
    const { markdown } = edit(pipe, 1, [
      { op: "insert-row", cells: ["b", "2"] },
    ]);
    expect(markdown).toContain('<td align="right">2</td>');
    expect(markdown).toContain('<td align="left">b</td>');
  });
});

describe("editNfmTable columns", () => {
  it("inserts, moves, duplicates, clears and deletes columns", () => {
    const { markdown } = edit(PAGE, 1, [
      { op: "insert-column", at: 1, cells: ["#", "1", "2"] },
      { op: "move-column", column: 1, to: 3 },
      { op: "duplicate-column", column: 1 },
      { op: "clear-column", column: 2 },
      { op: "delete-column", column: 3 },
    ]);
    expect(grid(markdown)).toEqual([
      ["Item", "", "#"],
      ["Alpha", "", "1"],
      ["Beta", "", "2"],
    ]);
  });

  it("moves a column's colour with it", () => {
    const { markdown } = edit(PAGE, 1, [
      { op: "set-color", column: 1, color: "red" },
      { op: "move-column", column: 1, to: 2 },
    ]);
    expect(tableAt(markdown).attrs?.colMeta).toEqual([{}, { color: "red" }]);
    expect(grid(markdown)[0]).toEqual(["State", "Item"]);
  });

  it("fills out a short row so every column number counts", () => {
    const ragged =
      "<table>\n<tr>\n<td>a</td>\n<td>b</td>\n</tr>\n<tr>\n<td>c</td>\n</tr>\n</table>";
    const { markdown } = edit(ragged, 1, [
      { op: "set-cell", row: 2, column: 2, text: "d" },
    ]);
    expect(grid(markdown)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("refuses more cells than the column has rows", () => {
    const error = refusal(() =>
      editNfmTable(PAGE, 1, [
        { op: "insert-column", cells: ["a", "b", "c", "d"] },
      ]),
    );
    expect(error.code).toBe("TABLE_OPERATION_INVALID");
  });
});

describe("editNfmTable cells, headers and colours", () => {
  it("sets a cell's inline NFM and refuses a second line", () => {
    const { markdown } = edit(PAGE, 1, [
      {
        op: "set-cell",
        row: 2,
        column: 2,
        text: "[Spec](https://example.com) and `code`",
      },
    ]);
    expect(markdown).toContain(
      "<td>[Spec](https://example.com) and `code`</td>",
    );
    const error = refusal(() =>
      editNfmTable(PAGE, 1, [
        { op: "set-cell", row: 2, column: 2, text: "one\ntwo" },
      ]),
    );
    expect(error.code).toBe("TABLE_OPERATION_INVALID");
  });

  it("refuses cell text with table tags or control characters", () => {
    for (const text of ["x</td> tail", "a <tr> b", "one\u0000two"]) {
      const error = refusal(() =>
        editNfmTable(PAGE, 1, [{ op: "set-cell", row: 2, column: 1, text }]),
      );
      expect(error.code).toBe("TABLE_OPERATION_INVALID");
    }
  });

  it("keeps table tags inside inline code in a cell", () => {
    const { markdown } = edit(oneCell("Alpha"), 1, [
      { op: "set-cell", row: 1, column: 1, text: "`</td>`" },
    ]);
    expect(markdown).toBe(oneCell("`</td>`"));
  });

  it("turns headers and page width on and off", () => {
    const { markdown } = edit(PAGE, 1, [
      { op: "set-header-row", value: false },
      { op: "set-header-column", value: true },
      { op: "set-fit-page-width", value: true },
    ]);
    expect(markdown).toContain(
      '<table fit-page-width="true" header-column="true">',
    );
  });

  it("colours a row, a column and a cell, and clears one", () => {
    const { markdown } = edit(PAGE, 1, [
      { op: "set-color", row: 2, color: "blue_bg" },
      { op: "set-color", column: 2, color: "green" },
      { op: "set-color", row: 3, column: 1, color: "red" },
      { op: "set-color", column: 2, color: null },
    ]);
    expect(markdown).toContain('<tr color="blue_bg">');
    expect(markdown).toContain('<td color="red">Beta</td>');
    expect(markdown).not.toContain("<colgroup>");
  });

  it("refuses a colour NFM can't name", () => {
    const error = refusal(() =>
      editNfmTable(PAGE, 1, [
        { op: "set-color", row: 1, color: "teal" as "red" },
      ]),
    );
    expect(error.code).toBe("TABLE_OPERATION_INVALID");
  });
});

describe("editNfmTable finding the table", () => {
  it("counts tables in page order, skipping code fences", () => {
    const page = [
      "```",
      "<table>",
      "<tr>",
      "<td>code</td>",
      "</tr>",
      "</table>",
      "```",
      TABLE,
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    expect(countNfmTables(page)).toBe(2);
    const { markdown } = edit(page, 2, [
      { op: "set-cell", row: 2, column: 2, text: "3" },
    ]);
    expect(grid(markdown, 2)).toEqual([
      ["A", "B"],
      ["1", "3"],
    ]);
    expect(markdown.startsWith(`\`\`\`\n<table>\n<tr>\n<td>code</td>`)).toBe(
      true,
    );
  });

  it("widens the find past an identical table so it matches once", () => {
    const page = `${TABLE}\nBetween.\n${TABLE}`;
    const { markdown, result } = edit(page, 2, [
      { op: "set-cell", row: 2, column: 1, text: "Changed" },
    ]);
    expect(result.edit.find.startsWith("Between.\n")).toBe(true);
    expect(grid(markdown, 1)[1]?.[0]).toBe("Alpha");
    expect(grid(markdown, 2)[1]?.[0]).toBe("Changed");
  });

  it("keeps a nested table's indent and the toggle around it", () => {
    const nested = TABLE.split("\n")
      .map((line) => `\t${line}`)
      .join("\n");
    const page = `<details>\n<summary>Plan</summary>\n${nested}\n</details>\nAfter.`;
    const { markdown } = edit(page, 1, [
      { op: "insert-row", cells: ["Gamma", "Done"] },
    ]);
    expect(
      markdown.startsWith("<details>\n<summary>Plan</summary>\n\t<table"),
    ).toBe(true);
    expect(markdown).toContain("\t<td>Gamma</td>");
    expect(markdown.endsWith("\t</table>\n</details>\nAfter.")).toBe(true);
    expect(nfmToDoc(markdown).content[0]?.type).toBe("notionToggle");
    const rows = grid(markdown);
    expect(rows[rows.length - 1]).toEqual(["Gamma", "Done"]);
  });

  it("writes a pipe table as a table block with the same meaning", () => {
    const pipe = "Intro\n| A | B |\n| --- | --- |\n| 1 | 2 |\nOutro";
    const { markdown } = edit(pipe, 1, [
      { op: "set-cell", row: 1, column: 1, text: "Z" },
    ]);
    expect(markdown.startsWith('Intro\n<table header-row="true">')).toBe(true);
    expect(markdown.endsWith("</table>\nOutro")).toBe(true);
    expect(grid(markdown)).toEqual([
      ["Z", "B"],
      ["1", "2"],
    ]);
  });

  it("leaves the rest of a page byte for byte as it was", () => {
    const page = `# Title\n\n- one\n- two\n\n${TABLE}\n\nA *loose* paragraph   \n`;
    const { markdown } = edit(page, 1, [{ op: "delete-row", row: 3 }]);
    expect(markdown.startsWith("# Title\n\n- one\n- two\n\n<table")).toBe(true);
    expect(markdown.endsWith("</table>\n\nA *loose* paragraph   \n")).toBe(
      true,
    );
  });

  it("says how many tables there are when the number is too high", () => {
    const error = refusal(() => editNfmTable(PAGE, 2, [{ op: "insert-row" }]));
    expect(error.code).toBe("TABLE_NOT_FOUND");
    expect(error.message).toBe(
      "The page has tables 1 to 1; there is no table 2.",
    );
    expect(
      refusal(() => editNfmTable("No tables.", 1, [{ op: "insert-row" }]))
        .message,
    ).toBe("The page has no tables.");
  });

  it("reports an unchanged table as unchanged", () => {
    const { markdown, result } = edit(PAGE, 1, [
      { op: "set-header-row", value: true },
    ]);
    expect(result.changed).toBe(false);
    expect(markdown).toBe(PAGE);
  });

  it("refuses a table whose text holds a line the table drops", () => {
    const lossy = oneCell("Alpha").replace(
      "<table>\n",
      "<table>\nLoose paragraph\n",
    );
    expect(refusal(() => editNfmTable(lossy, 1, ZEBRA)).code).toBe(
      "TABLE_NOT_LOCATED",
    );
  });

  it("finds a table after a code fence whose closer is indented with spaces", () => {
    const page = `\`\`\`\ncode\n  \`\`\`\n${oneCell("Alpha")}`;
    const { markdown } = edit(page, 1, ZEBRA);
    expect(markdown).toBe(`\`\`\`\ncode\n  \`\`\`\n${oneCell("Zebra")}`);
  });

  it("skips an unclosed table opener inside a callout", () => {
    const page = [
      "<callout>",
      "\t<table>",
      "</callout>",
      oneCell("Alpha"),
    ].join("\n");
    const { markdown } = edit(page, 1, ZEBRA);
    expect(markdown).toBe(
      ["<callout>", "\t<table>", "</callout>", oneCell("Zebra")].join("\n"),
    );
  });

  it("edits the table the page reads, not table-shaped text it drops", () => {
    const head = [
      "\t<details>",
      "\t```text",
      "\t  ```",
      "```",
      "<table>",
      "<tr><td>Alpha</td></tr>",
      "</table>",
      "\t</details>",
      "$$",
      "```",
      "$$",
    ].join("\n");
    const { markdown } = edit(`${head}\n${oneCell("Alpha")}`, 1, ZEBRA);
    expect(markdown).toBe(`${head}\n${oneCell("Zebra")}`);
  });

  it("edits a table in a callout whose closing tag sits less indented", () => {
    const page = [
      "<callout>",
      "\t<table>",
      "\t<tr>",
      "\t<td>Alpha</td>",
      "\t</tr>",
      "</table>",
      "</callout>",
    ].join("\n");
    const { markdown } = edit(page, 1, ZEBRA);
    expect(markdown).toBe(
      [
        "<callout>",
        ...oneCell("Zebra")
          .split("\n")
          .map((line) => `\t${line}`),
        "</callout>",
      ].join("\n"),
    );
  });

  it("refuses a span whose text already reads like the probe table", () => {
    const shaped = [
      "<tr>",
      "<td>edittable<span></span>probe0</td>",
      "</tr>",
      "</table>",
    ];
    const page = [
      "\t<details>",
      "\t```text",
      "\t  ```",
      "shallow",
      "<table>",
      ...shaped,
      "```",
      "\t</details>",
      '<table header-row="false">',
      ...shaped,
    ].join("\n");
    expect(
      refusal(() =>
        editNfmTable(page, 1, [{ op: "set-header-row", value: false }]),
      ).code,
    ).toBe("TABLE_NOT_LOCATED");
  });

  it("reads a fence as open past a closer less indented than its opener", () => {
    const head = ["\t```", "code", "```", oneCell("Alpha"), "\t```"].join("\n");
    const { markdown } = edit(`${head}\n${oneCell("Beta")}`, 1, ZEBRA);
    expect(markdown).toBe(`${head}\n${oneCell("Zebra")}`);
  });
});
