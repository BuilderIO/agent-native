// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { PlanBlock } from "./plan-content";
import { blocksToProseJSON, proseJSONToBlocks } from "./plan-doc";

function roundTrip(blocks: PlanBlock[], prev: PlanBlock[]): PlanBlock[] {
  return proseJSONToBlocks(blocksToProseJSON(blocks), prev);
}

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

    const merged = roundTrip(blocks, blocks);
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe("rich-text");
    if (merged[0].type === "rich-text") {
      expect(merged[0].data.markdown).toContain("First paragraph.");
      expect(merged[0].data.markdown).toContain("Second paragraph.");
    }
    expect(merged[0].id).toBe("rt-a");

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
    expect(doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
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

    expect(pass1.map((b) => b.id)).toEqual(pass2.map((b) => b.id));
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
