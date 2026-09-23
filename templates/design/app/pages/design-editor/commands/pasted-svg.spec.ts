// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { parsePastedSvg } from "./pasted-svg";

describe("parsePastedSvg", () => {
  it("preserves the copied SVG's intrinsic 17 by 9 size", () => {
    const pasted = parsePastedSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="9" viewBox="0 0 17 9"><path d="M0 0L17 9"/></svg>',
    );

    expect(pasted).not.toBeNull();
    expect(pasted).toMatchObject({ width: 17, height: 9 });
    expect(pasted?.svg).toContain('width="17"');
    expect(pasted?.svg).toContain('height="9"');
    expect(pasted?.svg).toContain('<path d="M0 0L17 9"');
  });

  it("infers one missing dimension from the viewBox aspect ratio", () => {
    const pasted = parsePastedSvg(
      '<svg width="34" viewBox="0 0 17 9"><rect width="17" height="9"/></svg>',
    );

    expect(pasted).toMatchObject({ width: 34, height: 18 });
  });

  it("accepts an SVG copied inside an HTML clipboard wrapper", () => {
    expect(
      parsePastedSvg(
        '<meta charset="utf-8"><div><svg width="17" height="9"><path d="M0 0h17"/></svg></div>',
      ),
    ).toMatchObject({ width: 17, height: 9 });
  });

  it("removes executable content and external references", () => {
    const pasted = parsePastedSvg(
      '<svg width="17" height="9" onload="bad()"><script>bad()</script><foreignObject><div>bad</div></foreignObject><image href="https://example.com/a.png"/><path d="M0 0h17" fill="url(https://example.com/a.svg#paint)"/></svg>',
    );

    expect(pasted?.svg).not.toContain("script");
    expect(pasted?.svg).not.toContain("foreignObject");
    expect(pasted?.svg).not.toContain("onload");
    expect(pasted?.svg).not.toContain("https://example.com");
    expect(pasted?.svg).toContain('<path d="M0 0h17"');
  });

  it("keeps local gradient paint definitions used by drawable paths", () => {
    const pasted = parsePastedSvg(
      '<svg width="17" height="9"><defs><linearGradient id="paint"><stop offset="0" stop-color="#123456"/></linearGradient></defs><path d="M0 0h17" fill="url(#paint)"/></svg>',
    );

    expect(pasted?.svg).toContain("<linearGradient");
    expect(pasted?.svg).toContain('fill="url(#paint)"');
  });

  it.each([
    "",
    "<svg width='17' height='9'></svg>",
    "<svg><path d='M0 0h17'/></svg>",
    "<svg width='17' height='9'><path d='M0 0h17'/></svg><svg width='1' height='1'><circle r='1'/></svg>",
    "<svg width='17' height='9'><defs><linearGradient id='paint'><stop stop-color='#fff'/></linearGradient></defs></svg>",
    "<svg viewBox='0 0 1000000000 1000000000'><path d='M0 0h1'/></svg>",
  ])("rejects ambiguous or non-drawable input (%s)", (source) => {
    expect(parsePastedSvg(source)).toBeNull();
  });
});
