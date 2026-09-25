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

  it("accepts an uppercase SVG root and strips editor-only opacity metadata", () => {
    const pasted = parsePastedSvg(
      '<SVG width="17" height="9"><path d="M0 0h17" data-an-open-fill-opacity="forged"/><defs><clipPath id="clip"><path d="M0 0h5" data-an-open-fill-opacity="forged"/></clipPath></defs></SVG>',
    );

    expect(pasted).toMatchObject({ width: 17, height: 9 });
    expect(pasted?.svg).not.toContain("data-an-open-fill-opacity");
  });

  it("preserves fractional dimensions from Figma vector clipboard data", () => {
    const pasted = parsePastedSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="17.5" height="9.5" viewBox="0 0 17.5 9.5"><path d="M0 0L17.5 9.5"/></svg>',
    );

    expect(pasted).toMatchObject({ width: 17.5, height: 9.5 });
    expect(pasted?.svg).toContain('width="17.5"');
    expect(pasted?.svg).toContain('height="9.5"');
  });

  it("keeps simple 1:1 pasted paths editable with the Pen tool", () => {
    const pasted = parsePastedSvg(
      '<svg width="80" height="40" viewBox="0 0 80 40"><path d="M0 0L30 0L30 30L0 30Z" fill="#f97316"/></svg>',
    );

    const root = new DOMParser().parseFromString(
      pasted!.svg,
      "image/svg+xml",
    ).documentElement;
    expect(JSON.parse(root.getAttribute("data-an-pen-nodes")!)).toEqual([
      1,
      [0, 0, null, null, null, null, null],
      [30, 0, null, null, null, null, null],
      [30, 30, null, null, null, null, null],
      [0, 30, null, null, null, null, null],
    ]);
  });

  it("keeps relative and quadratic 1:1 paths editable", () => {
    const pasted = parsePastedSvg(
      '<svg width="80" height="40" viewBox="0 0 80 40"><path d="M0 0h30v30q10 10 20 0L0 30Z"/></svg>',
    );
    const root = new DOMParser().parseFromString(
      pasted!.svg,
      "image/svg+xml",
    ).documentElement;
    const nodes = JSON.parse(root.getAttribute("data-an-pen-nodes")!);

    expect(nodes[0]).toBe(1);
    expect(nodes.slice(1).map((node: number[]) => node.slice(0, 2))).toEqual([
      [0, 0],
      [30, 0],
      [30, 30],
      [50, 30],
      [0, 30],
    ]);
    expect(nodes[3]!.slice(4, 6)).toEqual([
      30 + (10 * 2) / 3,
      30 + (10 * 2) / 3,
    ]);
    expect(nodes[4]!.slice(2, 4)).toEqual([
      30 + (20 * 2) / 3,
      30 + (10 * 2) / 3,
    ]);
  });

  it("keeps untransformed grouped paths independently editable", () => {
    const pasted = parsePastedSvg(
      '<svg width="80" height="40" viewBox="0 0 80 40"><g><path d="M0 0L30 0L30 30Z"/><path d="M50 0L80 0L80 30Z"/></g></svg>',
    );
    const root = new DOMParser().parseFromString(
      pasted!.svg,
      "image/svg+xml",
    ).documentElement;
    const paths = Array.from(root.querySelectorAll("g > path"));

    expect(root.hasAttribute("data-an-pen-nodes")).toBe(false);
    expect(paths).toHaveLength(2);
    expect(paths.map((path) => path.hasAttribute("data-an-pen-nodes"))).toEqual(
      [true, true],
    );
    expect(
      paths.map((path) => JSON.parse(path.getAttribute("data-an-pen-nodes")!)),
    ).toEqual([
      [
        1,
        [0, 0, null, null, null, null, null],
        [30, 0, null, null, null, null, null],
        [30, 30, null, null, null, null, null],
      ],
      [
        1,
        [50, 0, null, null, null, null, null],
        [80, 0, null, null, null, null, null],
        [80, 30, null, null, null, null, null],
      ],
    ]);
  });

  it("does not mark paths used only for SVG definitions as editable", () => {
    const pasted = parsePastedSvg(
      '<svg width="80" height="40" viewBox="0 0 80 40"><defs><clipPath id="clip"><path d="M0 0L10 0L10 10Z"/></clipPath></defs><path clip-path="url(#clip)" d="M0 0L30 0L30 30Z"/></svg>',
    );
    const root = new DOMParser().parseFromString(
      pasted!.svg,
      "image/svg+xml",
    ).documentElement;

    expect(
      root.querySelector("clipPath path")?.hasAttribute("data-an-pen-nodes"),
    ).toBe(false);
    expect(
      root.querySelector(":scope > path")?.hasAttribute("data-an-pen-nodes"),
    ).toBe(true);
  });

  it.each([
    '<svg width="80" height="40" viewBox="0 0 80 40"><path d="M0 0L30 0M40 0L70 0"/></svg>',
    '<svg width="80" height="40" viewBox="0 0 80 40"><path d="M0 0L30 0?"/></svg>',
    '<svg width="80" height="40" viewBox="0 0 80 40"><path transform="scale(2)" d="M0 0L30 0L30 30Z"/></svg>',
    '<svg width="80" height="40" viewBox="0 0 80 40" style="transform:scale(2)"><path d="M0 0L30 0L30 30Z"/></svg>',
    '<svg width="80" height="40" viewBox="0 0 80 40"><path style="transform:scale(2)" d="M0 0L30 0L30 30Z"/></svg>',
    '<svg width="80" height="40" viewBox="0 0 80 40"><g transform="scale(2)"><path d="M0 0L30 0L30 30Z"/></g></svg>',
    '<svg width="80" height="40" viewBox="10 0 80 40"><path d="M0 0L30 0L30 30Z"/></svg>',
  ])("leaves non-round-trippable clipboard paths unmarked (%s)", (source) => {
    const pasted = parsePastedSvg(source);

    expect(pasted?.svg).not.toContain("data-an-pen-nodes");
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

  it("parses quoted self-closing text without mistaking it for an SVG tag", () => {
    const pasted = parsePastedSvg(
      '<svg width="17" height="9" data-note="/>"><path d="M0 0h17"/></svg>',
    );

    expect(pasted).toMatchObject({ width: 17, height: 9 });
    expect(pasted?.svg).toContain('<path d="M0 0h17"');
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
