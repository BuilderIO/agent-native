import { describe, expect, it } from "vitest";

import {
  applyPlanContentPatches,
  planContentSchema,
  type PlanContent,
  type PlanWireframeNode,
} from "../shared/plan-content.js";

/**
 * Adversarial coverage for the editing + content-patch surface
 * (applyPlanContentPatches + every patch op). The goal is to break it:
 * missing/wrong ids, wrong block types, duplicate-id creation, sanitization
 * on patched html, idempotency, patch-order dependence, and deeply nested tabs.
 *
 * Bugs are pinned with FAILING expectations and reported; fixes are coordinated
 * in a later phase.
 */

function findWireframeNode(
  nodes: PlanWireframeNode[],
  predicate: (node: PlanWireframeNode) => boolean,
): PlanWireframeNode | null {
  for (const node of nodes) {
    if (predicate(node)) return node;
    const childMatch = findWireframeNode(node.children ?? [], predicate);
    if (childMatch) return childMatch;
  }
  return null;
}

/** A minimal valid plan with a couple of addressable blocks. */
function basePlan(): PlanContent {
  return planContentSchema.parse({
    version: 2,
    title: "Adversarial base",
    brief: "Base plan for patch tests.",
    blocks: [
      { id: "rt", type: "rich-text", data: { markdown: "Original copy." } },
      {
        id: "call",
        type: "callout",
        title: "Note",
        data: { tone: "info", body: "Original callout." },
      },
    ],
  });
}

/* -------------------------------------------------------------------------- */
/* Missing / wrong ids                                                        */
/* -------------------------------------------------------------------------- */

describe("patch ops: missing / wrong ids", () => {
  it("throws on update-rich-text for a missing block id", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        { op: "update-rich-text", blockId: "nope", markdown: "x" },
      ]),
    ).toThrow(/not found/i);
  });

  it("throws on remove-block for a missing block id", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        { op: "remove-block", blockId: "nope" },
      ]),
    ).toThrow(/not found/i);
  });

  it("throws on replace-block for a missing block id", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        {
          op: "replace-block",
          blockId: "nope",
          block: { id: "nope", type: "rich-text", data: { markdown: "x" } },
        },
      ]),
    ).toThrow(/not found/i);
  });

  it("throws on update-canvas-frame for a missing frame id (no canvas)", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        { op: "update-canvas-frame", frameId: "nope", patch: { x: 1 } },
      ]),
    ).toThrow(/not found/i);
  });

  it("throws on update-canvas-annotation for a missing annotation id", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        {
          op: "update-canvas-annotation",
          annotationId: "nope",
          patch: { text: "x" },
        },
      ]),
    ).toThrow(/not found/i);
  });

  it("throws on append-canvas-annotation when there is no canvas", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        {
          op: "append-canvas-annotation",
          annotation: { id: "a1", text: "hi" },
        },
      ]),
    ).toThrow(/without a canvas/i);
  });

  it("throws on append-block with a missing afterBlockId", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        {
          op: "append-block",
          afterBlockId: "nope",
          block: { id: "new", type: "rich-text", data: { markdown: "x" } },
        },
      ]),
    ).toThrow(/not found/i);
  });

  it("throws on update-wireframe-node for a missing node id", () => {
    const content = planContentSchema.parse({
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
    expect(() =>
      applyPlanContentPatches(content, [
        {
          op: "update-wireframe-node",
          blockId: "wf",
          nodeId: "missing",
          patch: { text: "x" },
        },
      ]),
    ).toThrow(/was not found/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Wrong block type                                                           */
/* -------------------------------------------------------------------------- */

describe("patch ops: wrong block type", () => {
  it("throws when update-rich-text targets a non-rich-text block", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        { op: "update-rich-text", blockId: "call", markdown: "x" },
      ]),
    ).toThrow(/not rich-text/i);
  });

  it("throws when update-custom-html targets a non-custom-html block", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        { op: "update-custom-html", blockId: "rt", html: "<div>x</div>" },
      ]),
    ).toThrow(/not custom-html/i);
  });

  it("throws when update-wireframe-node targets a non-wireframe block", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        {
          op: "update-wireframe-node",
          blockId: "rt",
          nodeId: "x",
          patch: { text: "x" },
        },
      ]),
    ).toThrow(/not wireframe/i);
  });

  it("throws when patch-wireframe-html targets a non-wireframe block", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        {
          op: "patch-wireframe-html",
          blockId: "rt",
          edits: [{ find: "a", replace: "b" }],
        },
      ]),
    ).toThrow(/not wireframe/i);
  });

  it("throws when patch-wireframe-html targets a kit-tree wireframe (no html)", () => {
    const content = planContentSchema.parse({
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
    expect(() =>
      applyPlanContentPatches(content, [
        {
          op: "patch-wireframe-html",
          blockId: "wf",
          edits: [{ find: "Hi", replace: "Bye" }],
        },
      ]),
    ).toThrow(/no html mockup/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Duplicate id creation                                                      */
/* -------------------------------------------------------------------------- */

describe("patch ops: duplicate id creation is rejected at the final validate", () => {
  it("rejects append-block that introduces a duplicate top-level block id", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        {
          op: "append-block",
          block: { id: "rt", type: "rich-text", data: { markdown: "dup" } },
        },
      ]),
    ).toThrow(/duplicate block id/i);
  });

  it("rejects append-block into a tab that duplicates a top-level block id", () => {
    const content = planContentSchema.parse({
      version: 2,
      blocks: [
        { id: "rt", type: "rich-text", data: { markdown: "top" } },
        {
          id: "tabset",
          type: "tabs",
          data: {
            tabs: [{ id: "t1", label: "One", blocks: [] }],
          },
        },
      ],
    });
    expect(() =>
      applyPlanContentPatches(content, [
        {
          op: "append-block",
          parent: { tabBlockId: "tabset", tabId: "t1" },
          block: { id: "rt", type: "rich-text", data: { markdown: "dup" } },
        },
      ]),
    ).toThrow(/duplicate block id/i);
  });

  it("rejects replace-block that changes the id to collide with another block", () => {
    // replace-block keeps the OLD block at slot `blockId` but swaps in a block
    // whose own id is `call` (already present) -> duplicate.
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        {
          op: "replace-block",
          blockId: "rt",
          block: { id: "call", type: "rich-text", data: { markdown: "x" } },
        },
      ]),
    ).toThrow(/duplicate block id/i);
  });

  it("rejects append-canvas-annotation when the annotation id already exists", () => {
    const content = planContentSchema.parse({
      version: 2,
      canvas: {
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
        annotations: [{ id: "a1", text: "Existing." }],
      },
      blocks: [],
    });
    expect(() =>
      applyPlanContentPatches(content, [
        {
          op: "append-canvas-annotation",
          annotation: { id: "a1", text: "Duplicate." },
        },
      ]),
    ).toThrow(/already exists/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Sanitization on patched html                                               */
/* -------------------------------------------------------------------------- */

describe("patch ops: sanitization defenses on patched html", () => {
  const htmlWireframe = (html: string): PlanContent =>
    planContentSchema.parse({
      version: 2,
      blocks: [
        { id: "wf1", type: "wireframe", data: { surface: "browser", html } },
      ],
    });

  it("rejects patch-wireframe-html replacement that smuggles a script tag", () => {
    expect(() =>
      applyPlanContentPatches(htmlWireframe("<div>x</div>"), [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [{ find: "x", replace: "<script>alert(1)</script>" }],
        },
      ]),
    ).toThrow();
  });

  it("rejects patch-wireframe-html replacement that smuggles an inline handler", () => {
    expect(() =>
      applyPlanContentPatches(htmlWireframe("<div>x</div>"), [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [{ find: "x", replace: '<img src=y onerror="alert(1)">' }],
        },
      ]),
    ).toThrow();
  });

  it("rejects patch-wireframe-html replacement that smuggles a javascript: url", () => {
    expect(() =>
      applyPlanContentPatches(htmlWireframe("<a>x</a>"), [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [
            { find: "x", replace: '<a href="javascript:alert(1)">go</a>' },
          ],
        },
      ]),
    ).toThrow();
  });

  it("rejects update-custom-html that smuggles an iframe", () => {
    const content = planContentSchema.parse({
      version: 2,
      blocks: [
        {
          id: "ch",
          type: "custom-html",
          data: { html: "<div>ok</div>" },
        },
      ],
    });
    expect(() =>
      applyPlanContentPatches(content, [
        {
          op: "update-custom-html",
          blockId: "ch",
          html: '<iframe src="https://evil.test"></iframe>',
        },
      ]),
    ).toThrow();
  });

  it("rejects an edit whose accumulated result forms an on-handler across edits", () => {
    // Each replace passes the per-edit refine in isolation, but the final html
    // is re-parsed via planBlockSchema, so a cross-edit smuggle must still fail.
    const content = htmlWireframe('<div data-x="SENTINEL">y</div>');
    expect(() =>
      applyPlanContentPatches(content, [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          // "x=\"SENTINEL\"" -> "click=\"x\"" makes an `onclick=` style handler
          // when combined with the leading `on`. Final parse must reject it.
          edits: [{ find: 'data-x="SENTINEL"', replace: 'onclick="alert(1)"' }],
        },
      ]),
    ).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Idempotency + order dependence                                             */
/* -------------------------------------------------------------------------- */

describe("patch ops: idempotency and order", () => {
  it("update-rich-text applied twice yields the same result", () => {
    const once = applyPlanContentPatches(basePlan(), [
      { op: "update-rich-text", blockId: "rt", markdown: "Final copy." },
    ]);
    const twice = applyPlanContentPatches(once, [
      { op: "update-rich-text", blockId: "rt", markdown: "Final copy." },
    ]);
    const blk = twice.blocks.find((b) => b.id === "rt");
    expect(blk?.type).toBe("rich-text");
    if (blk?.type === "rich-text")
      expect(blk.data.markdown).toBe("Final copy.");
  });

  it("chained patch-wireframe-html edits apply in order and can chain on prior output", () => {
    const content = planContentSchema.parse({
      version: 2,
      blocks: [
        {
          id: "wf1",
          type: "wireframe",
          data: { surface: "browser", html: "<span>A</span>" },
        },
      ],
    });
    const next = applyPlanContentPatches(content, [
      {
        op: "patch-wireframe-html",
        blockId: "wf1",
        edits: [
          { find: ">A<", replace: ">B<" },
          { find: ">B<", replace: ">C<" },
        ],
      },
    ]);
    const blk = next.blocks[0];
    if (blk?.type !== "wireframe") throw new Error("expected wireframe");
    expect(blk.data.html).toBe("<span>C</span>");
  });

  it("removing then re-appending a block round-trips block presence", () => {
    const removed = applyPlanContentPatches(basePlan(), [
      { op: "remove-block", blockId: "call" },
    ]);
    expect(removed.blocks.some((b) => b.id === "call")).toBe(false);
    const readded = applyPlanContentPatches(removed, [
      {
        op: "append-block",
        block: { id: "call", type: "callout", data: { body: "Back." } },
      },
    ]);
    expect(readded.blocks.some((b) => b.id === "call")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* update-block shallow data merge                                            */
/* -------------------------------------------------------------------------- */

describe("update-block: shallow data merge edge cases", () => {
  it("merges data shallowly for a callout (keeps tone, swaps body)", () => {
    const next = applyPlanContentPatches(basePlan(), [
      {
        op: "update-block",
        blockId: "call",
        patch: { data: { body: "New body." } },
      },
    ]);
    const blk = next.blocks.find((b) => b.id === "call");
    if (blk?.type !== "callout") throw new Error("expected callout");
    expect(blk.data.body).toBe("New body.");
    expect(blk.data.tone).toBe("info");
  });

  it("clears the title with null and keeps it with undefined", () => {
    const next = applyPlanContentPatches(basePlan(), [
      { op: "update-block", blockId: "call", patch: { title: null } },
    ]);
    const blk = next.blocks.find((b) => b.id === "call");
    expect(blk?.title).toBeUndefined();
  });

  it("rejects an update-block data merge that produces an invalid block", () => {
    // callout body must be >= 1 char; merging an empty body should fail the
    // final schema parse.
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        {
          op: "update-block",
          blockId: "call",
          patch: { data: { body: "" } },
        },
      ]),
    ).toThrow();
  });

  it("BUG PROBE: update-block data merge on a tabs block can corrupt nested blocks", () => {
    // update-block does a shallow `{ ...block.data, ...patch.data }`. For a tabs
    // block whose data is `{ tabs: [...] }`, overwriting `tabs` with a bad value
    // should be rejected by the final parse rather than silently mangling.
    const content = planContentSchema.parse({
      version: 2,
      blocks: [
        {
          id: "tabset",
          type: "tabs",
          data: {
            tabs: [
              {
                id: "t1",
                label: "One",
                blocks: [
                  { id: "inner", type: "rich-text", data: { markdown: "hi" } },
                ],
              },
            ],
          },
        },
      ],
    });
    // Overwriting tabs with an empty array violates `.min(1)` -> must throw.
    expect(() =>
      applyPlanContentPatches(content, [
        {
          op: "update-block",
          blockId: "tabset",
          patch: { data: { tabs: [] } },
        },
      ]),
    ).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Deeply nested tabs                                                         */
/* -------------------------------------------------------------------------- */

describe("deeply nested tabs", () => {
  const nestedTabs = (): PlanContent =>
    planContentSchema.parse({
      version: 2,
      blocks: [
        {
          id: "outer",
          type: "tabs",
          data: {
            tabs: [
              {
                id: "outerTab",
                label: "Outer",
                blocks: [
                  {
                    id: "inner",
                    type: "tabs",
                    data: {
                      tabs: [
                        {
                          id: "innerTab",
                          label: "Inner",
                          blocks: [
                            {
                              id: "deep-rt",
                              type: "rich-text",
                              data: { markdown: "Deep copy." },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    });

  it("updates a rich-text block nested two tab levels deep", () => {
    const next = applyPlanContentPatches(nestedTabs(), [
      { op: "update-rich-text", blockId: "deep-rt", markdown: "Updated deep." },
    ]);
    // Re-find the deep block by walking.
    const walk = (
      blocks: PlanContent["blocks"],
    ): PlanContent["blocks"][number] | undefined => {
      for (const b of blocks) {
        if (b.id === "deep-rt") return b;
        if (b.type === "tabs") {
          for (const tab of b.data.tabs) {
            const found = walk(tab.blocks);
            if (found) return found;
          }
        }
      }
      return undefined;
    };
    const blk = walk(next.blocks);
    expect(blk?.type).toBe("rich-text");
    if (blk?.type === "rich-text")
      expect(blk.data.markdown).toBe("Updated deep.");
  });

  it("removes a block nested two tab levels deep", () => {
    const next = applyPlanContentPatches(nestedTabs(), [
      { op: "remove-block", blockId: "deep-rt" },
    ]);
    const walk = (blocks: PlanContent["blocks"]): boolean => {
      for (const b of blocks) {
        if (b.id === "deep-rt") return true;
        if (b.type === "tabs") {
          for (const tab of b.data.tabs) if (walk(tab.blocks)) return true;
        }
      }
      return false;
    };
    expect(walk(next.blocks)).toBe(false);
  });

  it("appends a block into an inner tab two levels deep", () => {
    const next = applyPlanContentPatches(nestedTabs(), [
      {
        op: "append-block",
        parent: { tabBlockId: "inner", tabId: "innerTab" },
        block: {
          id: "appended-deep",
          type: "callout",
          data: { body: "Appended deep." },
        },
      },
    ]);
    const walk = (blocks: PlanContent["blocks"]): boolean => {
      for (const b of blocks) {
        if (b.id === "appended-deep") return true;
        if (b.type === "tabs") {
          for (const tab of b.data.tabs) if (walk(tab.blocks)) return true;
        }
      }
      return false;
    };
    expect(walk(next.blocks)).toBe(true);
  });

  it("throws appending into a non-existent inner tab id", () => {
    expect(() =>
      applyPlanContentPatches(nestedTabs(), [
        {
          op: "append-block",
          parent: { tabBlockId: "inner", tabId: "nope" },
          block: { id: "x", type: "callout", data: { body: "x" } },
        },
      ]),
    ).toThrow(/tab nope was not found/i);
  });

  it("BUG PROBE: append-block into a tab does not detect a duplicate id already inside that tab", () => {
    const content = planContentSchema.parse({
      version: 2,
      blocks: [
        {
          id: "tabset",
          type: "tabs",
          data: {
            tabs: [
              {
                id: "t1",
                label: "One",
                blocks: [
                  { id: "dup", type: "rich-text", data: { markdown: "a" } },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(() =>
      applyPlanContentPatches(content, [
        {
          op: "append-block",
          parent: { tabBlockId: "tabset", tabId: "t1" },
          block: { id: "dup", type: "rich-text", data: { markdown: "b" } },
        },
      ]),
    ).toThrow(/duplicate block id/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Canvas frame + annotation patch interactions                               */
/* -------------------------------------------------------------------------- */

describe("canvas frame / annotation patch interactions", () => {
  const canvasPlan = (): PlanContent =>
    planContentSchema.parse({
      version: 2,
      canvas: {
        title: "Board",
        frames: [
          {
            id: "f1",
            label: "Screen",
            blockId: "wf",
            x: 0,
            y: 0,
            width: 400,
            height: 300,
          },
        ],
        annotations: [{ id: "a1", text: "Note." }],
      },
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: {
            surface: "desktop",
            screen: [{ id: "t", el: "title", text: "Hi" }],
          },
        },
      ],
    });

  it("update-canvas-frame moves a frame", () => {
    const next = applyPlanContentPatches(canvasPlan(), [
      { op: "update-canvas-frame", frameId: "f1", patch: { x: 120, y: 80 } },
    ]);
    expect(next.canvas?.frames[0]?.x).toBe(120);
    expect(next.canvas?.frames[0]?.y).toBe(80);
  });

  it("BUG PROBE: syncCanvasWireframes can revive frame.wireframe right after update-canvas-frame clears it", () => {
    // A frame referencing a block (blockId) gets its inline `wireframe`
    // re-synced from that block at the end of applyPlanContentPatches. If a
    // patch tries to set/replace the inline `wireframe` on a block-linked frame,
    // syncCanvasWireframes overwrites it. This documents the precedence.
    const next = applyPlanContentPatches(canvasPlan(), [
      {
        op: "update-canvas-frame",
        frameId: "f1",
        patch: {
          wireframe: {
            surface: "mobile",
            screen: [{ el: "title", text: "Patched inline" }],
          },
        },
      },
    ]);
    const frame = next.canvas?.frames[0];
    // Because the frame still has blockId "wf", sync overwrites the inline
    // wireframe with the linked block's data (surface desktop, text "Hi").
    expect(frame?.wireframe?.surface).toBe("desktop");
  });

  it("BUG PROBE: update-canvas-frame to set a label without content yields an invalid label-only artboard", () => {
    // Schema refine: an artboard with a label must carry wireframe/legacyWireframe/blockId.
    // Patching a brand-new label onto a frame that has NO content should be
    // rejected by the final parse.
    const content = planContentSchema.parse({
      version: 2,
      canvas: {
        frames: [{ id: "f1", x: 0, y: 0, width: 400, height: 300 }],
      },
      blocks: [],
    });
    expect(() =>
      applyPlanContentPatches(content, [
        {
          op: "update-canvas-frame",
          frameId: "f1",
          patch: { label: "Now labeled" },
        },
      ]),
    ).toThrow(/wireframe content|no wireframe/i);
  });

  it("inlines a linked wireframe before removing its body block", () => {
    const content = planContentSchema.parse({
      version: 2,
      canvas: {
        frames: [{ id: "f1", label: "Screen", blockId: "wf" }],
      },
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: { surface: "browser", html: "<div>Original canvas</div>" },
        },
      ],
    });

    const next = applyPlanContentPatches(content, [
      { op: "remove-block", blockId: "wf" },
    ]);
    const frame = next.canvas?.frames[0];

    expect(next.blocks).toHaveLength(0);
    expect(frame?.blockId).toBeUndefined();
    expect(frame?.wireframe?.html).toContain("Original canvas");
  });

  it("inlines a linked wireframe before replacing its block with prose", () => {
    const content = planContentSchema.parse({
      version: 2,
      canvas: {
        frames: [{ id: "f1", label: "Screen", blockId: "wf" }],
      },
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: { surface: "browser", html: "<div>Keep me</div>" },
        },
      ],
    });

    const next = applyPlanContentPatches(content, [
      {
        op: "replace-block",
        blockId: "wf",
        block: {
          id: "wf",
          type: "rich-text",
          data: { markdown: "No duplicate wireframe in the body." },
        },
      },
    ]);
    const frame = next.canvas?.frames[0];

    expect(next.blocks[0]?.type).toBe("rich-text");
    expect(frame?.blockId).toBeUndefined();
    expect(frame?.wireframe?.html).toContain("Keep me");
  });

  it("inlines linked legacy wireframes before replace-blocks drops their blocks", () => {
    const content = planContentSchema.parse({
      version: 2,
      canvas: {
        frames: [{ id: "f1", label: "Legacy screen", blockId: "legacy-wf" }],
      },
      blocks: [
        {
          id: "legacy-wf",
          type: "legacy-wireframe",
          data: {
            viewport: "desktop",
            regions: [
              {
                id: "r1",
                kind: "content",
                label: "Original region",
                x: 0,
                y: 0,
                width: 80,
                height: 60,
              },
            ],
          },
        },
      ],
    });

    const next = applyPlanContentPatches(content, [
      {
        op: "replace-blocks",
        blocks: [
          {
            id: "overview",
            type: "rich-text",
            data: { markdown: "Canvas-only mockup now." },
          },
        ],
      },
    ]);
    const frame = next.canvas?.frames[0];

    expect(next.blocks[0]?.id).toBe("overview");
    expect(frame?.blockId).toBeUndefined();
    expect(frame?.legacyWireframe?.regions[0]?.label).toBe("Original region");
  });

  it("update-canvas-annotation can repoint targetId and change placement", () => {
    const next = applyPlanContentPatches(canvasPlan(), [
      {
        op: "update-canvas-annotation",
        annotationId: "a1",
        patch: { targetId: "f1", placement: "top-right", text: "Look here." },
      },
    ]);
    expect(next.canvas?.annotations?.[0]?.targetId).toBe("f1");
    expect(next.canvas?.annotations?.[0]?.placement).toBe("top-right");
    expect(next.canvas?.annotations?.[0]?.text).toBe("Look here.");
  });
});

/* -------------------------------------------------------------------------- */
/* replace-blocks / replace-block content validation                          */
/* -------------------------------------------------------------------------- */

describe("replace-blocks and replace-block validation", () => {
  it("replace-blocks rejects a set with duplicate ids", () => {
    expect(() =>
      applyPlanContentPatches(basePlan(), [
        {
          op: "replace-blocks",
          blocks: [
            { id: "x", type: "rich-text", data: { markdown: "a" } },
            { id: "x", type: "rich-text", data: { markdown: "b" } },
          ],
        },
      ]),
    ).toThrow(/duplicate block id/i);
  });

  it("replace-blocks can empty the document", () => {
    const next = applyPlanContentPatches(basePlan(), [
      { op: "replace-blocks", blocks: [] },
    ]);
    expect(next.blocks).toHaveLength(0);
  });

  it("replace-block swaps a block type while keeping the same id", () => {
    const next = applyPlanContentPatches(basePlan(), [
      {
        op: "replace-block",
        blockId: "rt",
        block: { id: "rt", type: "callout", data: { body: "Now a callout." } },
      },
    ]);
    const blk = next.blocks.find((b) => b.id === "rt");
    expect(blk?.type).toBe("callout");
  });
});

/* -------------------------------------------------------------------------- */
/* patch-wireframe-html: find/replace mechanics                               */
/* -------------------------------------------------------------------------- */

describe("patch-wireframe-html: find/replace mechanics", () => {
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

  it("all:true replaces every occurrence", () => {
    const next = applyPlanContentPatches(htmlWireframe("<i>a</i><i>a</i>"), [
      {
        op: "patch-wireframe-html",
        blockId: "wf1",
        edits: [{ find: "<i>a</i>", replace: "<b>z</b>", all: true }],
      },
    ]);
    expect(htmlOf(next)).toBe("<b>z</b><b>z</b>");
  });

  it("ambiguous find without all:true throws and reports the match count", () => {
    expect(() =>
      applyPlanContentPatches(htmlWireframe("<i>a</i><i>a</i>"), [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [{ find: "<i>a</i>", replace: "<b>z</b>" }],
        },
      ]),
    ).toThrow(/matched 2 times/i);
  });

  it("BUG PROBE: an empty replacement that deletes content is allowed", () => {
    // find present once, replace with "" deletes it. Should succeed (delete op).
    const next = applyPlanContentPatches(
      htmlWireframe("<span>keep</span><span>drop</span>"),
      [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [{ find: "<span>drop</span>", replace: "" }],
        },
      ],
    );
    expect(htmlOf(next)).toBe("<span>keep</span>");
  });

  it("BUG PROBE: a replace whose output contains the find string + all:true does NOT infinite loop", () => {
    // split/join is single-pass so this is safe, but pin the behavior: replacing
    // "x" with "xx" using all:true should double each x once, not forever.
    const next = applyPlanContentPatches(htmlWireframe("<p>x x</p>"), [
      {
        op: "patch-wireframe-html",
        blockId: "wf1",
        edits: [{ find: "x", replace: "xx", all: true }],
      },
    ]);
    expect(htmlOf(next)).toBe("<p>xx xx</p>");
  });
});

/* -------------------------------------------------------------------------- */
/* Whole-plan validation gating                                               */
/* -------------------------------------------------------------------------- */

describe("applyPlanContentPatches validates the input plan first", () => {
  it("throws when the starting content is already invalid", () => {
    const broken = {
      version: 2,
      blocks: [
        { id: "x", type: "rich-text", data: { markdown: "a" } },
        { id: "x", type: "rich-text", data: { markdown: "b" } },
      ],
    } as unknown as PlanContent;
    expect(() =>
      applyPlanContentPatches(broken, [
        { op: "update-rich-text", blockId: "x", markdown: "c" },
      ]),
    ).toThrow();
  });

  it("does not mutate the input content object", () => {
    const content = basePlan();
    const before = JSON.stringify(content);
    applyPlanContentPatches(content, [
      { op: "update-rich-text", blockId: "rt", markdown: "Changed." },
    ]);
    expect(JSON.stringify(content)).toBe(before);
  });
});
