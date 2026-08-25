import { describe, expect, it } from "vitest";

import {
  normalizeImportedMarkdownStructures,
  normalizeMarkdownPipeTable,
} from "./markdown-import";

describe("Markdown import normalization", () => {
  it("converts one supported GFM pipe table into canonical NFM", () => {
    const result = normalizeMarkdownPipeTable(
      [
        "| Stage | Owner | Note |",
        "| :--- | ---: | :---: |",
        "| Draft | Writer | Uses \\| safely |",
        "| Review | `Editor | QA` | Ready |",
      ].join("\n"),
    );

    expect(result).toEqual({
      status: "normalized",
      columnCount: 3,
      rowCount: 3,
      content: [
        '<table header-row="true">',
        "<tr>",
        "<td>Stage</td>",
        "<td>Owner</td>",
        "<td>Note</td>",
        "</tr>",
        "<tr>",
        "<td>Draft</td>",
        "<td>Writer</td>",
        "<td>Uses \\| safely</td>",
        "</tr>",
        "<tr>",
        "<td>Review</td>",
        "<td>`Editor | QA`</td>",
        "<td>Ready</td>",
        "</tr>",
        "</table>",
      ].join("\n"),
    });
  });

  it("fails closed for inconsistent rows", () => {
    expect(
      normalizeMarkdownPipeTable(
        ["| A | B |", "| --- | --- |", "| only one |"].join("\n"),
      ),
    ).toEqual({
      status: "unsupported",
      reason: "inconsistent-body-row",
    });
  });

  it("fails closed when cell text could terminate canonical table markup", () => {
    expect(
      normalizeMarkdownPipeTable(
        ["| A | B |", "| --- | --- |", "| </td> | safe |"].join("\n"),
      ),
    ).toEqual({
      status: "unsupported",
      reason: "unsafe-cell-structure",
    });
  });

  it("does not normalize pipe tables inside fenced code", () => {
    const markdown = [
      "```md",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "```",
    ].join("\n");

    expect(normalizeImportedMarkdownStructures(markdown)).toEqual({
      content: markdown,
      normalizedPipeTables: 0,
    });
  });

  it("does not treat fence-looking content with trailing text as a closer", () => {
    const markdown = [
      "```md",
      "```still code",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "```",
    ].join("\n");

    expect(normalizeImportedMarkdownStructures(markdown)).toEqual({
      content: markdown,
      normalizedPipeTables: 0,
    });
  });

  it("does not normalize pipe tables in indented code", () => {
    const markdown = [
      "    | A | B |",
      "    | --- | --- |",
      "    | 1 | 2 |",
    ].join("\n");

    expect(normalizeImportedMarkdownStructures(markdown)).toEqual({
      content: markdown,
      normalizedPipeTables: 0,
    });
  });

  it("does not lift a blockquote table into the document root", () => {
    const markdown = ["> | A | B |", "> | --- | --- |", "> | 1 | 2 |"].join(
      "\n",
    );

    expect(normalizeImportedMarkdownStructures(markdown)).toEqual({
      content: markdown,
      normalizedPipeTables: 0,
    });
  });

  it("does not lift a list-item table into the document root", () => {
    const markdown = [
      "- Item",
      "  | A | B |",
      "  | --- | --- |",
      "  | 1 | 2 |",
    ].join("\n");

    expect(normalizeImportedMarkdownStructures(markdown)).toEqual({
      content: markdown,
      normalizedPipeTables: 0,
    });
  });

  it("stops a table before a following blockquote row", () => {
    const markdown = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "> follow-up | quote",
    ].join("\n");
    const result = normalizeImportedMarkdownStructures(markdown);

    expect(result.normalizedPipeTables).toBe(1);
    expect(result.content).toContain("> follow-up | quote");
    expect(result.content).not.toContain("<td>> follow-up</td>");
  });

  it("ignores unsupported syntax inside fences when normalizing another table", () => {
    const markdown = [
      "```ts",
      "export const example = <Widget />;",
      "```",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const result = normalizeImportedMarkdownStructures(markdown);

    expect(result.normalizedPipeTables).toBe(1);
    expect(result.content).toContain("export const example = <Widget />;");
    expect(result.content).toContain('<table header-row="true">');
  });

  it("preserves CRLF source byte-for-byte when no table is normalized", () => {
    const markdown = "Before\r\n\r\n```mermaid\r\nflowchart LR\r\n```\r\n";

    expect(normalizeImportedMarkdownStructures(markdown)).toEqual({
      content: markdown,
      normalizedPipeTables: 0,
    });
  });

  it("uses CRLF consistently when a CRLF table is normalized", () => {
    const markdown = "| A | B |\r\n| --- | --- |\r\n| 1 | 2 |\r\n";
    const result = normalizeImportedMarkdownStructures(markdown);

    expect(result.normalizedPipeTables).toBe(1);
    expect(result.content).not.toMatch(/(?<!\r)\n/);
    expect(result.content).toContain("<td>A</td>\r\n<td>B</td>");
  });

  it("fails closed for mixed source line endings", () => {
    const markdown = "| A | B |\r\n| --- | --- |\n| 1 | 2 |";

    expect(normalizeImportedMarkdownStructures(markdown)).toEqual({
      content: markdown,
      normalizedPipeTables: 0,
    });
  });

  it("fails closed for a malformed body row without an outer pipe", () => {
    const markdown = ["| A | B |", "| --- | --- |", "one | two | three"].join(
      "\n",
    );

    expect(normalizeImportedMarkdownStructures(markdown)).toEqual({
      content: markdown,
      normalizedPipeTables: 0,
    });
  });

  it.each([
    ["MDX expression", ["{`", "| A | B |", "| --- | --- |", "`}"].join("\n")],
    [
      "MDX module",
      ["export const value = `", "| A | B |", "| --- | --- |", "`;"].join("\n"),
    ],
    ["HTML comment", ["<!--", "| A | B |", "| --- | --- |", "-->"].join("\n")],
    ["raw HTML", ["<pre>", "| A | B |", "| --- | --- |", "</pre>"].join("\n")],
  ])(
    "does not normalize table-shaped text inside %s source",
    (_name, markdown) => {
      expect(normalizeImportedMarkdownStructures(markdown)).toEqual({
        content: markdown,
        normalizedPipeTables: 0,
      });
    },
  );
});
