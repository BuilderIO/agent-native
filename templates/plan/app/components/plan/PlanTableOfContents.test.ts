// @vitest-environment happy-dom

import type { PlanBlock } from "@shared/plan-content";
import { describe, expect, it } from "vitest";

import {
  collectPlanTocItems,
  getActivePlanTocId,
  resolvePlanTocElements,
} from "./PlanTableOfContents.utils";

describe("PlanTableOfContents", () => {
  it("collects rich-text headings and titled structured blocks in document order", () => {
    const blocks: PlanBlock[] = [
      {
        id: "intro",
        type: "rich-text",
        data: {
          markdown: [
            "Opening copy",
            "",
            "## Context",
            "Body",
            "",
            "### Constraints",
            "",
            "```ts",
            "## Not a heading",
            "```",
          ].join("\n"),
        },
      },
      {
        id: "map",
        type: "implementation-map",
        title: "Implementation Map",
        data: { files: [] },
      },
      {
        id: "notes",
        type: "rich-text",
        data: { markdown: "Plain paragraph without a heading." },
      },
    ];

    expect(collectPlanTocItems(blocks)).toEqual([
      {
        id: "plan-heading-intro-0",
        blockId: "intro",
        label: "Context",
        level: 0,
        kind: "heading",
        headingIndex: 0,
      },
      {
        id: "plan-heading-intro-1",
        blockId: "intro",
        label: "Constraints",
        level: 1,
        kind: "heading",
        headingIndex: 1,
      },
      {
        id: "plan-section-map",
        blockId: "map",
        label: "Implementation Map",
        level: 0,
        kind: "block",
      },
    ]);
  });

  it("does not synthesize a block label that a real heading already names", () => {
    const blocks: PlanBlock[] = [
      {
        id: "kc",
        type: "rich-text",
        data: { markdown: "## Key changes" },
      },
      {
        id: "d1",
        type: "diff",
        data: { filename: "a.ts", before: "1", after: "2" },
      },
      {
        id: "files",
        type: "file-tree",
        data: { entries: [{ path: "a.ts", change: "modified" }] },
      },
    ];

    const items = collectPlanTocItems(blocks);
    // The "## Key changes" heading already covers the diff block, so the diff
    // must NOT add a second "Key changes" entry; the file-tree still gets one.
    expect(items.map((item) => ({ id: item.id, label: item.label }))).toEqual([
      { id: "plan-heading-kc-0", label: "Key changes" },
      { id: "plan-section-files", label: "Files changed" },
    ]);
  });

  it("cleans simple markdown from heading labels", () => {
    const blocks: PlanBlock[] = [
      {
        id: "copy",
        type: "rich-text",
        data: {
          markdown: "## [`Billing`](https://example.com) **Flow**",
        },
      },
    ];

    expect(collectPlanTocItems(blocks)[0]?.label).toBe("Billing Flow");
  });

  it("uses the scroll container top when choosing the active section", () => {
    const tops: Record<string, number> = {
      first: 42,
      second: 94,
      third: 190,
    };

    expect(
      getActivePlanTocId(
        ["first", "second", "third"],
        (id) => ({
          getBoundingClientRect: () => ({ top: tops[id] }),
        }),
        96,
        { getBoundingClientRect: () => ({ top: 20 }) },
      ),
    ).toBe("second");
  });

  it("chooses the nearest measured section even if DOM positions are out of TOC order", () => {
    const tops: Record<string, number> = {
      first: 20,
      second: 260,
      third: 80,
    };

    expect(
      getActivePlanTocId(
        ["first", "second", "third"],
        (id) => ({
          getBoundingClientRect: () => ({ top: tops[id] }),
        }),
        100,
      ),
    ).toBe("third");
  });

  it("resolves read-only headings by their stable id instead of counting unrelated block headings", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <section class="plan-block" data-block-id="intro">
        <div class="plan-rich-markdown-editor">
          <div class="an-rich-md-prose">
            <h2 id="plan-heading-intro-0">Intro</h2>
          </div>
        </div>
      </section>
      <section class="plan-block plan-callout" data-block-id="callout">
        <div class="plan-rich-markdown-editor">
          <div class="an-rich-md-prose">
            <h2>Nested callout heading</h2>
          </div>
        </div>
      </section>
      <section class="plan-block" data-block-id="details">
        <div class="plan-rich-markdown-editor">
          <div class="an-rich-md-prose">
            <h2 id="plan-heading-details-0">Details</h2>
          </div>
        </div>
      </section>
    `;

    const elements = resolvePlanTocElements(root, [
      {
        id: "plan-heading-intro-0",
        blockId: "intro",
        label: "Intro",
        level: 0,
        kind: "heading",
        headingIndex: 0,
      },
      {
        id: "plan-heading-details-0",
        blockId: "details",
        label: "Details",
        level: 0,
        kind: "heading",
        headingIndex: 0,
      },
    ]);

    expect(elements.get("plan-heading-intro-0")?.textContent).toBe("Intro");
    expect(elements.get("plan-heading-details-0")?.textContent).toBe("Details");
  });

  it("resolves editable headings by rich-text run id and heading index", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="plan-document-editor">
        <div class="an-rich-md-prose">
          <p data-run-id="intro">Opening paragraph</p>
          <h2>Context</h2>
          <h3>Constraints</h3>
          <div data-plan-block data-block-id="map"></div>
          <h2 data-run-id="details">Details</h2>
          <p>More details</p>
        </div>
      </div>
    `;

    const elements = resolvePlanTocElements(root, [
      {
        id: "plan-heading-intro-1",
        blockId: "intro",
        label: "Constraints",
        level: 1,
        kind: "heading",
        headingIndex: 1,
      },
      {
        id: "plan-heading-details-0",
        blockId: "details",
        label: "Details",
        level: 0,
        kind: "heading",
        headingIndex: 0,
      },
    ]);

    expect(elements.get("plan-heading-intro-1")?.textContent).toBe(
      "Constraints",
    );
    expect(elements.get("plan-heading-details-0")?.textContent).toBe("Details");
  });
});
