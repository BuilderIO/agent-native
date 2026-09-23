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

  it("preserves fractional dimensions from Figma vector clipboard data", () => {
    const pasted = parsePastedSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="17.5" height="9.5" viewBox="0 0 17.5 9.5"><path d="M0 0L17.5 9.5"/></svg>',
    );

    expect(pasted).toMatchObject({ width: 17.5, height: 9.5 });
    expect(pasted?.svg).toContain('width="17.5"');
    expect(pasted?.svg).toContain('height="9.5"');
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
    const scopedId = pasted?.svg.match(/linearGradient id="([^"]+)"/)?.[1];
    expect(scopedId).toMatch(/^an-pasted-/);
    expect(pasted?.svg).toContain(`fill="url(#${scopedId})"`);
  });

  it.each([
    'fill="u\\72l(https://attacker.example/paint.svg#p)"',
    'style="fill:u\\000072l(https://attacker.example/paint.svg#p)"',
    'fill="u/**/rl(https://attacker.example/paint.svg#p)"',
  ])(
    "removes external paint URLs hidden by CSS escapes or comments (%s)",
    (paint) => {
      const pasted = parsePastedSvg(
        `<svg width="17" height="9"><path d="M0 0h17" ${paint}/></svg>`,
      );

      expect(pasted?.svg).not.toMatch(/attacker\.example|url\(/i);
      expect(pasted?.svg).toContain('<path d="M0 0h17"');
    },
  );

  it("reads dimensions from CSS width and height declarations", () => {
    expect(
      parsePastedSvg(
        '<svg style="width:17px;height:9px"><path d="M0 0h17"/></svg>',
      ),
    ).toMatchObject({ width: 17, height: 9 });
  });

  it("scopes repeated SVG IDs while keeping local paint references connected", () => {
    const source =
      '<svg width="17" height="9"><defs><linearGradient id="paint"><stop offset="0" stop-color="#123456"/></linearGradient></defs><path d="M0 0h17" fill="u\\72l(#paint)"/></svg>';
    const first = parsePastedSvg(source)?.svg;
    const second = parsePastedSvg(source)?.svg;
    const firstId = first?.match(/linearGradient id="([^"]+)"/)?.[1];
    const secondId = second?.match(/linearGradient id="([^"]+)"/)?.[1];

    expect(firstId).toMatch(/^an-pasted-/);
    expect(secondId).toMatch(/^an-pasted-/);
    expect(secondId).not.toBe(firstId);
    expect(first).toContain(`fill="url(#${firstId})"`);
    expect(second).toContain(`fill="url(#${secondId})"`);
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
