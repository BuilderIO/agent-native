import type { TabsData } from "@agent-native/core/blocks/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TabsBlockEditor, TabsBlockReader, tabsBlock } from "./tabs.js";

const sample: TabsData = {
  tabs: [
    {
      id: "tab-before",
      label: "Before",
      blocks: [{ id: "old", type: "rich-text", data: { markdown: "Old" } }],
    },
    {
      id: "tab-after",
      label: "After",
      blocks: [{ id: "new", type: "rich-text", data: { markdown: "New" } }],
    },
  ],
};

const verticalSample: TabsData = { ...sample, orientation: "vertical" };

describe("tabs block container contract", () => {
  it("exposes tabs as editable block regions", () => {
    expect(tabsBlock.editSurface).toBe("container");
    expect(tabsBlock.container?.regions(sample)).toEqual([
      {
        id: "tab-before",
        label: "Before",
        blocks: sample.tabs[0]?.blocks,
      },
      {
        id: "tab-after",
        label: "After",
        blocks: sample.tabs[1]?.blocks,
      },
    ]);
  });

  it("updates one tab region without rewriting sibling tab blocks", () => {
    const nextBlocks = [
      { id: "middle", type: "callout", data: { body: "Moved", tone: "info" } },
    ];

    const next = tabsBlock.container?.updateRegion(
      sample,
      "tab-after",
      nextBlocks,
    );

    expect(next?.tabs[0]?.blocks).toBe(sample.tabs[0]?.blocks);
    expect(next?.tabs[1]?.blocks).toEqual(nextBlocks);
  });

  it("preserves vertical orientation while updating tab regions", () => {
    const next = tabsBlock.container?.updateRegion(
      verticalSample,
      "tab-after",
      [{ id: "diff", type: "diff", data: { before: "a", after: "b" } }],
    );

    expect(next?.orientation).toBe("vertical");
    expect(next?.tabs[1]?.blocks[0]?.type).toBe("diff");
  });

  it("adds, removes, and reorders tab regions within schema bounds", () => {
    const added = tabsBlock.container?.addRegion?.(
      verticalSample,
      "tab-before",
    );
    expect(added?.tabs).toHaveLength(3);
    expect(added?.tabs[1]?.blocks).toEqual([]);
    expect(added?.orientation).toBe("vertical");

    const removed = tabsBlock.container?.removeRegion?.(added!, "tab-before");
    expect(removed?.tabs.map((tab) => tab.id)).toEqual([
      added?.tabs[1]?.id,
      "tab-after",
    ]);
    expect(removed?.orientation).toBe("vertical");

    const reordered = tabsBlock.container?.reorderRegion?.(
      verticalSample,
      "tab-after",
      "tab-before",
    );
    expect(reordered?.tabs.map((tab) => tab.id)).toEqual([
      "tab-after",
      "tab-before",
    ]);
    expect(reordered?.orientation).toBe("vertical");
  });
});

describe("tabs block renderers", () => {
  it("renders legacy tabs without a tabs field", () => {
    const data = {} as unknown as TabsData;
    expect(() =>
      renderToStaticMarkup(
        createElement(TabsBlockReader, {
          data,
          blockId: "tabs-legacy",
          ctx: {},
        }),
      ),
    ).not.toThrow();
  });

  it("opens an empty editor for legacy tabs without a tabs field", () => {
    const data = {} as unknown as TabsData;
    expect(() =>
      renderToStaticMarkup(
        createElement(TabsBlockEditor, {
          data,
          onChange: () => undefined,
          editable: true,
          blockId: "tabs-legacy",
          ctx: {},
        }),
      ),
    ).not.toThrow();
  });

  it("exposes tab settings for empty legacy vertical tabs", () => {
    const data = { orientation: "vertical" } as unknown as TabsData;
    const markup = renderToStaticMarkup(
      createElement(TabsBlockEditor, {
        data,
        onChange: () => undefined,
        editable: true,
        blockId: "tabs-legacy-vertical",
        ctx: {},
      }),
    );

    expect(markup).toContain('aria-label="Edit tabs"');
  });
});
