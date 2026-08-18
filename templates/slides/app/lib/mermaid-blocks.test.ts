import { describe, expect, it } from "vitest";

import { extractMermaidBlocks } from "./mermaid-blocks";

describe("extractMermaidBlocks", () => {
  it("extracts a mermaid block's raw, untouched definition", () => {
    const content =
      '<div class="fmd-slide"><div class="mermaid">\ngraph TD\n    A[Start] --> B{Decision}\n</div></div>';

    const { blocks, contentWithPlaceholders } = extractMermaidBlocks(content);

    expect(blocks).toEqual(["graph TD\n    A[Start] --> B{Decision}"]);
    expect(contentWithPlaceholders).toBe(
      '<div class="fmd-slide"><div data-mermaid-index="0"></div></div>',
    );
    // The extracted definition must never have its arrows HTML-escaped.
    expect(blocks[0]).not.toContain("&gt;");
  });

  it("extracts multiple mermaid blocks in order", () => {
    const content =
      '<div class="mermaid">graph TD\nA --> B</div>' +
      "<p>middle</p>" +
      '<div class="mermaid">graph LR\nC --> D</div>';

    const { blocks, contentWithPlaceholders } = extractMermaidBlocks(content);

    expect(blocks).toEqual(["graph TD\nA --> B", "graph LR\nC --> D"]);
    expect(contentWithPlaceholders).toBe(
      '<div data-mermaid-index="0"></div><p>middle</p><div data-mermaid-index="1"></div>',
    );
  });

  it("returns no blocks and unchanged content when there is no mermaid div", () => {
    const content = '<div class="fmd-slide"><p>No diagram here</p></div>';

    const { blocks, contentWithPlaceholders } = extractMermaidBlocks(content);

    expect(blocks).toEqual([]);
    expect(contentWithPlaceholders).toBe(content);
  });
});
