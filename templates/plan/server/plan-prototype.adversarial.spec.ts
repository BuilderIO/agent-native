import { describe, expect, it } from "vitest";

import {
  applyPlanContentPatches,
  planContentSchema,
  type PlanBlock,
  type PlanContent,
} from "../shared/plan-content.js";
import {
  createPrototypeFromPlanContent,
  createPrototypePlanContent,
  normalizePlanContent,
  parsePlanContent,
  serializePlanContent,
} from "./plan-content.js";
import {
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
} from "./plan-mdx.js";

/**
 * Adversarial coverage for the NEW prototype feature + the
 * prosemirror-collab-serializer rewrite, focused on the four guarantees in the
 * QA charter:
 *
 *   1. JSON -> MDX -> JSON semantic equality with no data loss/drift, especially
 *      for content.prototype (screens + transitions + initialScreenId + state)
 *      and for prototype/canvas coexistence.
 *   2. Patch ops for the prototype surface (set/remove/update-screen/patch-html):
 *      idempotency, bad ids, missing-prototype, and sanitize-on-patch parity.
 *   3. parsePlanContent defensive fail-closed behavior (the landed try/catch):
 *      pathological deeply-nested tabs return null, never crash.
 *   4. Generated prototype content (createPrototypePlanContent /
 *      createPrototypeFromPlanContent) survives a round-trip.
 *
 * Tests prefixed "BUG:" pin a real defect and assert the CORRECT behavior, so
 * they FAIL until the defect is fixed. All others guard a currently-correct
 * invariant against regression.
 */

async function roundTrip(content: PlanContent): Promise<PlanContent> {
  const parsed = planContentSchema.parse(content);
  const folder = await exportPlanContentToMdxFolder({
    content: parsed,
    title: parsed.title ?? "Plan",
  });
  return parsePlanMdxFolder(folder);
}

/* -------------------------------------------------------------------------- */
/* 1. prototype.mdx round-trip: deep no-loss                                  */
/* -------------------------------------------------------------------------- */

describe("prototype.mdx round-trip (no data loss/drift)", () => {
  it("preserves transition id + trigger and per-state ids across the full screen set", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Deep prototype",
      prototype: {
        title: "Review",
        brief: "Does it feel right?",
        surface: "mobile",
        initialScreenId: "home",
        screens: [
          {
            id: "home",
            title: "Home",
            summary: "Reviewer sees the list.",
            surface: "mobile",
            html: '<div><button data-goto="detail">Open</button></div>',
            state: [
              { id: "st1", label: "Count", value: "3" },
              { id: "st2", label: "Mode", value: "edit" },
            ],
          },
          {
            id: "detail",
            title: "Detail",
            surface: "mobile",
            html: "<div><h1>Detail</h1></div>",
          },
        ],
        transitions: [
          {
            id: "tr1",
            from: "home",
            to: "detail",
            label: "Open",
            trigger: "tap a row",
          },
        ],
      },
      blocks: [{ id: "n", type: "rich-text", data: { markdown: "Notes." } }],
    };

    const result = await roundTrip(content);
    const proto = result.prototype;
    expect(proto?.surface).toBe("mobile");
    expect(proto?.initialScreenId).toBe("home");
    // Transition id + trigger must survive — the serializer emits them and the
    // parser reads them, so dropping either is silent data loss.
    expect(proto?.transitions?.[0]).toEqual({
      id: "tr1",
      from: "home",
      to: "detail",
      label: "Open",
      trigger: "tap a row",
    });
    // Per-state ids must survive (used to anchor comments to a state chip).
    expect(proto?.screens[0]?.state).toEqual([
      { id: "st1", label: "Count", value: "3" },
      { id: "st2", label: "Mode", value: "edit" },
    ]);
    expect(proto?.screens[1]?.html).toContain("Detail");
  });

  it("round-trips prototype HTML byte-exact across MDX-significant payloads", async () => {
    const payloads: Record<string, string> = {
      multilineAlpine:
        '<div x-data="{ q: \'\' }">\n  <input x-model="q" placeholder="Search">\n  <p x-text="q"></p>\n</div>',
      escapedComponentText:
        "<div>Use the &lt;Prototype&gt; viewer; data-goto stays.</div>",
      singleQuoteAttrs:
        "<div class='card'><button data-goto='next'>Go</button></div>",
      jsonBraces:
        '<div x-data="{ items: [1,2,3], open: false }"><span x-text="items.length"></span></div>',
      entities: "<div>A &amp; B &lt; C &gt; D &quot;E&quot;</div>",
    };
    for (const [label, html] of Object.entries(payloads)) {
      const result = await roundTrip({
        version: 2,
        title: "T",
        prototype: { initialScreenId: "s1", screens: [{ id: "s1", html }] },
        blocks: [],
      });
      expect(result.prototype?.screens[0]?.html, label).toBe(html);
    }
  });

  it("round-trips a plan that has BOTH a prototype and a canvas without dropping either", async () => {
    const content: PlanContent = {
      version: 2,
      title: "Both",
      prototype: {
        initialScreenId: "s1",
        screens: [{ id: "s1", title: "Live", html: "<div>live</div>" }],
      },
      canvas: {
        title: "Mocks",
        frames: [
          {
            id: "f1",
            label: "Static",
            surface: "browser",
            wireframe: { surface: "browser", html: "<div>static</div>" },
          },
        ],
      },
      blocks: [],
    };

    const folder = await exportPlanContentToMdxFolder({
      content,
      title: "Both",
    });
    expect(folder["prototype.mdx"]).toBeTruthy();
    expect(folder["canvas.mdx"]).toBeTruthy();

    const result = await parsePlanMdxFolder(folder);
    expect(result.prototype?.screens[0]?.html).toContain("live");
    expect(result.canvas?.frames[0]?.wireframe?.html).toContain("static");
  });

  it("preserves an explicitly-empty state array on a screen", async () => {
    const result = await roundTrip({
      version: 2,
      title: "T",
      prototype: {
        initialScreenId: "s1",
        screens: [{ id: "s1", html: "<div>x</div>", state: [] }],
      },
      blocks: [],
    });
    expect(result.prototype?.screens[0]?.state).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. prototype patch ops                                                     */
/* -------------------------------------------------------------------------- */

describe("prototype patch ops (idempotency, bad ids, sanitize)", () => {
  const withPrototype = (): PlanContent =>
    planContentSchema.parse({
      version: 2,
      prototype: {
        initialScreenId: "s1",
        screens: [
          {
            id: "s1",
            title: "Start",
            html: "<div><button>Next</button></div>",
            state: [{ label: "L", value: "V" }],
          },
        ],
        transitions: [],
      },
      blocks: [],
    });

  it("set-prototype is idempotent (applying the same prototype twice is a no-op)", () => {
    const base = planContentSchema.parse({ version: 2, blocks: [] });
    const proto = {
      initialScreenId: "s1",
      screens: [{ id: "s1", title: "S", html: "<div>x</div>" }],
    };
    const once = applyPlanContentPatches(base, [
      { op: "set-prototype", prototype: proto },
    ]);
    const twice = applyPlanContentPatches(once, [
      { op: "set-prototype", prototype: proto },
    ]);
    expect(twice.prototype).toEqual(once.prototype);
  });

  it("remove-prototype on a plan with no prototype is a safe no-op", () => {
    const base = planContentSchema.parse({ version: 2, blocks: [] });
    const next = applyPlanContentPatches(base, [{ op: "remove-prototype" }]);
    expect(next.prototype).toBeUndefined();
  });

  it("patch-prototype-html is idempotent under repeated identical edits (all:true)", () => {
    const once = applyPlanContentPatches(withPrototype(), [
      {
        op: "patch-prototype-html",
        screenId: "s1",
        edits: [{ find: ">Next<", replace: ">Continue<" }],
      },
    ]);
    expect(once.prototype?.screens[0]?.html).toContain(">Continue<");
    // Re-running the SAME find now misses (it was already replaced) and must
    // throw a clear "not present" error rather than silently corrupting.
    expect(() =>
      applyPlanContentPatches(once, [
        {
          op: "patch-prototype-html",
          screenId: "s1",
          edits: [{ find: ">Next<", replace: ">Continue<" }],
        },
      ]),
    ).toThrow(/not present/i);
  });

  it("update-prototype-screen throws for an unknown screen id", () => {
    expect(() =>
      applyPlanContentPatches(withPrototype(), [
        {
          op: "update-prototype-screen",
          screenId: "ghost",
          patch: { title: "X" },
        },
      ]),
    ).toThrow(/ghost was not found/i);
  });

  it("update-prototype-screen / patch-prototype-html throw when there is no prototype", () => {
    const base = planContentSchema.parse({ version: 2, blocks: [] });
    expect(() =>
      applyPlanContentPatches(base, [
        {
          op: "update-prototype-screen",
          screenId: "s1",
          patch: { title: "X" },
        },
      ]),
    ).toThrow(/without a prototype/i);
    expect(() =>
      applyPlanContentPatches(base, [
        {
          op: "patch-prototype-html",
          screenId: "s1",
          edits: [{ find: "x", replace: "y" }],
        },
      ]),
    ).toThrow(/without a prototype/i);
  });

  it("update-prototype-screen preserves initialScreenId and other screens", () => {
    const base = planContentSchema.parse({
      version: 2,
      prototype: {
        initialScreenId: "s1",
        screens: [
          { id: "s1", html: "<div>1</div>" },
          { id: "s2", html: "<div>2</div>" },
        ],
        transitions: [],
      },
      blocks: [],
    });
    const next = applyPlanContentPatches(base, [
      {
        op: "update-prototype-screen",
        screenId: "s1",
        patch: { summary: "new" },
      },
    ]);
    expect(next.prototype?.initialScreenId).toBe("s1");
    expect(next.prototype?.screens).toHaveLength(2);
    expect(next.prototype?.screens[1]?.id).toBe("s2");
  });

  it("rejects active content smuggled through patch-prototype-html (parity with patch-wireframe-html)", () => {
    // The wireframe patch comment promises a patch can never smuggle active
    // content in. The prototype patch must hold the same line: an event-handler
    // attribute / javascript: href in the replacement must be rejected.
    expect(() =>
      applyPlanContentPatches(withPrototype(), [
        {
          op: "patch-prototype-html",
          screenId: "s1",
          edits: [
            {
              find: ">Next<",
              replace: ' onclick="steal()">Next<',
            },
          ],
        },
      ]),
    ).toThrow();
    expect(() =>
      applyPlanContentPatches(withPrototype(), [
        {
          op: "patch-prototype-html",
          screenId: "s1",
          edits: [
            {
              find: "Next",
              replace: '<a href="javascript:alert(1)">Next</a>',
            },
          ],
        },
      ]),
    ).toThrow();
  });

  it("rejects active content smuggled through update-prototype-screen html", () => {
    expect(() =>
      applyPlanContentPatches(withPrototype(), [
        {
          op: "update-prototype-screen",
          screenId: "s1",
          patch: { html: '<a href="vbscript:msgbox(1)">x</a>' },
        },
      ]),
    ).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* 3. parsePlanContent defensive (the landed try/catch)                        */
/* -------------------------------------------------------------------------- */

describe("parsePlanContent fail-closed on pathological input", () => {
  function nestTabs(depth: number): PlanBlock {
    let block: PlanBlock = {
      id: "leaf",
      type: "rich-text",
      data: { markdown: "hi" },
    };
    for (let i = 0; i < depth; i++) {
      block = {
        id: `tabs-${i}`,
        type: "tabs",
        data: { tabs: [{ id: `t-${i}`, label: "T", blocks: [block] }] },
      } as PlanBlock;
    }
    return block;
  }

  it("returns null (not a throw) for moderately deep tabs that fail schema validation", () => {
    const content = { version: 2, blocks: [nestTabs(120)] };
    expect(parsePlanContent(content)).toBeNull();
  });

  it("returns null (not a RangeError) for pathologically deep tabs (overflows the recursive parser)", () => {
    // At this depth the recursive schema/migration throws a RangeError that
    // safeParse does NOT catch; the landed outer try/catch must convert it to a
    // graceful null so the plan page renders a fallback instead of crashing.
    const content = { version: 2, blocks: [nestTabs(6000)] };
    let result: PlanContent | null = null;
    expect(() => {
      result = parsePlanContent(content);
    }).not.toThrow();
    expect(result).toBeNull();
  });

  it("returns null for non-JSON string and undefined input", () => {
    expect(parsePlanContent("{not json")).toBeNull();
    expect(parsePlanContent(undefined)).toBeNull();
    expect(parsePlanContent(null)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Generated prototype content survives a round-trip                        */
/* -------------------------------------------------------------------------- */

describe("generated prototype content round-trips", () => {
  it("createPrototypePlanContent output survives JSON -> MDX -> JSON", async () => {
    const content = createPrototypePlanContent({
      title: "Generated prototype",
      brief: "Make a thing",
      source: "manual",
      screens: [
        {
          id: "screen-1",
          title: "List",
          surface: "browser",
          summary: "the list",
          state: [{ label: "Items", value: "0" }],
        },
        { id: "screen-2", title: "Detail", surface: "browser" },
      ],
      transitions: [{ from: "screen-1", to: "screen-2", label: "open" }],
    });
    // It must serialize as stored content without throwing.
    expect(() => serializePlanContent(content)).not.toThrow();

    const result = await roundTrip(content);
    expect(result.prototype?.screens.map((s) => s.id)).toEqual(
      content.prototype?.screens.map((s) => s.id),
    );
    // Every generated screen's html must survive byte-exact.
    content.prototype?.screens.forEach((screen, i) => {
      expect(result.prototype?.screens[i]?.html, `screen ${i}`).toBe(
        screen.html,
      );
    });
  });

  it("createPrototypeFromPlanContent derives a storable prototype from html canvas frames", () => {
    const content = planContentSchema.parse({
      version: 2,
      title: "Convert me",
      canvas: {
        title: "Flow",
        frames: [
          {
            id: "f1",
            label: "A",
            surface: "browser",
            wireframe: {
              surface: "browser",
              html: '<div data-goto="f2">A</div>',
            },
          },
          {
            id: "f2",
            label: "B",
            surface: "browser",
            wireframe: { surface: "browser", html: "<div>B</div>" },
          },
          // A kit-tree-only frame (no html) must be SKIPPED, not break derivation.
          {
            id: "f3",
            label: "C",
            surface: "browser",
            wireframe: {
              surface: "browser",
              screen: [{ id: "n1", el: "screen" }],
            },
          },
        ],
        flow: [{ from: "f1", to: "f2", label: "go" }],
      },
      blocks: [],
    });

    const prototype = createPrototypeFromPlanContent(content);
    expect(prototype?.screens.map((s) => s.id)).toEqual(["f1", "f2"]);
    expect(prototype?.initialScreenId).toBe("f1");
    // The derived prototype must satisfy the schema (initialScreenId/transitions
    // reference existing screens) so it can actually be stored.
    expect(() =>
      serializePlanContent({ ...content, prototype: prototype ?? undefined }),
    ).not.toThrow();
  });

  it("returns null when a canvas has no html wireframes to convert", () => {
    const content = planContentSchema.parse({
      version: 2,
      title: "Kit only",
      canvas: {
        title: "K",
        frames: [
          {
            id: "k1",
            label: "K",
            surface: "browser",
            wireframe: {
              surface: "browser",
              screen: [{ id: "n1", el: "screen" }],
            },
          },
        ],
      },
      blocks: [],
    });
    expect(createPrototypeFromPlanContent(content)).toBeNull();
  });

  it("BUG: title-only screens + caller transitions using the natural screen-N convention throw (transitions are not remapped to derived ids)", () => {
    // The create-prototype-plan action accepts `screens` whose `id` is optional
    // and `transitions` whose from/to are free strings. When screens omit ids,
    // createPrototypeFromScreens derives ids from slug(title) (here `list` /
    // `detail`), but the caller's transitions still reference the obvious
    // index-based `screen-1`/`screen-2` ids — and those transitions are passed
    // through verbatim instead of being remapped. Result: a ZodError that the
    // action surfaces as an opaque 400, even though screens + transitions were
    // each individually well-formed.
    //
    // Asserts the intended behavior: index-style transitions should resolve
    // against the generated screen order. FAILING pins the footgun.
    expect(() =>
      createPrototypePlanContent({
        title: "P",
        brief: "b",
        source: "manual",
        screens: [{ title: "List" }, { title: "Detail" }],
        transitions: [{ from: "screen-1", to: "screen-2", label: "open" }],
      }),
    ).not.toThrow();
  });

  it("BUG: two title-only screens that slug to the same id throw 'Duplicate prototype screen id'", () => {
    // Distinct screens with the same (or slug-colliding) title and no explicit
    // id both derive the same slug id, tripping the duplicate-id refine. Two
    // screens legitimately titled the same (e.g. two "Loading" states) is a
    // reasonable agent input but cannot be created. Derived ids should be made
    // unique. FAILING pins the collision.
    expect(() =>
      createPrototypePlanContent({
        title: "P",
        brief: "b",
        source: "manual",
        screens: [{ title: "Home Screen" }, { title: "Home Screen" }],
      }),
    ).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Documented prototype directive contract                                  */
/* -------------------------------------------------------------------------- */

describe("documented prototype directive contract", () => {
  it("BUG: rejects the canonical Alpine `<template x-for>` even though x-for is advertised as a supported safe directive", () => {
    // Both create-prototype-plan's action description and PlanPrototypeScreen's
    // JSDoc list `x-for` as a supported safe directive. The canonical Alpine
    // x-for binds on a <template> element, but <template> is in
    // `unsafeCustomHtmlPattern`, so a screen authored with idiomatic Alpine
    // x-for is rejected at the action boundary (statusCode 400). An agent that
    // follows the documented directive list cannot create the plan.
    //
    // Asserts the intended contract (the documented directive should be
    // accepted). FAILING pins the doc/validation mismatch.
    const html =
      '<ul><template x-for="t in items"><li x-text="t"></li></template></ul>';
    expect(() =>
      normalizePlanContent({
        version: 2,
        prototype: { initialScreenId: "s1", screens: [{ id: "s1", html }] },
        blocks: [],
      }),
    ).not.toThrow();
  });

  it("accepts the framework's non-template x-for form (x-for on a plain element)", () => {
    // This is the form the prototype runtime + sanitize-html actually support,
    // and is the safe baseline this contract should preserve.
    const html =
      '<ul><li class="wf-box" x-for="t in items" x-text="t"></li></ul>';
    expect(() =>
      normalizePlanContent({
        version: 2,
        prototype: { initialScreenId: "s1", screens: [{ id: "s1", html }] },
        blocks: [],
      }),
    ).not.toThrow();
  });
});
