import { serializeIconValue, type IconValue } from "@agent-native/core/icons";
import { describe, expect, it } from "vitest";

import { buildDocumentExport } from "./document-export";
import { docToNfm, nfmToDoc, type PMDoc, type PMNode } from "./nfm";

const paragraph = (text: string): PMNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const cell = (text: string): PMNode => ({
  type: "tableCell",
  content: [paragraph(text)],
});

function exportedBody(content: string, format: "pdf" | "html" = "pdf") {
  const payload = buildDocumentExport({
    id: "doc_1",
    title: "Report",
    content,
    format,
  });
  return payload.content.split("<article>")[1].split("</article>")[0];
}

function calloutWithIcon(icon: IconValue) {
  const stored = serializeIconValue(icon)!.replace(/"/g, "&quot;");
  return `<callout icon="${stored}">\n\tHeads up\n</callout>`;
}

function readTable(html: string) {
  const table = html.match(/<table class="nfm-table[^"]*">([\s\S]*?)<\/table>/);
  if (!table) return null;
  const readRows = (section: string) =>
    [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
      [...row[1].matchAll(/<(t[dh])[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(
        (match) => ({ tag: match[1], html: match[2] }),
      ),
    );
  const head = table[1].match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? "";
  const body = table[1].match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  return { head: readRows(head), body: readRows(body) };
}

const TABLE_DOC: PMDoc = {
  type: "doc",
  content: [
    {
      type: "table",
      attrs: { headerRow: true },
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [paragraph("Region")] },
            { type: "tableHeader", content: [paragraph("Status")] },
          ],
        },
        {
          type: "tableRow",
          content: [
            cell("EMEA"),
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Ready", marks: [{ type: "bold" }] },
                  ],
                },
              ],
            },
          ],
        },
        { type: "tableRow", content: [cell("APAC"), cell("Blocked")] },
      ],
    },
  ],
};

describe("NFM container export", () => {
  it("renders an editor table as real rows and cells, not a paragraph", () => {
    const html = exportedBody(docToNfm(TABLE_DOC));

    expect(html).not.toContain("&lt;table");
    expect(html).not.toContain("&lt;td&gt;");

    const table = readTable(html);
    expect(table).not.toBeNull();
    expect(table!.head).toEqual([
      [
        { tag: "th", html: "Region" },
        { tag: "th", html: "Status" },
      ],
    ]);
    expect(table!.body).toHaveLength(2);
    expect(table!.body[0]).toEqual([
      { tag: "td", html: "EMEA" },
      { tag: "td", html: "<strong>Ready</strong>" },
    ]);
    expect(table!.body[1].map((entry) => entry.html)).toEqual([
      "APAC",
      "Blocked",
    ]);
  });

  it("keeps a table separate from the paragraph directly above it", () => {
    const html = exportedBody(
      ["Quarterly rollup:", ...docToNfm(TABLE_DOC).split("\n")].join("\n"),
    );

    expect(html).toContain("<p>Quarterly rollup:</p>");
    expect(readTable(html)!.body).toHaveLength(2);
  });

  it("renders a GFM pipe table with alignment and escaped pipes", () => {
    const html = exportedBody(
      [
        "| Command | Notes |",
        "| :--- | ---: |",
        "| `left | right` | pipes |",
        "| ``multi | pipe`` | more |",
      ].join("\n"),
    );

    const table = readTable(html);
    expect(table!.head[0]).toEqual([
      { tag: "th", html: "Command" },
      { tag: "th", html: "Notes" },
    ]);
    expect(html).toContain('class="nfm-align-right"');
    expect(table!.body[0][0].html).toBe("<code>left | right</code>");
    expect(table!.body[1][0].html).toBe("<code>multi | pipe</code>");
  });

  it("keeps extra ragged cells visible in exported tables", () => {
    const html = exportedBody(
      "| Name | Price |\n| :--- | ---: |\n| A | $1 | extra |",
    );
    const table = readTable(html);
    expect(table!.head[0]).toHaveLength(3);
    expect(table!.body[0].map((cell) => cell.html)).toEqual([
      "A",
      "$1",
      "extra",
    ]);
  });

  it("requires three-hyphen delimiters and supports one-column tables", () => {
    const oneColumn = exportedBody(
      ["| Header |", "| --- |", "| Value |"].join("\n"),
    );
    expect(readTable(oneColumn)!.body).toEqual([
      [{ tag: "td", html: "Value" }],
    ]);

    const prose = exportedBody("A | B\n- | -\nC | D");
    expect(readTable(prose)).toBeNull();
  });

  it("keeps a heading with a pipe after a table out of the table", () => {
    const html = exportedBody(
      ["| A | B |", "| --- | --- |", "| 1 | 2 |", "## Next | section"].join(
        "\n",
      ),
    );

    expect(readTable(html)!.body).toHaveLength(1);
    expect(html).toContain("<h2>Next | section</h2>");
  });

  it("marks header rows and header columns with th elements", () => {
    const html = exportedBody(
      [
        '<table header-row="true" header-column="true">',
        "<tr>",
        "<td></td>",
        "<td>Q1</td>",
        "</tr>",
        "<tr>",
        "<td>Revenue</td>",
        "<td>12</td>",
        "</tr>",
        "</table>",
      ].join("\n"),
    );

    const table = readTable(html);
    expect(table!.head[0].map((entry) => entry.tag)).toEqual(["th", "th"]);
    expect(table!.body[0].map((entry) => entry.tag)).toEqual(["th", "td"]);
    expect(html).toContain('scope="row"');
  });

  it("keeps hard line breaks inside a cell", () => {
    const html = exportedBody(
      ["<table>", "<tr>", "<td>one<br>two</td>", "</tr>", "</table>"].join(
        "\n",
      ),
    );

    expect(html).toContain("one<br />two");
  });

  it("applies column widths from the table colgroup", () => {
    const html = exportedBody(
      [
        "<table>",
        "<colgroup>",
        '<col width="240"/>',
        "<col/>",
        "</colgroup>",
        "<tr>",
        "<td>a</td>",
        "<td>b</td>",
        "</tr>",
        "</table>",
      ].join("\n"),
    );

    expect(html).toContain('<col style="width: 240px" />');
  });

  it("ignores non-numeric authored column widths", () => {
    const html = exportedBody(
      [
        "<table>",
        "<colgroup>",
        '<col width="240; color: red"/>',
        "</colgroup>",
        "<tr>",
        "<td>a</td>",
        "</tr>",
        "</table>",
      ].join("\n"),
    );

    expect(html).toContain("<col />");
    expect(html).not.toContain("width: 240; color: redpx");
  });

  it("renders callouts, toggles, and columns instead of leaking their tags", () => {
    const html = exportedBody(
      [
        '<callout icon="💡">',
        "\tHeads up",
        "</callout>",
        "<details>",
        "<summary>More detail</summary>",
        "\tHidden body",
        "</details>",
        "<columns>",
        "\t<column>",
        "\t\tLeft",
        "\t</column>",
        "\t<column>",
        "\t\tRight",
        "\t</column>",
        "</columns>",
      ].join("\n"),
    );

    expect(html).not.toContain("&lt;callout");
    expect(html).not.toContain("&lt;details");
    expect(html).not.toContain("&lt;column");
    expect(html).toContain('<aside class="nfm-callout">');
    expect(html).toContain("<p>Heads up</p>");
    expect(html).toContain("<summary>More detail</summary>");
    expect(html).toContain("<p>Hidden body</p>");
    expect(html.match(/<div class="nfm-column">/g)).toHaveLength(2);
  });

  it("renders colored Tabler callout icons in standalone HTML and PDF output", () => {
    const markdown = calloutWithIcon({
      version: 1,
      kind: "library",
      library: "tabler",
      name: "book",
      color: "blue",
    });
    for (const format of ["html", "pdf"] as const) {
      const html = exportedBody(markdown, format);
      expect(html).toMatch(/<span class="nfm-callout-icon"><svg[^>]*>/);
      expect(html).toContain('stroke="#337ea9"');
      expect(html).toContain("<p>Heads up</p>");
      expect(html).not.toContain("&quot;library&quot;");
    }
  });

  it("colors filled Tabler callout icons", () => {
    const html = exportedBody(
      calloutWithIcon({
        version: 1,
        kind: "library",
        library: "tabler",
        name: "star",
        variant: "filled",
        color: "red",
      }),
    );
    expect(html).toContain("tabler-icon-star-filled");
    expect(html).toContain("color:#c4554d");
  });

  it("renders uploaded callout images with safe URLs and escaped alt text", () => {
    const html = exportedBody(
      calloutWithIcon({
        version: 1,
        kind: "image",
        authority: "url",
        assetId: "https://example.com/icon.png?x=1&y=2",
        alt: 'Logo "square"',
      }),
    );
    expect(html).toContain(
      '<img src="https://example.com/icon.png?x=1&amp;y=2" alt="Logo &quot;square&quot;" />',
    );

    const unsafe = exportedBody(
      calloutWithIcon({
        version: 1,
        kind: "image",
        authority: "url",
        assetId: "javascript:alert(1)",
      }),
    );
    expect(unsafe).not.toContain("<img");
    expect(unsafe).not.toContain("javascript:");
  });

  it("expands toggles so a printed export cannot hide their content", () => {
    const html = exportedBody(
      ["<details>", "<summary>Appendix</summary>", "\tBody", "</details>"].join(
        "\n",
      ),
    );

    expect(html).toContain('<details class="nfm-details" open>');
  });

  it("renders heading toggles with their nested blocks", () => {
    const html = exportedBody(
      [
        '## Release notes {toggle="true"}',
        "\tIntro",
        "\t- Detail",
        "After",
      ].join("\n"),
    );

    expect(html).toContain("<h2>Release notes</h2>");
    expect(html).toContain("<p>Intro</p>");
    expect(html).toContain("<li>Detail</li>");
    expect(html).not.toContain('toggle="true"');
  });

  it("does not close a container on a tag inside a fenced code block", () => {
    const html = exportedBody(
      [
        "<callout>",
        "\t```md",
        "\t</callout>",
        "\t```",
        "\tAfter the example",
        "</callout>",
        "Sibling",
      ].join("\n"),
    );

    expect(html).toContain("&lt;/callout&gt;");
    expect(html).toContain("<p>After the example</p>");
    expect(html).toContain("<p>Sibling</p>");
  });

  it("escapes cell content rather than trusting authored HTML", () => {
    const html = exportedBody(
      [
        "<table>",
        "<tr>",
        '<td><img src=x onerror="alert(1)"></td>',
        "</tr>",
        "</table>",
      ].join("\n"),
    );

    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&lt;img");
  });

  it("leaves an unterminated table as text instead of swallowing the document", () => {
    const html = exportedBody(
      ["<table>", "<tr>", "<td>a</td>", "</tr>", "Trailing prose"].join("\n"),
    );

    expect(readTable(html)).toBeNull();
    expect(html).toContain("Trailing prose");
  });

  it("does not treat an inherited Object key as a container tag", () => {
    const html = exportedBody(
      ["<constructor>", "<td>x</td>", "</constructor>"].join("\n"),
    );

    expect(html).not.toContain("[object");
    expect(html).toContain("&lt;constructor&gt;");
  });

  it("ships the table stylesheet with print rules in PDF exports", () => {
    const payload = buildDocumentExport({
      id: "doc_1",
      title: "Report",
      content: docToNfm(TABLE_DOC),
      format: "pdf",
    });

    expect(payload.content).toContain("table.nfm-table");
    expect(payload.content).toContain("display: table-header-group");
  });

  it("renders tables in standalone HTML exports too", () => {
    expect(
      readTable(exportedBody(docToNfm(TABLE_DOC), "html"))!.body,
    ).toHaveLength(2);
  });

  it("keeps editable GFM column alignment in HTML export", () => {
    const source = "| Item | Price |\n| :--- | ---: |\n| A | $1 |";
    const html = exportedBody(docToNfm(nfmToDoc(source)), "html");
    expect(html).toContain('class="nfm-align-right"');
    expect(html).toContain("$1");
  });
});
