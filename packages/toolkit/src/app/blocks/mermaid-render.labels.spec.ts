// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { sanitizeMermaidSvgMarkup } from "./mermaid-render.js";

// mermaid renders a node's label inside a foreignObject when the diagram look is handDrawn,
// and deleting every foreignObject left each node an empty box with no words in it (
// g.label present and empty, 0 <text>, 0 foreignObject, shapes intact). The label is kept and
// the dangerous parts of the foreignObject are removed instead.
const LABELLED = `<svg class="flowchart"><g class="nodes"><g class="rough-node"><g class="label">
<foreignObject width="80" height="24"><div xmlns="http://www.w3.org/1999/xhtml" style="display:table-cell"><span class="nodeLabel">Start</span></div></foreignObject>
</g></g></g></svg>`;

describe("sanitizeMermaidSvgMarkup keeps diagram labels", () => {
  it("keeps the label text that lives in a foreignObject", () => {
    const out = sanitizeMermaidSvgMarkup(LABELLED);
    expect(out).toContain("foreignObject");
    expect(out).toContain("Start");
  });

  it("still removes scripts, embedded documents and event handlers", () => {
    const hostile = `<svg><foreignObject><div><script>alert(1)</script><iframe src="https://example.test/x"></iframe><span onclick="alert(2)" style="color:red">Done</span><a href="javascript:alert(3)">x</a></div></foreignObject></svg>`;
    const out = sanitizeMermaidSvgMarkup(hostile);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("javascript:");
    // and the harmless parts of the label survive
    expect(out).toContain("Done");
  });
});
