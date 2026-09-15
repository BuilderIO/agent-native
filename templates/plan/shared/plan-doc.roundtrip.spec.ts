// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { PlanBlock } from "./plan-content";
import { blocksToProseJSON, proseJSONToBlocks } from "./plan-doc";

/**
 * Round-trip / idempotency contract for the plan doc ⇄ blocks[] serializer.
 *
 * The bridge converts `PlanContent.blocks[]` into ONE editable ProseMirror doc
 * and back. The correctness gate is that
 *
 *     proseJSONToBlocks(blocksToProseJSON(blocks), blocks)
 *
 * is a fixed point on the CANONICAL shape: prose markdown may be normalized once
 * (`gfmToProseJSON`/`proseJSONToGfm` round-trips canonical GFM, not arbitrary
 * input), and TWO ADJACENT rich-text blocks intentionally MERGE into one prose
 * run (the model: contiguous prose in `blocks[]` is one contiguous run in the
 * doc). So the FIRST round-trip yields the canonical block list, and the SECOND
 * round-trip must reproduce it exactly — a true fixed point — with the SAME ids
 * for structured blocks and stable ids for prose runs that were not split.
 */

/** One serialize→deserialize round-trip. */
function roundTrip(blocks: PlanBlock[], prev: PlanBlock[]): PlanBlock[] {
  return proseJSONToBlocks(blocksToProseJSON(blocks), prev);
}

/**
 * Assert that `blocks` is a canonical fixed point: a round-trip (using `blocks`
 * itself as prevBlocks) reproduces it, AND a second round-trip is identical.
 * Returns the canonical list for further assertions.
 */
function expectFixedPoint(blocks: PlanBlock[]): PlanBlock[] {
  const once = roundTrip(blocks, blocks);
  const twice = roundTrip(once, once);
  expect(twice).toEqual(once);
  return once;
}

describe("plan-doc serializer round-trip", () => {
  it("(a) only prose → one rich-text block, stable id", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-1",
        type: "rich-text",
        data: { markdown: "# Title\n\nA paragraph with **bold** text." },
      },
    ];
    const canonical = expectFixedPoint(blocks);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].type).toBe("rich-text");
    expect(canonical[0].id).toBe("rt-1");
  });

  it("(b) prose + callout + prose → three blocks, ids preserved", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-before",
        type: "rich-text",
        data: { markdown: "Intro paragraph." },
      },
      {
        id: "callout-1",
        type: "callout",
        title: "Heads up",
        summary: "A note",
        data: { tone: "info", body: "Watch out for this." },
      },
      {
        id: "rt-after",
        type: "rich-text",
        data: { markdown: "Closing paragraph." },
      },
    ];

    const canonical = expectFixedPoint(blocks);
    expect(canonical.map((b) => b.id)).toEqual([
      "rt-before",
      "callout-1",
      "rt-after",
    ]);
    expect(canonical.map((b) => b.type)).toEqual([
      "rich-text",
      "callout",
      "rich-text",
    ]);

    // Structured block keeps its title/summary (from the node) and data (from
    // prevBlocks).
    const callout = canonical[1];
    expect(callout.type).toBe("callout");
    if (callout.type === "callout") {
      expect(callout.title).toBe("Heads up");
      expect(callout.summary).toBe("A note");
      expect(callout.data).toEqual({
        tone: "info",
        body: "Watch out for this.",
      });
    }
  });

  it("(c) two ADJACENT rich-text blocks MERGE into one prose run (documented)", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-a",
        type: "rich-text",
        data: { markdown: "First paragraph." },
      },
      {
        id: "rt-b",
        type: "rich-text",
        data: { markdown: "Second paragraph." },
      },
    ];

    // First round-trip merges the two adjacent prose blocks into ONE rich-text
    // block. This is the intended canonical form, NOT a bug — contiguous prose
    // is a single run in the document.
    const merged = roundTrip(blocks, blocks);
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe("rich-text");
    if (merged[0].type === "rich-text") {
      expect(merged[0].data.markdown).toContain("First paragraph.");
      expect(merged[0].data.markdown).toContain("Second paragraph.");
    }
    // The merged block keeps the FIRST run's id (stable across the merge).
    expect(merged[0].id).toBe("rt-a");

    // After the merge the shape is canonical — a second round-trip is a true
    // fixed point.
    const again = roundTrip(merged, merged);
    expect(again).toEqual(merged);
  });

  it("(d) tabs block with nested data round-trips structurally", () => {
    const blocks: PlanBlock[] = [
      {
        id: "tabs-1",
        type: "tabs",
        title: "Options",
        data: {
          tabs: [
            {
              id: "tab-a",
              label: "Tab A",
              blocks: [
                {
                  id: "nested-rt",
                  type: "rich-text",
                  data: { markdown: "Inside tab A." },
                },
              ],
            },
            {
              id: "tab-b",
              label: "Tab B",
              blocks: [],
            },
          ],
        },
      },
    ];

    const canonical = expectFixedPoint(blocks);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].id).toBe("tabs-1");
    expect(canonical[0].type).toBe("tabs");
    if (canonical[0].type === "tabs") {
      // Nested data is recovered verbatim from prevBlocks (the doc never carries
      // structured-block data).
      expect(canonical[0].data.tabs).toHaveLength(2);
      expect(canonical[0].data.tabs[0].blocks[0]).toMatchObject({
        id: "nested-rt",
        type: "rich-text",
      });
      expect(canonical[0].title).toBe("Options");
    }
  });

  it("(e) wireframe block round-trips structurally with data preserved", () => {
    const blocks: PlanBlock[] = [
      {
        id: "wf-1",
        type: "wireframe",
        summary: "Landing screen",
        data: {
          surface: "desktop",
          caption: "Home",
          screen: [{ id: "t1", el: "title", text: "Welcome" }],
        },
      },
    ];

    const canonical = expectFixedPoint(blocks);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].id).toBe("wf-1");
    expect(canonical[0].type).toBe("wireframe");
    if (canonical[0].type === "wireframe") {
      expect(canonical[0].summary).toBe("Landing screen");
      expect(canonical[0].data).toEqual({
        surface: "desktop",
        caption: "Home",
        screen: [{ id: "t1", el: "title", text: "Welcome" }],
      });
    }
  });

  it("(f) empty blocks → empty doc → empty block list", () => {
    const doc = blocksToProseJSON([]);
    // Empty input still produces a valid, editable doc (one empty paragraph).
    expect(doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    // The inverse pass drops the whitespace-only run → empty block list.
    expect(proseJSONToBlocks(doc, [])).toEqual([]);
  });

  it("(g) mixed prose + structured + prose with adjacency boundaries", () => {
    const blocks: PlanBlock[] = [
      { id: "p1", type: "rich-text", data: { markdown: "Lead in." } },
      {
        id: "d1",
        type: "diagram",
        data: {
          nodes: [
            { id: "n1", label: "Start" },
            { id: "n2", label: "End" },
          ],
          edges: [{ from: "n1", to: "n2" }],
        },
      },
      { id: "p2", type: "rich-text", data: { markdown: "Between blocks." } },
      {
        id: "c1",
        type: "callout",
        data: { tone: "warning", body: "Careful." },
      },
      { id: "p3", type: "rich-text", data: { markdown: "Wrap up." } },
    ];

    const canonical = expectFixedPoint(blocks);
    // Structured blocks keep prose blocks separated; no merging happens here.
    expect(canonical.map((b) => b.id)).toEqual(["p1", "d1", "p2", "c1", "p3"]);
    expect(canonical.map((b) => b.type)).toEqual([
      "rich-text",
      "diagram",
      "rich-text",
      "callout",
      "rich-text",
    ]);
  });
});

describe("plan-doc id stability", () => {
  it("structured block ids are identical across two serialize/deserialize passes", () => {
    const blocks: PlanBlock[] = [
      { id: "p-top", type: "rich-text", data: { markdown: "Top prose." } },
      {
        id: "callout-stable",
        type: "callout",
        data: { tone: "info", body: "Stable." },
      },
      {
        id: "table-stable",
        type: "table",
        data: { columns: ["A", "B"], rows: [["1", "2"]] },
      },
      {
        id: "p-bottom",
        type: "rich-text",
        data: { markdown: "Bottom prose." },
      },
    ];

    const pass1 = roundTrip(blocks, blocks);
    const pass2 = roundTrip(pass1, pass1);

    // Same ids, same order, both passes.
    expect(pass1.map((b) => b.id)).toEqual(pass2.map((b) => b.id));
    // The structured ids never change.
    expect(pass1.map((b) => b.id)).toContain("callout-stable");
    expect(pass1.map((b) => b.id)).toContain("table-stable");
    expect(pass2.map((b) => b.id)).toEqual([
      "p-top",
      "callout-stable",
      "table-stable",
      "p-bottom",
    ]);
  });

  it("a prose run that was not split keeps its run id across passes", () => {
    const blocks: PlanBlock[] = [
      {
        id: "prose-keep",
        type: "rich-text",
        data: { markdown: "# Heading\n\nBody paragraph." },
      },
    ];

    const pass1 = roundTrip(blocks, blocks);
    const pass2 = roundTrip(pass1, pass1);

    expect(pass1[0].id).toBe("prose-keep");
    expect(pass2[0].id).toBe("prose-keep");
  });

  it("a structured block inserted with no previous data falls back to {} but keeps its id", () => {
    // Simulates a slash-command insert: a planBlock node appears in the doc with
    // an id the prevBlocks list has never seen. The pure module cannot reach the
    // registry's spec.empty(), so it falls back to {} data and keeps the id; the
    // caller re-validates / the editor seeds real data.
    const doc = {
      type: "doc",
      content: [
        {
          type: "planBlock",
          attrs: {
            blockType: "callout",
            blockId: "fresh-callout",
            title: null,
            summary: null,
          },
        },
      ],
    };

    const blocks = proseJSONToBlocks(doc, []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("fresh-callout");
    expect(blocks[0].type).toBe("callout");
    expect((blocks[0] as { data: unknown }).data).toEqual({});
  });

  it("a reminted duplicate block copies data from its source block id", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "planBlock",
          attrs: {
            blockType: "wireframe",
            blockId: "wireframe-copy",
            sourceBlockId: "wireframe-original",
            title: "Copied screen",
            summary: null,
          },
        },
      ],
    };
    const prev: PlanBlock[] = [
      {
        id: "wireframe-original",
        type: "wireframe",
        editable: false,
        data: {
          surface: "desktop",
          caption: "Original",
          html: "<section><h1>Copied structure</h1></section>",
        },
      },
    ];

    const blocks = proseJSONToBlocks(doc, prev);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: "wireframe-copy",
      type: "wireframe",
      title: "Copied screen",
      editable: false,
    });
    expect((blocks[0] as { data: unknown }).data).toEqual(prev[0].data);
  });
});
