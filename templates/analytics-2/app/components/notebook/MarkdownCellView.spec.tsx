import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MarkdownCellView,
  parseMarkdownBlocks,
  renderInline,
} from "./MarkdownCellView";

describe("parseMarkdownBlocks", () => {
  it("splits headings, paragraphs, lists, code and rules in order", () => {
    const blocks = parseMarkdownBlocks(
      [
        "# Orders",
        "",
        "Revenue by day.",
        "",
        "- EMEA",
        "- APAC",
        "",
        "```sql",
        "select 1",
        "```",
        "",
        "---",
      ].join("\n"),
    );
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "code",
      "rule",
    ]);
    expect(blocks[2]).toEqual({
      type: "list",
      ordered: false,
      items: ["EMEA", "APAC"],
    });
    expect(blocks[3]).toEqual({
      type: "code",
      language: "sql",
      text: "select 1",
    });
  });

  it("treats an unclosed fence as code to the end and joins wrapped paragraphs", () => {
    const blocks = parseMarkdownBlocks("one\ntwo\n\n```\ncode");
    expect(blocks[0]).toEqual({ type: "paragraph", text: "one two" });
    expect(blocks[1]).toEqual({ type: "code", language: null, text: "code" });
  });

  it("keeps numbered lists separate from bullets", () => {
    const blocks = parseMarkdownBlocks("1. first\n2. second");
    expect(blocks[0]).toEqual({
      type: "list",
      ordered: true,
      items: ["first", "second"],
    });
  });
});

describe("renderInline", () => {
  it("renders code, bold, italic and http links from plain text", () => {
    const html = renderToStaticMarkup(
      <MarkdownCellView
        markdown={
          "Use `select` with **care** and *speed*, see [docs](https://example.test/x)."
        }
      />,
    );
    expect(html).toContain('<code class="nb-md-code">select</code>');
    expect(html).toContain("<strong>care</strong>");
    expect(html).toContain("<em>speed</em>");
    expect(html).toContain('href="https://example.test/x"');
  });

  it("never links a non-http target and never injects markup", () => {
    const html = renderToStaticMarkup(
      <MarkdownCellView
        markdown={"[x](javascript:alert(1)) <img src=x onerror=1>"}
      />,
    );
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    // The link text survives as plain text.
    expect(renderInline("[x](javascript:void)")).toHaveLength(1);
  });
});

describe("markdown fidelity", () => {
  const render = (markdown: string) =>
    renderToStaticMarkup(<MarkdownCellView markdown={markdown} />);

  it("keeps underscores inside identifiers and URLs literal", () => {
    const html = render(
      "select * from my_table_name where x_y; see https://a.test/my_page_name and __init__ vs _note_",
    );
    expect(html).toContain("from my_table_name where x_y");
    expect(html).toContain("https://a.test/my_page_name");
    expect(html).toContain("<strong>init</strong>");
    expect(html).toContain("<em>note</em>");
    expect(html.match(/<em>/g)).toHaveLength(1);
  });

  it("does not italicize spaced asterisks used as multiplication", () => {
    const html = render("2 * 3 * 4 = 24, but *bold idea*");
    expect(html).toContain("2 * 3 * 4 = 24");
    expect(html).toContain("<em>bold idea</em>");
  });

  it("renders links and emphasis nested in emphasis and link text", () => {
    const html = render(
      "**[docs](https://x.test)** and [**big** news](https://y.test)",
    );
    expect(html).toContain('<strong><a href="https://x.test"');
    expect(html).toContain("<strong>big</strong> news</a>");
    expect(html).not.toContain("](");
  });

  it("keeps one numbered list across blank lines and honors its first number", () => {
    const loose = render("1. a\n\n2. b\n\n3. c");
    expect(loose.match(/<ol/g)).toHaveLength(1);
    expect(loose.match(/<li>/g)).toHaveLength(3);
    expect(render("3. three\n4. four")).toContain(
      '<ol class="nb-md-list" start="3">',
    );
    expect(render("- a\n\n- b").match(/<ul/g)).toHaveLength(1);
  });

  it("merges consecutive quote lines into one quote", () => {
    const html = render("> first\n> second\n\n> other");
    expect(html.match(/<blockquote/g)).toHaveLength(2);
    expect(html).toContain("first second");
  });
});

describe("MarkdownCellView", () => {
  it("states that an empty cell has no content", () => {
    const html = renderToStaticMarkup(<MarkdownCellView markdown={"  \n "} />);
    expect(html).toContain("This markdown cell is empty.");
  });
});
