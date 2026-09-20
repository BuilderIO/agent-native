import { chromium } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { projectLinkedComponentPropertyEdit } from "./linked-component-mutation";
import { runScreenVisualStructureChange } from "./screen-visual-structure-change";
import {
  planVisualGridGroupStructureChange,
  resolveGridGroupLinkedComponentTarget,
  runVisualStructureChange,
} from "./visual-structure-change";

const selector = '[data-agent-native-node-id="target"]';
const anchorSelector = '[data-agent-native-node-id="anchor"]';

for (const sourceType of ["localhost", "fusion"] as const) {
  describe(`${sourceType} visual structure changes`, () => {
    it("queues active-screen changes without reading stored HTML", () => {
      const recordPendingLiveStructureEdit = vi.fn();
      const getFreshActiveContent = vi.fn(() => {
        throw new Error("running app markup is not stored in Design HTML");
      });

      const result = runVisualStructureChange(
        {
          activeCanvasSourceType: sourceType,
          activeFile: { id: "active-screen" } as never,
          applyLocalContentUpdate: vi.fn(),
          canEditDesign: true,
          getFreshActiveContent,
          recordPendingLiveStructureEdit,
          setSelectedElement: vi.fn(),
          setSelectedLayerIdsState: vi.fn(),
          t: (key) => key,
        },
        selector,
        anchorSelector,
        "after",
        undefined,
        { sourceId: "target", anchorSourceId: "anchor" },
      );

      expect(result).toBe("pending");
      expect(getFreshActiveContent).not.toHaveBeenCalled();
      expect(recordPendingLiveStructureEdit).toHaveBeenCalledWith(
        "active-screen",
        selector,
        anchorSelector,
        "after",
        undefined,
        expect.objectContaining({
          sourceId: "target",
          anchorSourceId: "anchor",
        }),
      );
    });

    it("queues inactive-screen changes without reading stored HTML or changing selection", () => {
      const recordPendingLiveStructureEdit = vi.fn();
      const getScreenContent = vi.fn(() => {
        throw new Error("running app markup is not stored in Design HTML");
      });
      const setActiveFileId = vi.fn();
      const handleVisualStructureChange = vi.fn();

      const result = runScreenVisualStructureChange(
        {
          activeFile: { id: "active-screen" } as never,
          applyFileContentUpdate: vi.fn(),
          canEditDesign: true,
          designSourceType: "inline",
          getScreenContent,
          handleVisualStructureChange,
          overviewScreens: [{ id: "other-screen", sourceType } as never],
          recordPendingLiveStructureEdit,
          setActiveFileId,
          setSelectedElement: vi.fn(),
          setSelectedLayerIdsState: vi.fn(),
          t: (key) => key,
        },
        "other-screen",
        selector,
        anchorSelector,
        "after",
        undefined,
        { sourceId: "target", anchorSourceId: "anchor" },
      );

      expect(result).toBe("pending");
      expect(getScreenContent).not.toHaveBeenCalled();
      expect(handleVisualStructureChange).not.toHaveBeenCalled();
      expect(setActiveFileId).not.toHaveBeenCalled();
      expect(recordPendingLiveStructureEdit).toHaveBeenCalledWith(
        "other-screen",
        selector,
        anchorSelector,
        "after",
        undefined,
        expect.objectContaining({
          sourceId: "target",
          anchorSourceId: "anchor",
        }),
      );
    });
  });
}

describe("inline grid structure changes", () => {
  it("reloads grouped placements without stale important longhands", async () => {
    const content =
      "<style>#target{display:grid;grid-template-columns:repeat(4,80px);grid-template-rows:repeat(4,60px)}</style>" +
      '<section data-agent-native-node-id="source">' +
      '<div data-agent-native-node-id="a" style="grid-column-start:1!important;grid-column-end:3!important;grid-row-start:1!important;grid-row-end:2!important;color:navy">A</div>' +
      '<div data-agent-native-node-id="b" style="grid-column-start:1!important;grid-column-end:3!important;grid-row-start:2!important;grid-row-end:3!important">B</div></section>' +
      '<section id="target" data-agent-native-node-id="target">' +
      '<div data-agent-native-node-id="occupied" style="grid-column-start:3!important;grid-column-end:5!important;grid-row-start:2!important;grid-row-end:3!important">O</div></section>';
    const moves = ["a", "b"].map((id, index) => ({
      requestId: id,
      selector: `[data-agent-native-node-id="${id}"]`,
      sourceId: id,
      anchorSelector: '[data-agent-native-node-id="target"]',
      anchorSourceId: "target",
      gridPlacement: {
        column: 3,
        columnEnd: 5,
        row: index + 2,
        rowEnd: index + 3,
      },
      gridDisplacements:
        index === 0
          ? [
              {
                sourceId: "occupied",
                selector: '[data-agent-native-node-id="occupied"]',
                placement: { column: 1, columnEnd: 3, row: 2, rowEnd: 3 },
              },
            ]
          : [],
    }));
    const persisted = planVisualGridGroupStructureChange(
      { id: "screen" } as never,
      content,
      moves,
      (key) => key,
    );
    expect(persisted).not.toBeNull();
    expect(persisted).not.toMatch(/grid-(?:column|row)-(?:start|end)/);
    expect(persisted).toContain("color:navy");

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route("http://grid.test/reload", (route) =>
        route.fulfill({ contentType: "text/html", body: persisted! }),
      );
      await page.goto("http://grid.test/reload");
      await page.reload();
      for (const [id, column, row] of [
        ["a", "3 / 5", "2 / 3"],
        ["b", "3 / 5", "3 / 4"],
        ["occupied", "1 / 3", "2 / 3"],
      ]) {
        expect(
          await page
            .locator(`[data-agent-native-node-id="${id}"]`)
            .evaluate((element) => {
              const style = getComputedStyle(element);
              return [style.gridColumn, style.gridRow];
            }),
        ).toEqual([column, row]);
      }
    } finally {
      await browser.close();
    }
  });

  it("plans one linked component edit for both members and propagates to its copy", () => {
    const main =
      '<section data-agent-native-node-id="main-root" data-agent-native-component-id="group">' +
      '<div data-agent-native-node-id="source"><span data-agent-native-node-id="a" style="grid-column: 1 / 3; grid-row: 1">A</span>' +
      '<span data-agent-native-node-id="b" style="grid-column: 1 / 3; grid-row: 2">B</span></div>' +
      '<div data-agent-native-node-id="target"></div></section>';
    const copy =
      '<section data-agent-native-node-id="copy-root" data-agent-native-component-ref="group">' +
      '<div data-agent-native-node-id="copy-source" data-agent-native-component-source-node-id="source">' +
      '<span data-agent-native-node-id="copy-a" data-agent-native-component-source-node-id="a">A</span>' +
      '<span data-agent-native-node-id="copy-b" data-agent-native-component-source-node-id="b">B</span></div>' +
      '<div data-agent-native-node-id="copy-target" data-agent-native-component-source-node-id="target"></div></section>';
    const moves = ["a", "b"].map((id, index) => ({
      requestId: id,
      selector: `[data-agent-native-node-id="${id}"]`,
      sourceId: id,
      anchorSelector: '[data-agent-native-node-id="target"]',
      anchorSourceId: "target",
      gridPlacement: {
        column: 3,
        columnEnd: 5,
        row: index + 2,
        rowEnd: index + 3,
      },
      gridDisplacements: [],
    }));
    const linked = resolveGridGroupLinkedComponentTarget(
      main,
      "main-file",
      moves,
    );
    expect(linked).toEqual({
      status: "linked",
      fileId: "main-file",
      nodeId: "main-root",
    });
    const after = planVisualGridGroupStructureChange(
      { id: "main-file" } as never,
      main,
      moves,
      (key) => key,
      true,
    );
    expect(after).not.toBeNull();
    const projected = projectLinkedComponentPropertyEdit({
      documents: [
        {
          source: {
            kind: "design-file",
            designId: "design",
            fileId: "main-file",
          },
          content: main,
        },
        {
          source: {
            kind: "design-file",
            designId: "design",
            fileId: "copy-file",
          },
          content: copy,
        },
      ],
      fileId: "main-file",
      nodeId: "main-root",
      edit: { kind: "structure", before: main, after: after! },
    });
    expect(projected?.get("copy-file")).toMatch(
      /copy-target[^>]*>[\s\S]*copy-a[\s\S]*copy-b/,
    );
    expect(projected?.get("main-file")).toMatch(/grid-column:\s*3\s*\/\s*5/);
  });

  it("rejects mixed linked roots before publishing any group member", () => {
    const content =
      '<section data-agent-native-node-id="main-one" data-agent-native-component-id="one"><span data-agent-native-node-id="a">A</span><div data-agent-native-node-id="target-one"></div></section>' +
      '<section data-agent-native-node-id="main-two" data-agent-native-component-id="two"><span data-agent-native-node-id="b">B</span><div data-agent-native-node-id="target-two"></div></section>';
    const moves = ["one", "two"].map((suffix, index) => ({
      requestId: suffix,
      selector: `[data-agent-native-node-id="${index ? "b" : "a"}"]`,
      sourceId: index ? "b" : "a",
      anchorSelector: `[data-agent-native-node-id="target-${suffix}"]`,
      anchorSourceId: `target-${suffix}`,
      gridPlacement: { column: 1, columnEnd: 2, row: 1, rowEnd: 2 },
      gridDisplacements: [],
    }));
    expect(
      resolveGridGroupLinkedComponentTarget(content, "screen", moves),
    ).toEqual({
      status: "mixed",
    });
  });

  it("rejects the whole group plan when a later member cannot be resolved", () => {
    const content =
      '<section data-agent-native-node-id="source"><div data-agent-native-node-id="a"></div><div data-agent-native-node-id="b"></div></section>' +
      '<section data-agent-native-node-id="target"></section>';
    const placement = { column: 3, columnEnd: 5, row: 2, rowEnd: 3 };
    const moves = ["a", "missing"].map((id) => ({
      requestId: id,
      selector: `[data-agent-native-node-id="${id}"]`,
      sourceId: id,
      anchorSelector: '[data-agent-native-node-id="target"]',
      anchorSourceId: "target",
      gridPlacement: placement,
      gridDisplacements: [],
    }));
    expect(
      planVisualGridGroupStructureChange(
        { id: "screen" } as never,
        content,
        moves,
        (key) => key,
      ),
    ).toBeNull();
    expect(content).toContain('<div data-agent-native-node-id="a"></div>');
  });

  it("persists the held cell after moving an explicitly placed child", () => {
    let published = "";
    const result = runVisualStructureChange(
      {
        activeCanvasSourceType: "inline",
        activeFile: { id: "active-screen" } as never,
        applyLocalContentUpdate: (content) => {
          published = content;
          return {
            status: "accepted",
            content,
            nodeIdMap: new Map(),
          } as never;
        },
        canEditDesign: true,
        getFreshActiveContent: () =>
          '<div data-agent-native-node-id="grid"><div data-agent-native-node-id="target" style="grid-column: 2 / span 2; grid-row: 1"></div><div data-agent-native-node-id="anchor"></div><div data-agent-native-node-id="c" style="grid-column: 1; grid-row: 2"></div></div>',
        recordPendingLiveStructureEdit: vi.fn(),
        setSelectedElement: vi.fn(),
        setSelectedLayerIdsState: vi.fn(),
        t: (key) => key,
      },
      '[data-agent-native-node-id="target"]',
      '[data-agent-native-node-id="anchor"]',
      "inside",
      undefined,
      {
        sourceId: "target",
        anchorSourceId: "grid",
        gridPlacement: { column: 1, columnEnd: 3, row: 2, rowEnd: 3 },
        gridDisplacements: [
          {
            sourceId: "c",
            selector: '[data-agent-native-node-id="c"]',
            placement: { column: 2, columnEnd: 4, row: 1, rowEnd: 2 },
          },
        ],
      },
    );

    expect(result).toBe(true);
    expect(published).toContain("grid-column: 1 / 3");
    expect(published).toContain("grid-row: 2 / 3");
    expect(published).toContain("grid-column: 2 / 4");
    expect(published).toContain("grid-row: 1 / 2");
  });
});
