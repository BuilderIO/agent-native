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
});
