import { describe, expect, it } from "vitest";

import {
  applyPlanContentPatches,
  planContentSchema,
  type PlanContent,
} from "../shared/plan-content.js";

/**
 * Deep probes of areas where the patch pipeline could silently corrupt data,
 * lose node ids, bypass node-id dedup, or mishandle find/replace count math.
 */

/* -------------------------------------------------------------------------- */
/* update-block bypassing wireframe screen guarantees                          */
/* -------------------------------------------------------------------------- */

describe("update-block on a wireframe screen", () => {
  const wireframePlan = (): PlanContent =>
    planContentSchema.parse({
      version: 2,
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: {
            surface: "desktop",
            screen: [{ id: "t1", el: "title", text: "Hi" }],
          },
        },
      ],
    });

  it("BUG PROBE: update-block can set a wireframe screen with NODES MISSING IDS (no auto-assign)", () => {
    // replace-wireframe-screen runs ensureNodeIds; update-block's generic data
    // merge does NOT. So a screen set via update-block can land node objects
    // with no `id`, which node-addressable patch ops can never target later.
    const next = applyPlanContentPatches(wireframePlan(), [
      {
        op: "update-block",
        blockId: "wf",
        patch: { data: { screen: [{ el: "title", text: "No id here" }] } },
      },
    ]);
    const blk = next.blocks.find((b) => b.id === "wf");
    if (blk?.type !== "wireframe") throw new Error("expected wireframe");
    const node = blk.data.screen[0];
    // Documents the gap: this node has no stable id, so update-wireframe-node
    // can never address it. (ensureNodeIds was bypassed.)
    expect(node?.id).toBeUndefined();
  });

  it("rejects an update-block screen with duplicate explicit node ids (final parse catches it)", () => {
    expect(() =>
      applyPlanContentPatches(wireframePlan(), [
        {
          op: "update-block",
          blockId: "wf",
          patch: {
            data: {
              screen: [
                { id: "dup", el: "title", text: "A" },
                { id: "dup", el: "title", text: "B" },
              ],
            },
          },
        },
      ]),
    ).toThrow(/duplicate wireframe node id/i);
  });

  it("rejects a replace-wireframe-screen with duplicate explicit node ids", () => {
    expect(() =>
      applyPlanContentPatches(wireframePlan(), [
        {
          op: "replace-wireframe-screen",
          blockId: "wf",
          screen: [
            { id: "dup", el: "title", text: "A" },
            { id: "dup", el: "title", text: "B" },
          ],
        },
      ]),
    ).toThrow(/duplicate wireframe node id/i);
  });

  it("replace-wireframe-screen assigns ids to children too (deep ensureNodeIds)", () => {
    const next = applyPlanContentPatches(wireframePlan(), [
      {
        op: "replace-wireframe-screen",
        blockId: "wf",
        screen: [
          {
            el: "row",
            children: [
              { el: "btn", text: "A" },
              { el: "btn", text: "B" },
            ],
          },
        ],
      },
    ]);
    const blk = next.blocks.find((b) => b.id === "wf");
    if (blk?.type !== "wireframe") throw new Error("expected wireframe");
    const row = blk.data.screen[0];
    expect(row?.id).toBeTruthy();
    expect(row?.children?.[0]?.id).toBeTruthy();
    expect(row?.children?.[1]?.id).toBeTruthy();
    expect(row?.children?.[0]?.id).not.toBe(row?.children?.[1]?.id);
  });
});

/* -------------------------------------------------------------------------- */
/* update-wireframe-node: patch cannot change el/children/id                  */
/* -------------------------------------------------------------------------- */

describe("update-wireframe-node patch boundaries", () => {
  const wf = (): PlanContent =>
    planContentSchema.parse({
      version: 2,
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: {
            surface: "desktop",
            screen: [
              {
                id: "row1",
                el: "row",
                children: [{ id: "btn1", el: "btn", text: "Go" }],
              },
            ],
          },
        },
      ],
    });

  it("updates only the targeted node, leaving siblings/children intact", () => {
    const next = applyPlanContentPatches(wf(), [
      {
        op: "update-wireframe-node",
        blockId: "wf",
        nodeId: "btn1",
        patch: { text: "Continue", tone: "accent" },
      },
    ]);
    const blk = next.blocks.find((b) => b.id === "wf");
    if (blk?.type !== "wireframe") throw new Error("expected wireframe");
    const btn = blk.data.screen[0]?.children?.[0];
    expect(btn?.text).toBe("Continue");
    expect(btn?.tone).toBe("accent");
    expect(btn?.el).toBe("btn");
    expect(btn?.id).toBe("btn1");
  });

  it("patching a parent node keeps its existing children", () => {
    const next = applyPlanContentPatches(wf(), [
      {
        op: "update-wireframe-node",
        blockId: "wf",
        nodeId: "row1",
        patch: { tone: "muted" },
      },
    ]);
    const blk = next.blocks.find((b) => b.id === "wf");
    if (blk?.type !== "wireframe") throw new Error("expected wireframe");
    const row = blk.data.screen[0];
    expect(row?.tone).toBe("muted");
    expect(row?.children?.[0]?.id).toBe("btn1");
  });
});

/* -------------------------------------------------------------------------- */
/* patch-wireframe-html overlapping-match count math                          */
/* -------------------------------------------------------------------------- */

describe("patch-wireframe-html count math (split-based)", () => {
  const htmlWireframe = (html: string): PlanContent =>
    planContentSchema.parse({
      version: 2,
      blocks: [
        { id: "wf1", type: "wireframe", data: { surface: "browser", html } },
      ],
    });
  const htmlOf = (c: PlanContent): string => {
    const b = c.blocks[0];
    if (b?.type !== "wireframe" || typeof b.data.html !== "string")
      throw new Error("expected html wireframe");
    return b.data.html;
  };

  it("BUG PROBE: overlapping occurrences are counted by split, not by overlap", () => {
    // "aa" in "aaa": String.split("aa") -> ["", "a"] -> count 1 -> treated as
    // unique -> single .replace() only swaps the first. Pin the actual behavior.
    const next = applyPlanContentPatches(htmlWireframe("<p>aaa</p>"), [
      {
        op: "patch-wireframe-html",
        blockId: "wf1",
        edits: [{ find: "aa", replace: "Z" }],
      },
    ]);
    // First "aa" -> "Z", leaving a trailing "a": "<p>Za</p>".
    expect(htmlOf(next)).toBe("<p>Za</p>");
  });

  it("a find that appears in an attribute value vs text is matched literally", () => {
    const next = applyPlanContentPatches(
      htmlWireframe('<div title="x">x</div>'),
      [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [{ find: ">x<", replace: ">y<" }],
        },
      ],
    );
    // Only the text node ">x<" changes; the attribute stays.
    expect(htmlOf(next)).toBe('<div title="x">y</div>');
  });
});

/* -------------------------------------------------------------------------- */
/* canvas note (legacy) + section/connector survival through patches          */
/* -------------------------------------------------------------------------- */

describe("legacy canvas structures survive patching", () => {
  it("keeps legacy notes, sections, and flow connectors after an unrelated block patch", () => {
    const content = planContentSchema.parse({
      version: 2,
      canvas: {
        title: "Board",
        sections: [{ id: "s1", title: "Group", artboardIds: ["f1"] }],
        frames: [
          {
            id: "f1",
            label: "Screen",
            wireframe: {
              surface: "desktop",
              screen: [{ id: "t", el: "title", text: "Hi" }],
            },
          },
        ],
        flow: [{ from: "f1", to: "f1", label: "self" }],
        notes: [{ id: "n1", body: "Legacy note." }],
        annotations: [{ id: "a1", text: "Annotation." }],
      },
      blocks: [{ id: "rt", type: "rich-text", data: { markdown: "Body." } }],
    });

    const next = applyPlanContentPatches(content, [
      { op: "update-rich-text", blockId: "rt", markdown: "New body." },
    ]);
    expect(next.canvas?.sections?.[0]?.id).toBe("s1");
    expect(next.canvas?.flow?.[0]?.label).toBe("self");
    expect(next.canvas?.notes?.[0]?.body).toBe("Legacy note.");
    expect(next.canvas?.annotations?.[0]?.text).toBe("Annotation.");
  });
});

/* -------------------------------------------------------------------------- */
/* update-design-element-style for full-fidelity design fragments              */
/* -------------------------------------------------------------------------- */

describe("update-design-element-style", () => {
  const designPlan = (): PlanContent =>
    planContentSchema.parse({
      version: 2,
      canvas: {
        mode: "design",
        frames: [
          {
            id: "home-frame",
            label: "Home",
            wireframe: {
              surface: "desktop",
              renderMode: "design",
              html: '<main><button data-design-id="primary-cta" class="cta">Buy now</button></main>',
            },
          },
        ],
      },
      prototype: {
        initialScreenId: "home-frame",
        screens: [
          {
            id: "home-frame",
            renderMode: "design",
            html: '<main><button data-design-id="primary-cta" class="cta">Buy now</button></main>',
          },
        ],
      },
      blocks: [
        {
          id: "linked-design",
          type: "wireframe",
          data: {
            surface: "desktop",
            renderMode: "design",
            html: '<section data-plan-design-id="hero-panel" style="color: #111; padding: 8px">Hero</section>',
          },
        },
      ],
    });

  it("updates a selected canvas design element by data-design-id", () => {
    const next = applyPlanContentPatches(designPlan(), [
      {
        op: "update-design-element-style",
        frameId: "home-frame",
        elementId: "primary-cta",
        styles: {
          "background-color": "#0f766e",
          borderRadius: "10px",
        },
      },
    ]);

    const html = next.canvas?.frames[0]?.wireframe?.html;
    expect(html).toContain('data-design-id="primary-cta"');
    expect(html).toContain(
      'style="background-color: #0f766e; border-radius: 10px"',
    );
    expect(next.prototype?.screens[0]?.html).toContain(
      'style="background-color: #0f766e; border-radius: 10px"',
    );
  });

  it("uses frameId as the selected source and does not patch a mismatched blockId", () => {
    const content = planContentSchema.parse({
      version: 2,
      canvas: {
        mode: "design",
        frames: [
          {
            id: "selected-frame",
            blockId: "frame-source",
            wireframe: {
              surface: "desktop",
              renderMode: "design",
              html: '<button data-design-id="target">Inline source</button>',
            },
          },
        ],
      },
      blocks: [
        {
          id: "frame-source",
          type: "wireframe",
          data: {
            surface: "desktop",
            renderMode: "design",
            html: '<button data-design-id="target">Block source</button>',
          },
        },
        {
          id: "wrong-block",
          type: "wireframe",
          data: {
            surface: "desktop",
            renderMode: "design",
            html: '<button data-design-id="target">Wrong source</button>',
          },
        },
      ],
    });

    const next = applyPlanContentPatches(content, [
      {
        op: "update-design-element-style",
        frameId: "selected-frame",
        blockId: "wrong-block",
        elementId: "target",
        styles: { color: "#0f766e" },
      },
    ]);
    const source = next.blocks.find((block) => block.id === "frame-source");
    const wrong = next.blocks.find((block) => block.id === "wrong-block");
    if (source?.type !== "wireframe" || wrong?.type !== "wireframe") {
      throw new Error("expected wireframes");
    }
    expect(source.data.html).toContain('style="color: #0f766e"');
    expect(next.canvas?.frames[0]?.wireframe?.html).toBe(source.data.html);
    expect(wrong.data.html).not.toContain("#0f766e");
  });

  it("updates and removes inline styles on block-backed design fragments", () => {
    const next = applyPlanContentPatches(designPlan(), [
      {
        op: "update-design-element-style",
        blockId: "linked-design",
        elementId: "hero-panel",
        styles: {
          color: "#222",
          padding: null,
        },
      },
    ]);

    const block = next.blocks.find(
      (candidate) => candidate.id === "linked-design",
    );
    if (block?.type !== "wireframe") throw new Error("expected wireframe");
    expect(block.data.html).toContain('style="color: #222"');
    expect(block.data.html).not.toContain("padding");
  });

  it("does not auto-sync block-only patches across prototype screens with matching element ids", () => {
    const content = planContentSchema.parse({
      version: 2,
      prototype: {
        initialScreenId: "one",
        screens: [
          {
            id: "one",
            renderMode: "design",
            html: '<button data-design-id="shared">One</button>',
          },
          {
            id: "two",
            renderMode: "design",
            html: '<button data-design-id="shared">Two</button>',
          },
        ],
      },
      blocks: [
        {
          id: "block-source",
          type: "wireframe",
          data: {
            surface: "desktop",
            renderMode: "design",
            html: '<button data-design-id="shared">Block</button>',
          },
        },
      ],
    });

    const next = applyPlanContentPatches(content, [
      {
        op: "update-design-element-style",
        blockId: "block-source",
        elementId: "shared",
        styles: { color: "#0f766e" },
      },
    ]);
    const block = next.blocks.find(
      (candidate) => candidate.id === "block-source",
    );
    if (block?.type !== "wireframe") throw new Error("expected wireframe");
    expect(block.data.html).toContain('style="color: #0f766e"');
    expect(next.prototype?.screens[0]?.html).not.toContain("#0f766e");
    expect(next.prototype?.screens[1]?.html).not.toContain("#0f766e");
  });

  it("rejects unsafe property names, style values, and viewport traps", () => {
    expect(() =>
      applyPlanContentPatches(designPlan(), [
        {
          op: "update-design-element-style",
          frameId: "home-frame",
          elementId: "primary-cta",
          styles: { "background-color;position": "fixed" },
        },
      ]),
    ).toThrow(/Invalid CSS property name/i);

    expect(() =>
      applyPlanContentPatches(designPlan(), [
        {
          op: "update-design-element-style",
          frameId: "home-frame",
          elementId: "primary-cta",
          styles: { background: "url(javascript:alert(1))" },
        },
      ]),
    ).toThrow(/Unsafe CSS style value/i);

    expect(() =>
      applyPlanContentPatches(designPlan(), [
        {
          op: "update-design-element-style",
          frameId: "home-frame",
          elementId: "primary-cta",
          styles: { position: "fixed" },
        },
      ]),
    ).toThrow(/Unsafe CSS style value/i);

    expect(() =>
      applyPlanContentPatches(designPlan(), [
        {
          op: "update-design-element-style",
          frameId: "home-frame",
          elementId: "primary-cta",
          styles: { background: String.raw`url(\6a avascript:alert(1))` },
        },
      ]),
    ).toThrow(/Unsafe CSS style value/i);
  });

  it("rejects duplicate data-design-id targets in one design screen", () => {
    expect(() =>
      applyPlanContentPatches(
        planContentSchema.parse({
          version: 2,
          canvas: {
            mode: "design",
            frames: [
              {
                id: "dup-frame",
                wireframe: {
                  surface: "desktop",
                  renderMode: "design",
                  html: '<button data-design-id="dup">One</button><button data-design-id="dup">Two</button>',
                },
              },
            ],
          },
          blocks: [],
        }),
        [
          {
            op: "update-design-element-style",
            frameId: "dup-frame",
            elementId: "dup",
            styles: { color: "#0f766e" },
          },
        ],
      ),
    ).toThrow(/matched 2 elements/i);
  });
});

/* -------------------------------------------------------------------------- */
/* batch patches in one call applied sequentially                             */
/* -------------------------------------------------------------------------- */

describe("multi-patch batches", () => {
  it("applies append then update of the just-appended block in one batch", () => {
    const content = planContentSchema.parse({
      version: 2,
      blocks: [{ id: "rt", type: "rich-text", data: { markdown: "a" } }],
    });
    const next = applyPlanContentPatches(content, [
      {
        op: "append-block",
        block: { id: "added", type: "rich-text", data: { markdown: "first" } },
      },
      { op: "update-rich-text", blockId: "added", markdown: "second" },
    ]);
    const blk = next.blocks.find((b) => b.id === "added");
    expect(blk?.type).toBe("rich-text");
    if (blk?.type === "rich-text") expect(blk.data.markdown).toBe("second");
  });

  it("BUG PROBE: append a block then remove it in the same batch leaves it gone", () => {
    const content = planContentSchema.parse({
      version: 2,
      blocks: [{ id: "rt", type: "rich-text", data: { markdown: "a" } }],
    });
    const next = applyPlanContentPatches(content, [
      {
        op: "append-block",
        block: { id: "temp", type: "rich-text", data: { markdown: "t" } },
      },
      { op: "remove-block", blockId: "temp" },
    ]);
    expect(next.blocks.some((b) => b.id === "temp")).toBe(false);
  });

  it("BUG PROBE: removing a block then trying to update it in the same batch throws", () => {
    const content = planContentSchema.parse({
      version: 2,
      blocks: [
        { id: "rt", type: "rich-text", data: { markdown: "a" } },
        { id: "rt2", type: "rich-text", data: { markdown: "b" } },
      ],
    });
    expect(() =>
      applyPlanContentPatches(content, [
        { op: "remove-block", blockId: "rt2" },
        { op: "update-rich-text", blockId: "rt2", markdown: "c" },
      ]),
    ).toThrow(/not found/i);
  });
});
