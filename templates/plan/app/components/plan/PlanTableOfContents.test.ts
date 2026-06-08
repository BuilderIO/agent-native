import { describe, expect, it } from "vitest";
import type { PlanBlock } from "@shared/plan-content";
import {
  collectPlanTocItems,
  getActivePlanTocId,
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
});
