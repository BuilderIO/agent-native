import { describe, expect, it } from "vitest";

import { renderMathToHtml } from "./math-rendering";

describe("math rendering", () => {
  it("renders inline math with accessible MathML", () => {
    const result = renderMathToHtml("E = mc^2", false);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain('class="katex"');
    expect(result.html).toContain('class="katex-mathml"');
    expect(result.html).toContain("E = mc^2");
  });

  it("renders block math in display mode", () => {
    const result = renderMathToHtml("\\int_0^1 x^2 dx", true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain('class="katex-display"');
  });

  it("returns a structured error without discarding invalid source", () => {
    const result = renderMathToHtml("\\frac{", false);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("KaTeX parse error");
  });

  it("does not create trusted links from user-authored commands", () => {
    const result = renderMathToHtml(
      "\\href{javascript:alert(1)}{unsafe}",
      false,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toContain('href="javascript:');
  });
});
