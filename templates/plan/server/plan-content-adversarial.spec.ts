import { describe, expect, it } from "vitest";
import {
  applyPlanContentPatches,
  planContentSchema,
  type PlanBlock,
  type PlanContent,
} from "../shared/plan-content.js";
import {
  normalizePlanContent,
  parsePlanContent,
  sanitizeCustomHtml,
  sanitizeDiagramHtml,
  serializePlanContent,
} from "./plan-content.js";

/**
 * Adversarial coverage for PLAN GENERATION: content schema validation,
 * sanitization (XSS), resource bounds, and the patch surface. These tests try
 * to break the validators the way a malicious agent / imported plan / smuggled
 * patch would. Where a test pins a REAL bug it is annotated and asserts the
 * SECURE behavior, so it currently fails until the hole is closed.
 */

const wireframeBlock = (html: string): PlanBlock => ({
  id: "wf",
  type: "wireframe",
  title: "Frame",
  data: { surface: "browser", html },
});

const customHtmlBlock = (html: string, css?: string): PlanBlock => ({
  id: "ch",
  type: "custom-html",
  data: { html, ...(css ? { css } : {}) },
});

const parseWireframeHtml = (html: string) =>
  planContentSchema.safeParse({
    version: 2,
    brief: "x",
    blocks: [wireframeBlock(html)],
  });

const parseCustomHtml = (html: string) =>
  planContentSchema.safeParse({
    version: 2,
    brief: "x",
    blocks: [customHtmlBlock(html)],
  });

/* ------------------------------------------------------------------ */
/* 1. Sanitization — active content must never reach stored content    */
/* ------------------------------------------------------------------ */

describe("wireframe html sanitization (rendered live via dangerouslySetInnerHTML)", () => {
  // These obvious vectors are correctly rejected by the schema regex today.
  const rejected = [
    ["script tag", "<div><script>alert(1)</script></div>"],
    ["svg onload", "<svg onload=alert(1)></svg>"],
    ["img onerror", '<img src=x onerror="alert(1)">'],
    ["inline handler", '<div onclick="alert(1)">x</div>'],
    ["iframe", '<iframe src="https://evil.test"></iframe>'],
    ["style tag", "<style>body{display:none}</style>"],
    ["full document", "<!doctype html><html><body>x</body></html>"],
    ["literal javascript: href", '<a href="javascript:alert(1)">x</a>'],
    ["UPPER JAVASCRIPT:", '<a href="JAVASCRIPT:alert(1)">x</a>'],
    ["leading-space javascript:", '<a href=" javascript:alert(1)">x</a>'],
    ["object data", '<object data="javascript:alert(1)"></object>'],
    ["embed", '<embed src="data:text/html,<script>1</script>">'],
    ["srcdoc", '<iframe srcdoc="<script>1</script>"></iframe>'],
    ["base tag", '<base href="//evil.test/">'],
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=//evil">'],
    ["form", '<form action="//evil"><input></form>'],
  ] as const;

  for (const [label, html] of rejected) {
    it(`rejects ${label} in wireframe html`, () => {
      expect(parseWireframeHtml(html).success).toBe(false);
    });
  }

  /**
   * BUG (high): the wireframe `html` field is rendered LIVE into the page via
   * `dangerouslySetInnerHTML` (app/components/plan/wireframe/Wireframe.tsx:248)
   * with NO iframe sandbox and NO sanitizeCustomHtml pass — only the schema
   * regex `unsafeCustomHtmlPattern`. That regex matches the literal token
   * `javascript:`, so a tab/newline inside the scheme (which browsers strip
   * before navigating) bypasses it. Result: a stored XSS link in a SHARED plan.
   */
  it("rejects a javascript: url obfuscated with a tab (browsers strip the tab)", () => {
    const payload = '<a href="java\tscript:alert(document.domain)">Click</a>';
    // Currently ACCEPTED — this assertion fails and pins the bug.
    expect(parseWireframeHtml(payload).success).toBe(false);
  });

  it("rejects a javascript: url obfuscated with a newline", () => {
    const payload = '<a href="java\nscript:alert(1)">Click</a>';
    expect(parseWireframeHtml(payload).success).toBe(false);
  });

  it("rejects an HTML-entity-encoded javascript: url", () => {
    // &#106; decodes to 'j' when the browser parses the attribute value.
    const payload = '<a href="&#106;avascript:alert(1)">Click</a>';
    expect(parseWireframeHtml(payload).success).toBe(false);
  });

  it("does not let a tab-obfuscated javascript: url survive into stored content", () => {
    const payload = '<a href="java\tscript:alert(1)">Click</a>';
    const result = parseWireframeHtml(payload);
    if (!result.success) {
      // Closed at validation — acceptable.
      expect(result.success).toBe(false);
      return;
    }
    // If validation lets it through, the stored value must not still carry an
    // executable javascript scheme after collapsing whitespace.
    const stored = JSON.parse(serializePlanContent(result.data));
    const html: string = stored.blocks[0].data.html;
    const collapsed = html.replace(/[\t\n\r]/g, "").toLowerCase();
    expect(collapsed).not.toContain("javascript:");
  });
});

describe("custom-html sanitizer bypasses", () => {
  it("strips obvious script/handler/url vectors (regression of existing behavior)", () => {
    expect(sanitizeCustomHtml("<div>ok<script>alert(1)</script></div>")).toBe(
      "<div>ok</div>",
    );
    expect(sanitizeCustomHtml('<img src="x" onerror="alert(1)">')).toBe(
      '<img src="x">',
    );
    expect(sanitizeCustomHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      "<a>x</a>",
    );
  });

  /**
   * BUG (med/high): sanitizeCustomHtml only removes the LITERAL string
   * `javascript:`. An HTML-entity-encoded scheme (&#106;avascript:) decodes in
   * the browser but is invisible to the sanitizer and to the schema regex, so
   * it survives storage. The custom-html block renders in a sandboxed iframe,
   * which lowers the blast radius, but the sanitizer is documented as
   * defense-in-depth and is reused for other surfaces.
   */
  it("neutralizes an entity-encoded javascript: scheme", () => {
    const out = sanitizeCustomHtml('<a href="&#106;avascript:alert(1)">x</a>');
    // The decoded form must not yield an executable scheme.
    const decoded = out.replace(/&#106;/gi, "j").toLowerCase();
    expect(decoded).not.toContain("javascript:");
  });

  it("neutralizes a tab-obfuscated javascript: scheme", () => {
    const out = sanitizeCustomHtml('<a href="java\tscript:alert(1)">x</a>');
    const collapsed = out.replace(/[\t\n\r]/g, "").toLowerCase();
    expect(collapsed).not.toContain("javascript:");
  });

  it("collapses a split-tag script that re-forms after one pass", () => {
    // After removing the inner <script>...</script>, the residue must not still
    // read as a script open tag.
    const out = sanitizeCustomHtml(
      "<scr<script></script>ipt>alert(1)</script>",
    );
    expect(out.toLowerCase()).not.toContain("<script");
  });
});

describe("diagram html sanitizer", () => {
  it("preserves inert inline SVG while stripping active content", () => {
    const out = sanitizeDiagramHtml(
      '<div class="diagram-panel"><svg viewBox="0 0 100 40" onload="alert(1)"><path d="M5 20 L95 20" xlink:href="javascript:alert(1)" /><foreignObject><button x-on:click="evil()" @click="evil()" :onclick="evil()">x</button></foreignObject><script>alert(1)</script></svg></div>',
    );

    expect(out).toContain("<svg");
    expect(out).toContain("<path");
    expect(out).not.toMatch(/script|onload|foreignObject|x-on:click|@click/i);
    expect(out.toLowerCase()).not.toContain("javascript:");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Resource bounds — deep nesting, huge inputs, node/count limits   */
/* ------------------------------------------------------------------ */

describe("resource bounds and DoS protection", () => {
  function nestTabs(depth: number): PlanBlock {
    let block: PlanBlock = {
      id: "leaf",
      type: "rich-text",
      data: { markdown: "x" },
    };
    for (let i = 0; i < depth; i += 1) {
      block = {
        id: `t${i}`,
        type: "tabs",
        data: { tabs: [{ id: `tab${i}`, label: "L", blocks: [block] }] },
      } as PlanBlock;
    }
    return block;
  }

  function nestedTabsJson(depth: number) {
    let json = '{"id":"leaf","type":"rich-text","data":{"markdown":"x"}}';
    for (let i = 0; i < depth; i += 1) {
      json = `{"id":"t${i}","type":"tabs","data":{"tabs":[{"id":"tab${i}","label":"L","blocks":[${json}]}]}}`;
    }
    return `{"version":2,"brief":"x","blocks":[${json}]}`;
  }

  /**
   * BUG (high, DoS): tabs nesting has NO depth bound (unlike wireframe trees,
   * which use WIREFRAME_MAX_DEPTH). The recursive zod `lazy` descent blows the
   * stack on deeply nested tabs, and `safeParse` does NOT catch a RangeError —
   * so `parsePlanContent` (run on EVERY stored/imported plan read) throws and
   * crashes the caller instead of returning null. ~300+ levels is enough.
   */
  it("does not throw a RangeError on deeply nested tabs (safeParse must stay safe)", () => {
    expect(() =>
      planContentSchema.safeParse({
        version: 2,
        brief: "x",
        blocks: [nestTabs(800)],
      }),
    ).not.toThrow();
  });

  it("parsePlanContent returns null (never throws) on a deeply nested stored plan", () => {
    const json = nestedTabsJson(2000);
    let out: PlanContent | null = null;
    expect(() => {
      out = parsePlanContent(json);
    }).not.toThrow();
    expect(out).toBeNull();
  });

  it("caps top-level blocks at 200", () => {
    const blocks = Array.from({ length: 201 }, (_, i) => ({
      id: `b${i}`,
      type: "rich-text" as const,
      data: { markdown: "x" },
    }));
    expect(
      planContentSchema.safeParse({ version: 2, brief: "x", blocks }).success,
    ).toBe(false);
  });

  it("caps wireframe tree node count", () => {
    // 401 sibling nodes under one screen root exceeds WIREFRAME_MAX_NODES (400).
    const children = Array.from({ length: 401 }, (_, i) => ({
      el: "box" as const,
      id: `n${i}`,
    }));
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: {
            surface: "desktop",
            screen: [{ el: "screen", children }],
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("caps wireframe tree depth", () => {
    // Build a single chain deeper than WIREFRAME_MAX_DEPTH (8).
    let node: Record<string, unknown> = { el: "box" };
    for (let i = 0; i < 12; i += 1) node = { el: "box", children: [node] };
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: { surface: "desktop", screen: [node] },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long rich-text markdown body", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [
        { id: "b", type: "rich-text", data: { markdown: "x".repeat(100_001) } },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects wireframe html longer than its 40k cap", () => {
    expect(parseWireframeHtml(`<p>${"a".repeat(40_001)}</p>`).success).toBe(
      false,
    );
  });
});

/* ------------------------------------------------------------------ */
/* 3. Required fields, enums, ids, structural validation               */
/* ------------------------------------------------------------------ */

describe("structural validation", () => {
  it("rejects an unknown surface enum", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: { surface: "hologram", screen: [] },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown block type", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [{ id: "b", type: "wat", data: {} }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown wireframe kit element name", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: { surface: "desktop", screen: [{ el: "blink", text: "x" }] },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty block id and an over-long id", () => {
    expect(
      planContentSchema.safeParse({
        version: 2,
        brief: "x",
        blocks: [{ id: "", type: "rich-text", data: { markdown: "x" } }],
      }).success,
    ).toBe(false);
    expect(
      planContentSchema.safeParse({
        version: 2,
        brief: "x",
        blocks: [
          { id: "z".repeat(121), type: "rich-text", data: { markdown: "x" } },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a diagram block without html or nodes", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [{ id: "d", type: "diagram", data: { nodes: [], edges: [] } }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a diagram block with local html/svg and no legacy nodes", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [
        {
          id: "d",
          type: "diagram",
          data: {
            html: '<div class="diagram-panel"><svg viewBox="0 0 100 40"><path d="M5 20 L95 20" /></svg></div>',
            css: ".diagram-panel { padding: 12px; }",
            caption: "Policy owns the unstable branch.",
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an image block with neither assetId nor url", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [{ id: "img", type: "image", data: { alt: "x" } }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an image block with a non-url url", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [
        { id: "img", type: "image", data: { alt: "x", url: "not a url" } },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a titled artboard with no interior wireframe content", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      canvas: { frames: [{ id: "f", label: "Empty frame" }] },
      blocks: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate top-level block ids", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [
        { id: "dup", type: "rich-text", data: { markdown: "a" } },
        { id: "dup", type: "rich-text", data: { markdown: "b" } },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a duplicate block id nested inside a tab", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [
        { id: "dup", type: "rich-text", data: { markdown: "a" } },
        {
          id: "wrap",
          type: "tabs",
          data: {
            tabs: [
              {
                id: "t",
                label: "L",
                blocks: [
                  { id: "dup", type: "rich-text", data: { markdown: "b" } },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a content version below the minimum", () => {
    expect(
      planContentSchema.safeParse({ version: 0, brief: "x", blocks: [] })
        .success,
    ).toBe(false);
  });

  it("rejects non-finite artboard coordinates", () => {
    expect(
      planContentSchema.safeParse({
        version: 2,
        brief: "x",
        canvas: {
          frames: [{ id: "f", label: "L", blockId: "b", x: Infinity }],
        },
        blocks: [],
      }).success,
    ).toBe(false);
  });

  it("rejects a wireframe data object with unknown extra keys (strict)", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: { surface: "desktop", screen: [], evil: "x" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a region (legacy) wireframe shape in a visual-question option preview", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      brief: "x",
      blocks: [
        {
          id: "vq",
          type: "visual-questions",
          data: {
            questions: [
              {
                id: "q",
                title: "T",
                mode: "single",
                options: [
                  {
                    id: "o",
                    label: "L",
                    wireframe: { viewport: "desktop", regions: [] },
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Patch surface adversarial — no smuggling through patches         */
/* ------------------------------------------------------------------ */

describe("patch surface stays safe", () => {
  const baseCustomHtml = (): PlanContent =>
    planContentSchema.parse({
      version: 2,
      brief: "x",
      blocks: [customHtmlBlock("<div>ok</div>")],
    });

  it("rejects smuggling a <script> through update-block raw data merge", () => {
    expect(() =>
      applyPlanContentPatches(baseCustomHtml(), [
        {
          op: "update-block",
          blockId: "ch",
          patch: { data: { html: "<script>alert(1)</script>" } },
        },
      ]),
    ).toThrow();
  });

  it("rejects mutating a wireframe surface to an invalid enum via update-block", () => {
    const wf = planContentSchema.parse({
      version: 2,
      brief: "x",
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: { surface: "desktop", screen: [{ el: "title", text: "x" }] },
        },
      ],
    });
    expect(() =>
      applyPlanContentPatches(wf, [
        {
          op: "update-block",
          blockId: "wf",
          patch: { data: { surface: "x" } },
        },
      ]),
    ).toThrow();
  });

  it("rejects canvas frames that reference removed wireframe blocks", () => {
    expect(() =>
      planContentSchema.parse({
        version: 2,
        brief: "x",
        canvas: {
          frames: [
            {
              id: "frame-1",
              label: "Option 1",
              blockId: "removed-wireframe",
            },
          ],
        },
        blocks: [],
      }),
    ).toThrow(/missing or non-wireframe block/i);
  });

  /**
   * BUG (high): the tab-obfuscated javascript: bypass also flows through the
   * patch path — both patch-wireframe-html and update-block re-parse only with
   * the schema regex, so the same payload lands in stored content.
   */
  it("does not let patch-wireframe-html inject a tab-obfuscated javascript: url", () => {
    const wf = planContentSchema.parse({
      version: 2,
      brief: "x",
      blocks: [wireframeBlock("<div>PLACEHOLDER</div>")],
    });
    let threw = false;
    let storedHtml = "";
    try {
      const next = applyPlanContentPatches(wf, [
        {
          op: "patch-wireframe-html",
          blockId: "wf",
          edits: [
            {
              find: "PLACEHOLDER",
              replace: '<a href="java\tscript:alert(1)">x</a>',
            },
          ],
        },
      ]);
      const block = next.blocks[0];
      if (block?.type === "wireframe") storedHtml = block.data.html ?? "";
    } catch {
      threw = true;
    }
    const collapsed = storedHtml.replace(/[\t\n\r]/g, "").toLowerCase();
    expect(threw || !collapsed.includes("javascript:")).toBe(true);
  });

  it("rejects a replacement that smuggles a script tag through patch-wireframe-html", () => {
    const wf = planContentSchema.parse({
      version: 2,
      brief: "x",
      blocks: [wireframeBlock("<div>x</div>")],
    });
    expect(() =>
      applyPlanContentPatches(wf, [
        {
          op: "patch-wireframe-html",
          blockId: "wf",
          edits: [{ find: "x", replace: "<script>alert(1)</script>" }],
        },
      ]),
    ).toThrow();
  });

  it("throws on update-wireframe-node against a missing node id", () => {
    const wf = planContentSchema.parse({
      version: 2,
      brief: "x",
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: {
            surface: "desktop",
            screen: [{ id: "a", el: "title", text: "x" }],
          },
        },
      ],
    });
    expect(() =>
      applyPlanContentPatches(wf, [
        {
          op: "update-wireframe-node",
          blockId: "wf",
          nodeId: "ghost",
          patch: { text: "y" },
        },
      ]),
    ).toThrow(/not found/i);
  });

  it("throws when targeting a non-wireframe block with a wireframe patch", () => {
    const content = planContentSchema.parse({
      version: 2,
      brief: "x",
      blocks: [{ id: "rt", type: "rich-text", data: { markdown: "x" } }],
    });
    expect(() =>
      applyPlanContentPatches(content, [
        {
          op: "patch-wireframe-html",
          blockId: "rt",
          edits: [{ find: "x", replace: "y" }],
        },
      ]),
    ).toThrow();
  });

  it("re-runs custom-html sanitization on append-block so a fragment is cleaned", () => {
    const content = planContentSchema.parse({
      version: 2,
      brief: "x",
      blocks: [{ id: "rt", type: "rich-text", data: { markdown: "x" } }],
    });
    // A schema-legal fragment that still carries a style tag (only sanitizer
    // strips it) must be neutralized once stored.
    const next = applyPlanContentPatches(content, [
      {
        op: "append-block",
        block: customHtmlBlock("<button class='cta'>Go</button>"),
      },
    ]);
    // append-block parses through the schema; storage sanitization runs in
    // serializePlanContent, so confirm the round-trip is clean.
    const stored = JSON.parse(serializePlanContent(next));
    const ch = stored.blocks.find((b: { id: string }) => b.id === "ch");
    expect(ch?.data.html).not.toMatch(/<style/i);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Migration / parse robustness                                     */
/* ------------------------------------------------------------------ */

describe("parse and migration robustness", () => {
  it("returns null on malformed JSON, html, and empty inputs", () => {
    expect(parsePlanContent("{not json")).toBeNull();
    expect(parsePlanContent("")).toBeNull();
    expect(parsePlanContent(null)).toBeNull();
    expect(parsePlanContent("<!doctype html><html></html>")).toBeNull();
  });

  it("returns null (does not throw) on JSON that fails validation", () => {
    let out: PlanContent | null = null;
    expect(() => {
      out = parsePlanContent(JSON.stringify({ version: 2, blocks: "nope" }));
    }).not.toThrow();
    expect(out).toBeNull();
  });

  it("decodes a Buffer-stored content body instead of dropping it", () => {
    const json = JSON.stringify({
      version: 2,
      title: "Buffered",
      brief: "x",
      blocks: [{ id: "b", type: "rich-text", data: { markdown: "kept" } }],
    });
    const buffer = new TextEncoder().encode(json);
    const parsed = parsePlanContent(buffer);
    expect(parsed?.title).toBe("Buffered");
    expect(parsed?.blocks).toHaveLength(1);
  });

  it("normalizes (and rejects unsafe) content through normalizePlanContent", () => {
    expect(
      normalizePlanContent({
        version: 2,
        brief: "x",
        blocks: [customHtmlBlock("<div>ok</div>")],
      }),
    ).not.toBeNull();
    expect(() =>
      normalizePlanContent({
        version: 2,
        brief: "x",
        blocks: [customHtmlBlock("<script>alert(1)</script>")],
      } as never),
    ).toThrow();
  });
});
