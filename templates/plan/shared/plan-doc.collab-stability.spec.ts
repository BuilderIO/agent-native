// @vitest-environment happy-dom


import { describe, expect, it } from "vitest";

import type { PlanBlock } from "./plan-content";
import { blocksToProseJSON, proseJSONToBlocks } from "./plan-doc";

function normalizeValue(input: string): string {
  try {
    const parsed = JSON.parse(input) as PlanBlock[];
    return JSON.stringify(proseJSONToBlocks(blocksToProseJSON(parsed), parsed));
  } catch {
    return input;
  }
}

function simulateGetMarkdownAtSteadyState(blocks: PlanBlock[]): string {
  return JSON.stringify(proseJSONToBlocks(blocksToProseJSON(blocks), blocks));
}

describe("plan-doc collab-stability: normalizeValue is a fixed point", () => {
  it("normalizeValue applied twice is identical to once, for a simple markdown block", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-1",
        type: "rich-text",
        data: { markdown: "# Heading\n\nA paragraph with **bold** text." },
      },
    ];
    const value = JSON.stringify(blocks);
    const once = normalizeValue(value);
    const twice = normalizeValue(once);
    expect(twice).toBe(once);
  });

  it("normalizeValue applied twice is identical to once, for mixed prose + structured blocks", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-before",
        type: "rich-text",
        data: { markdown: "Intro paragraph." },
      },
      {
        id: "callout-1",
        type: "callout",
        data: { tone: "info", body: "A note." },
      },
      {
        id: "rt-after",
        type: "rich-text",
        data: { markdown: "## Section\n\n- Item 1\n- Item 2" },
      },
    ];
    const value = JSON.stringify(blocks);
    const once = normalizeValue(value);
    const twice = normalizeValue(once);
    expect(twice).toBe(once);
  });

  it("normalizeValue applied twice is identical to once, for complex GFM markdown", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-complex",
        type: "rich-text",
        data: {
          markdown: [
            "# Title",
            "",
            "> A blockquote.",
            "",
            "```ts",
            "const x = 1;",
            "```",
            "",
            "| Col A | Col B |",
            "| --- | --- |",
            "| v1 | v2 |",
            "",
            "Trailing paragraph.",
          ].join("\n"),
        },
      },
    ];
    const value = JSON.stringify(blocks);
    const once = normalizeValue(value);
    const twice = normalizeValue(once);
    expect(twice).toBe(once);
  });
});

describe("plan-doc collab-stability: autosave echo recognition property", () => {
  it("normalizeValue(simulateGetMarkdown(blocks)) === simulateGetMarkdown(blocks) at steady state", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-1",
        type: "rich-text",
        data: { markdown: "A paragraph." },
      },
    ];
    const emitted = simulateGetMarkdownAtSteadyState(blocks);
    const reNormalized = normalizeValue(emitted);
    expect(reNormalized).toBe(emitted);
  });

  it("normalizeValue(getMarkdown) === getMarkdown for GFM markdown at steady state", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-2",
        type: "rich-text",
        data: { markdown: "# H1\n\nParagraph.\n\n- A\n- B" },
      },
    ];
    const emitted = simulateGetMarkdownAtSteadyState(blocks);
    const reNormalized = normalizeValue(emitted);
    expect(reNormalized).toBe(emitted);
  });

  it("structured block IDs are preserved through normalizeValue (ring key stability)", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-a",
        type: "rich-text",
        data: { markdown: "Before the block." },
      },
      {
        id: "diagram-1",
        type: "diagram",
        data: { nodes: [{ id: "n1", label: "Start" }], edges: [] },
      },
      {
        id: "rt-b",
        type: "rich-text",
        data: { markdown: "After the block." },
      },
    ];
    const value = JSON.stringify(blocks);
    const normalized = normalizeValue(value);
    const parsed = JSON.parse(normalized) as PlanBlock[];
    expect(parsed.map((b) => b.id)).toEqual(["rt-a", "diagram-1", "rt-b"]);
  });

  it("adjacent rich-text blocks merge in normalizeValue (ring key preserves first block ID)", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-first",
        type: "rich-text",
        data: { markdown: "First paragraph." },
      },
      {
        id: "rt-second",
        type: "rich-text",
        data: { markdown: "Second paragraph." },
      },
    ];
    const normalized = normalizeValue(JSON.stringify(blocks));
    const parsed = JSON.parse(normalized) as PlanBlock[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("rt-first");
    const reNormalized = normalizeValue(normalized);
    expect(reNormalized).toBe(normalized);
  });
});

describe("plan-doc collab-stability: preconditions for single-doc Yjs collab", () => {
  it("serialization is a necessary precondition for safe Yjs collab (regression guard)", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-1",
        type: "rich-text",
        data: { markdown: "# Plan title\n\nSome notes." },
      },
      {
        id: "wireframe-1",
        type: "wireframe",
        data: {
          surface: "desktop",
          caption: "Home",
          screen: [{ id: "t1", el: "title", text: "Welcome" }],
        },
      },
    ];
    const value = JSON.stringify(blocks);
    const canonical = normalizeValue(value);
    const recanonical = normalizeValue(canonical);
    expect(recanonical).toBe(canonical);
    const parsed = JSON.parse(canonical) as PlanBlock[];
    expect(parsed.map((b) => b.id)).toEqual(["rt-1", "wireframe-1"]);
    const emitted = simulateGetMarkdownAtSteadyState(
      JSON.parse(canonical) as PlanBlock[],
    );
    expect(normalizeValue(emitted)).toBe(emitted);
  });
});
