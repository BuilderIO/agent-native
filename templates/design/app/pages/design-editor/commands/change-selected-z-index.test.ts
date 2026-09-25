/**
 * Clip A 19:55 → 19:59 (XpIts390YLYS): a bare `Ctrl+[` on an in-flow
 * rectangle moved it from Y 225 to Y 128 with its width, height and corner
 * radius unchanged. Every mode built a `moveNode` markup splice, so a
 * paint-order command relaid out the document.
 */

import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

import { runChangeSelectedZIndex } from "./change-selected-z-index";

const CONTENT = `<html><body><div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a" style="position:absolute;left:0;top:0"></div>
<div data-agent-native-node-id="b" style="position:absolute;left:0;top:40px"></div>
</div></body></html>`;

/** Selection state carries projection ids, not authored node attributes. */
function projectionId(authoredId: string, content = CONTENT): string {
  const node = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId: "file-1" },
  }).nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === authoredId,
  );
  if (!node) throw new Error(`no projection node for ${authoredId}`);
  return node.id;
}

function harness(
  element: Partial<ElementInfo>,
  authoredId = "b",
  content = CONTENT,
) {
  const targetId = projectionId(authoredId, content);
  const applyLocalContentUpdate = vi.fn((nextContent: string) => {
    const prepared = prepareCanonicalSourceContent(nextContent, {
      fileId: "file-1",
      fileType: "html",
    });
    return {
      status: "accepted" as const,
      content: prepared.content,
      nodeIdMap: prepared.nodeIdMap,
    };
  });
  const commitVisualStyles = vi.fn();
  const selectedElement = {
    selector: `[data-agent-native-node-id="${targetId}"]`,
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 10, height: 10 },
    isFlexChild: false,
    isFlexContainer: false,
    ...element,
  } as ElementInfo;
  const args = {
    activeFile: { id: "file-1" },
    applyLocalContentUpdate,
    canEditDesign: true,
    codeLayerOwnerByNodeIdRef: {
      current: new Map([[targetId, { fileId: "file-1" }]]),
    },
    commitVisualStyles,
    getFreshActiveContent: () => content,
    selectedElement,
    selectedLayerIdsState: [targetId],
    setSelectedElement: vi.fn(),
  } as unknown as Parameters<typeof runChangeSelectedZIndex>[0];
  /** The write aimed at the selection, ignoring any parent-scoped write. */
  const targetStyles = () =>
    commitVisualStyles.mock.calls.find(
      ([, styles]) =>
        "zIndex" in (styles as Record<string, string>) ||
        "z-index" in (styles as Record<string, string>),
    )?.[1] as Record<string, string> | undefined;
  return { args, applyLocalContentUpdate, commitVisualStyles, targetStyles };
}

describe("runChangeSelectedZIndex — a paint-order change must not move anything", () => {
  it.each(["forward", "backward", "front", "back"] as const)(
    "writes z-index instead of splicing markup for an in-flow element (%s)",
    (mode) => {
      const {
        args,
        applyLocalContentUpdate,
        commitVisualStyles,
        targetStyles,
      } = harness({
        computedStyles: { position: "static", zIndex: "auto" },
      });
      runChangeSelectedZIndex(args, mode);
      if (mode === "back" || mode === "backward") {
        expect(applyLocalContentUpdate).toHaveBeenCalledTimes(1);
        expect(commitVisualStyles).not.toHaveBeenCalled();
      } else {
        expect(applyLocalContentUpdate).not.toHaveBeenCalled();
        expect(targetStyles()?.zIndex).toBeDefined();
        expect(targetStyles()?.position).toBe("relative");
      }
    },
  );

  it("still reorders markup for an absolutely positioned element", () => {
    const { args, applyLocalContentUpdate, commitVisualStyles } = harness({
      computedStyles: { position: "absolute" },
    });
    runChangeSelectedZIndex(args, "backward");
    expect(applyLocalContentUpdate).toHaveBeenCalledTimes(1);
    expect(commitVisualStyles).not.toHaveBeenCalled();
  });

  it("classifies from the rendered position, not the authored fallback", () => {
    const { args, applyLocalContentUpdate, commitVisualStyles } = harness(
      {
        computedStyles: { position: "static" },
        inlineStyles: { position: "absolute" },
      },
      "a",
    );
    runChangeSelectedZIndex(args, "forward");
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(commitVisualStyles).toHaveBeenCalled();
  });

  it("falls back to z-index for a positioned layer with no reorderable sibling", () => {
    const singleChildContent = `<div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a" style="position:absolute"></div>
</div>`;
    const { args, applyLocalContentUpdate, commitVisualStyles } = harness(
      { computedStyles: { position: "absolute" } },
      "a",
      singleChildContent,
    );
    runChangeSelectedZIndex(args, "front");
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(commitVisualStyles).toHaveBeenCalledTimes(1);
  });

  it("writes z-index instead of relying on DOM order for an explicit stack", () => {
    const stackedContent = `<div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a" style="position:absolute;z-index:2"></div>
<div data-agent-native-node-id="b" style="position:absolute;z-index:9"></div>
</div>`;
    const { args, applyLocalContentUpdate, commitVisualStyles, targetStyles } =
      harness(
        { computedStyles: { position: "absolute", zIndex: "2" } },
        "a",
        stackedContent,
      );
    runChangeSelectedZIndex(args, "front");
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(commitVisualStyles).toHaveBeenCalledTimes(1);
    expect(targetStyles()?.zIndex).toBe("10");
  });

  it("crosses the next higher explicit stack level when moving forward", () => {
    const { args, commitVisualStyles, targetStyles } = harness(
      { computedStyles: { position: "absolute", zIndex: "2" } },
      "a",
      `<div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a" style="position:absolute;z-index:2"></div>
<div data-agent-native-node-id="b" style="position:absolute;z-index:9"></div>
</div>`,
    );

    runChangeSelectedZIndex(args, "forward");

    expect(commitVisualStyles).toHaveBeenCalledTimes(1);
    expect(targetStyles()?.zIndex).toBe("10");
  });

  it("uses the sibling's rendered breakpoint stack level", () => {
    const content = `<div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a" style="position:absolute;z-index:2"></div>
<div data-agent-native-node-id="b" style="position:absolute"></div>
</div>`;
    const { args, commitVisualStyles, targetStyles } = multiHarness(
      content,
      ["a"],
      {
        rendered: {
          a: { computedStyles: { position: "absolute", zIndex: "2" } },
          b: { computedStyles: { position: "absolute", zIndex: "9" } },
        },
      },
    );

    runChangeSelectedZIndex(args, "forward");

    expect(commitVisualStyles).toHaveBeenCalledOnce();
    expect(targetStyles()?.zIndex).toBe("10");
  });

  it("writes above a higher rendered sibling instead of relying on DOM order", () => {
    const content = `<div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a" style="position:absolute"></div>
<div data-agent-native-node-id="b" style="position:absolute"></div>
</div>`;
    const { args, applyLocalContentUpdate, commitVisualStyles, targetStyles } =
      multiHarness(content, ["a"], {
        rendered: {
          a: { computedStyles: { position: "absolute", zIndex: "auto" } },
          b: { computedStyles: { position: "absolute", zIndex: "9" } },
        },
      });

    runChangeSelectedZIndex(args, "front");

    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(commitVisualStyles).toHaveBeenCalledOnce();
    expect(targetStyles()?.zIndex).toBe("10");
  });

  it("keeps a measured auto z-index in the auto paint bucket", () => {
    const content = `<div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a" style="position:absolute;z-index:999"></div>
<div data-agent-native-node-id="b" style="position:absolute"></div>
</div>`;
    const { args, applyLocalContentUpdate, commitVisualStyles } = multiHarness(
      content,
      ["a"],
      {
        rendered: {
          a: { computedStyles: { position: "absolute", zIndex: "auto" } },
          b: { computedStyles: { position: "absolute", zIndex: "auto" } },
        },
      },
    );

    runChangeSelectedZIndex(args, "front");

    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    expect(commitVisualStyles).not.toHaveBeenCalled();
  });

  it("does not treat an authored sibling z-index as painted when computed style is auto", () => {
    const content = `<div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a"></div>
<div data-agent-native-node-id="b" style="z-index:9"></div>
</div>`;
    const { args, commitVisualStyles, targetStyles } = multiHarness(
      content,
      ["a"],
      {
        rendered: {
          a: { computedStyles: { position: "static", zIndex: "auto" } },
          b: { computedStyles: { position: "static", zIndex: "auto" } },
        },
      },
    );

    runChangeSelectedZIndex(args, "front");

    expect(commitVisualStyles).toHaveBeenCalledOnce();
    expect(targetStyles()?.zIndex).toBe("1");
  });

  it("does not make an inert authored target z-index suppress DOM reorder", () => {
    const content = `<div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a" style="z-index:999"><span data-agent-native-node-id="pin"></span></div>
<div data-agent-native-node-id="b"></div>
</div>`;
    const { args, applyLocalContentUpdate, commitVisualStyles } = multiHarness(
      content,
      ["a"],
      {
        rendered: {
          a: { computedStyles: { position: "static", zIndex: "auto" } },
          pin: { computedStyles: { position: "absolute", zIndex: "auto" } },
        },
      },
    );

    runChangeSelectedZIndex(args, "front");

    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    expect(commitVisualStyles).not.toHaveBeenCalled();
  });

  it("sends to back below static siblings, not to z-index 0", () => {
    const { args, applyLocalContentUpdate } = harness({
      computedStyles: { position: "static", zIndex: "auto" },
    });
    runChangeSelectedZIndex(args, "back");
    expect(applyLocalContentUpdate).toHaveBeenCalledTimes(1);
    expect(applyLocalContentUpdate.mock.calls[0]?.[0]).toMatch(/z-index:\s*-1/);
  });

  it("keeps stepping backward past zero", () => {
    const { args, applyLocalContentUpdate } = harness({
      computedStyles: { position: "relative", zIndex: "0" },
    });
    runChangeSelectedZIndex(args, "backward");
    expect(applyLocalContentUpdate).toHaveBeenCalledTimes(1);
    expect(applyLocalContentUpdate.mock.calls[0]?.[0]).toMatch(/z-index:\s*-1/);
  });
});

// PR #3585 review: a negative z-index escapes to the nearest stacking-context
// ancestor, so an in-flow layer sent to back could vanish behind an opaque
// parent background instead of moving behind its siblings.
describe("runChangeSelectedZIndex — send to back must not hide the layer", () => {
  it("isolates the parent so the negative index cannot escape", () => {
    const { args, applyLocalContentUpdate, commitVisualStyles } = harness({
      computedStyles: { position: "static", zIndex: "auto" },
    });
    runChangeSelectedZIndex(args, "back");
    expect(commitVisualStyles).not.toHaveBeenCalled();
    expect(applyLocalContentUpdate).toHaveBeenCalledTimes(1);
    expect(applyLocalContentUpdate.mock.calls[0]?.[0]).toMatch(
      /isolation:\s*isolate/,
    );
    expect(applyLocalContentUpdate.mock.calls[0]?.[0]).toMatch(/z-index:\s*-1/);
  });

  it("stays at 0 when there is no parent to isolate", () => {
    const { args, applyLocalContentUpdate, commitVisualStyles } = harness(
      { computedStyles: { position: "static", zIndex: "auto" } },
      "wrap",
      '<html><body><div data-agent-native-node-id="wrap"></div></body></html>',
    );
    runChangeSelectedZIndex(args, "back");
    expect(commitVisualStyles).toHaveBeenCalledWith(
      expect.any(String),
      { position: "relative", zIndex: "0" },
      expect.any(Object),
    );
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
  });
});

// PR #3585 review round 2.
describe("runChangeSelectedZIndex — send to back must reach the back", () => {
  it("goes below a sibling that is already negative", () => {
    const content = `<html><body><div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a" style="position:relative;z-index:-2"></div>
<div data-agent-native-node-id="b"></div>
</div></body></html>`;
    const { args, applyLocalContentUpdate } = harness(
      { computedStyles: { position: "static", zIndex: "auto" } },
      "b",
      content,
    );
    runChangeSelectedZIndex(args, "back");
    expect(applyLocalContentUpdate.mock.calls[0]?.[0]).toMatch(/z-index:\s*-3/);
  });

  it("does not raise a layer that is already lower than its siblings", () => {
    const { args, applyLocalContentUpdate } = harness({
      computedStyles: { position: "static", zIndex: "-5" },
    });
    runChangeSelectedZIndex(args, "back");
    expect(applyLocalContentUpdate.mock.calls[0]?.[0]).toMatch(/z-index:\s*-5/);
  });
});

describe("runChangeSelectedZIndex — must not relocate positioned children", () => {
  const withAbsChild = `<html><body><div data-agent-native-node-id="wrap">
<div data-agent-native-node-id="a"></div>
<div data-agent-native-node-id="b"><span data-agent-native-node-id="pin" style="position:absolute;left:10px;top:10px"></span></div>
</div></body></html>`;

  it("reorders markup rather than positioning a static container with an absolute child", () => {
    const { args, applyLocalContentUpdate, commitVisualStyles } = harness(
      { computedStyles: { position: "static", zIndex: "auto" } },
      "b",
      withAbsChild,
    );
    runChangeSelectedZIndex(args, "backward");
    expect(commitVisualStyles).not.toHaveBeenCalled();
    expect(applyLocalContentUpdate).toHaveBeenCalledTimes(1);
  });

  it("reorders a flex item through the DOM", () => {
    const { args, applyLocalContentUpdate, commitVisualStyles } = harness(
      {
        isFlexChild: true,
        parentDisplay: "flex",
        computedStyles: { position: "static", zIndex: "auto" },
      },
      "b",
      withAbsChild,
    );
    runChangeSelectedZIndex(args, "backward");
    expect(applyLocalContentUpdate).toHaveBeenCalledTimes(1);
    expect(commitVisualStyles).not.toHaveBeenCalled();
  });
});

const source = { kind: "design-file" as const, fileId: "file-1" };

function projectionNode(content: string, name: string) {
  const node = buildCodeLayerProjection(content, { source }).nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === name,
  );
  if (!node) throw new Error(`Missing projection node ${name}`);
  return node;
}

function directChildNames(content: string, parentName = "screen") {
  const projection = buildCodeLayerProjection(content, { source });
  const parent = projectionNode(content, parentName);
  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  return parent.children.map(
    (id) => byId.get(id)?.dataAttributes["data-agent-native-node-id"],
  );
}

function multiHarness(
  content: string,
  selectedNames: string[],
  options: {
    selectedElement?: Partial<ElementInfo>;
    rendered?: Record<string, Partial<ElementInfo>>;
    publicationStatus?: "accepted" | "rejected";
    responsiveEditScope?: "all" | "cascade-smaller" | "only";
    activeBreakpointUpperBoundPx?: number | null;
    activeBreakpointWidthPx?: number;
  } = {},
) {
  const selectedNodes = selectedNames.map((name) =>
    projectionNode(content, name),
  );
  const primary = selectedNodes[selectedNodes.length - 1]!;
  let currentContent = content;
  const applyLocalContentUpdate = vi.fn((nextContent: string) => {
    if (options.publicationStatus === "rejected") {
      return { status: "rejected" } as never;
    }
    currentContent = nextContent;
    const prepared = prepareCanonicalSourceContent(nextContent, {
      fileId: source.fileId,
      fileType: "html",
    });
    return {
      status: "accepted" as const,
      content: prepared.content,
      nodeIdMap: prepared.nodeIdMap,
    };
  });
  const rendered = new Map<string, ElementInfo>();
  for (const [name, info] of Object.entries(options.rendered ?? {})) {
    const node = projectionNode(content, name);
    rendered.set(`${source.fileId}:${node.id}`, {
      tagName: node.tag,
      selector: `[data-agent-native-node-id="${node.id}"]`,
      classes: [],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      ...info,
    } as ElementInfo);
  }
  const selectedElement = {
    selector: `[data-agent-native-node-id="${primary.id}"]`,
    tagName: primary.tag,
    classes: [],
    computedStyles: { position: "static", zIndex: "auto" },
    boundingRect: { x: 0, y: 0, width: 10, height: 10 },
    ...options.selectedElement,
  } as ElementInfo;
  const reportRefusal = vi.fn();
  const commitVisualStyles = vi.fn();
  const args = {
    activeBreakpointUpperBoundPx: options.activeBreakpointUpperBoundPx,
    activeBreakpointWidthStateRef: {
      current: options.activeBreakpointWidthPx,
    },
    activeFile: { id: source.fileId },
    applyLocalContentUpdate,
    applyLinkedComponentEdit: vi.fn(),
    canEditDesign: true,
    codeLayerOwnerByNodeIdRef: {
      current: new Map(
        selectedNodes.map((node) => [
          node.id,
          { fileId: source.fileId, node, tree: [], runtimeOnly: false },
        ]),
      ),
    },
    commitVisualStyles,
    getFreshActiveContent: () => currentContent,
    renderedElementInfoByLayerKeyRef: { current: rendered },
    reportRefusal,
    responsiveEditScopeRef: {
      current: options.responsiveEditScope ?? "all",
    },
    selectedElement,
    selectedLayerIdsState: selectedNodes.map((node) => node.id),
    setSelectedElement: vi.fn(),
  } as unknown as Parameters<typeof runChangeSelectedZIndex>[0];
  const targetStyles = () =>
    commitVisualStyles.mock.calls.find(
      ([, styles]) =>
        "zIndex" in (styles as Record<string, string>) ||
        "z-index" in (styles as Record<string, string>),
    )?.[1] as Record<string, string> | undefined;
  return {
    args,
    applyLocalContentUpdate,
    currentContent: () => currentContent,
    commitVisualStyles,
    reportRefusal,
    rendered,
    targetStyles,
  };
}

const G8_CONTENT = `<div data-agent-native-node-id="screen">
<div data-agent-native-node-id="S"></div>
<div data-agent-native-node-id="A" style="position:absolute"></div>
<div data-agent-native-node-id="B" style="position:absolute"></div>
<div data-agent-native-node-id="C" style="position:absolute"></div>
<div data-agent-native-node-id="D" style="position:absolute"></div>
</div>`;

describe("runChangeSelectedZIndex — rendered multi-selection order", () => {
  it.each([
    ["front", ["S", "B", "D", "A", "C"]],
    ["back", ["A", "C", "S", "B", "D"]],
    ["forward", ["S", "B", "A", "D", "C"]],
    ["backward", ["A", "S", "C", "B", "D"]],
  ] as const)("uses the native oracle order for %s", (mode, expected) => {
    const { args, applyLocalContentUpdate } = multiHarness(
      G8_CONTENT,
      ["A", "C"],
      {
        rendered: {
          A: { computedStyles: { position: "absolute", zIndex: "auto" } },
          C: { computedStyles: { position: "absolute", zIndex: "auto" } },
        },
      },
    );

    const result = runChangeSelectedZIndex(args, mode);

    expect(result).toEqual({ status: "applied" });
    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    expect(directChildNames(applyLocalContentUpdate.mock.calls[0]![0])).toEqual(
      expected,
    );
  });

  // {A, C} passes with the no-hop guard removed or the loop reversed; an
  // adjacent pair is what exposes both.
  it.each([
    ["forward", ["S", "A", "D", "B", "C"]],
    ["backward", ["S", "B", "C", "A", "D"]],
  ] as const)(
    "moves an adjacent selection %s one slot without splitting it",
    (mode, expected) => {
      const { args, applyLocalContentUpdate } = multiHarness(
        G8_CONTENT,
        ["B", "C"],
        {
          rendered: {
            B: { computedStyles: { position: "absolute", zIndex: "auto" } },
            C: { computedStyles: { position: "absolute", zIndex: "auto" } },
          },
        },
      );

      expect(runChangeSelectedZIndex(args, mode)).toEqual({
        status: "applied",
      });
      expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
      expect(
        directChildNames(applyLocalContentUpdate.mock.calls[0]![0]),
      ).toEqual(expected);
    },
  );

  it.each([
    ["forward", ["C", "D"]],
    ["backward", ["S", "A"]],
  ] as const)(
    "does not hop %s over a selected neighbour pinned at the edge",
    (mode, selected) => {
      const absolute = {
        computedStyles: { position: "absolute", zIndex: "auto" },
      };
      const { args, applyLocalContentUpdate } = multiHarness(
        G8_CONTENT,
        [...selected],
        { rendered: { [selected[0]]: absolute, [selected[1]]: absolute } },
      );

      expect(runChangeSelectedZIndex(args, mode)).toEqual({
        status: "unchanged",
      });
      expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    },
  );

  it("reorders an auto-layout child instead of adding a z-index", () => {
    const content = `<div data-agent-native-node-id="screen" style="display:flex">
<div data-agent-native-node-id="first">First</div>
<div data-agent-native-node-id="second">Second</div>
</div>`;
    const { args, applyLocalContentUpdate } = multiHarness(content, ["first"], {
      selectedElement: { parentDisplay: "flex" },
      rendered: {
        first: {
          computedStyles: { position: "static" },
          parentDisplay: "flex",
        },
      },
    });

    runChangeSelectedZIndex(args, "front");

    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    const next = applyLocalContentUpdate.mock.calls[0]![0];
    expect(directChildNames(next)).toEqual(["second", "first"]);
    expect(next).not.toContain("z-index");
  });

  it("classifies every selected layer from its rendered breakpoint state", () => {
    const content = `<div data-agent-native-node-id="screen">
<div data-agent-native-node-id="A"></div>
<div data-agent-native-node-id="B"></div>
<div data-agent-native-node-id="C" style="position:absolute"></div>
</div>`;
    const { args, applyLocalContentUpdate } = multiHarness(
      content,
      ["A", "C"],
      {
        rendered: {
          A: { computedStyles: { position: "absolute", zIndex: "auto" } },
          C: { computedStyles: { position: "static", zIndex: "auto" } },
        },
      },
    );

    runChangeSelectedZIndex(args, "front");

    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    const next = applyLocalContentUpdate.mock.calls[0]![0];
    expect(directChildNames(next)).toEqual(["B", "C", "A"]);
    expect(next).toMatch(/data-agent-native-node-id="C"[^>]*z-index/);
  });

  it("publishes responsive z-index and isolation scope without a base DOM move", () => {
    const content = `<div data-agent-native-node-id="screen">
<div data-agent-native-node-id="S"></div>
<div data-agent-native-node-id="A" style="position:absolute"></div>
<div data-agent-native-node-id="B"></div>
<div data-agent-native-node-id="C"></div>
</div>`;
    const { args, applyLocalContentUpdate } = multiHarness(
      content,
      ["A", "B"],
      {
        activeBreakpointUpperBoundPx: 640,
        activeBreakpointWidthPx: 480,
        responsiveEditScope: "only",
        rendered: {
          A: { computedStyles: { position: "absolute", zIndex: "auto" } },
          B: { computedStyles: { position: "static", zIndex: "auto" } },
        },
      },
    );

    runChangeSelectedZIndex(args, "back");

    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    const next = applyLocalContentUpdate.mock.calls[0]![0];
    expect(directChildNames(next)).toEqual(["S", "A", "B", "C"]);
    expect(next).toMatch(/isolation:\s*isolate/);
    expect(next).toMatch(/max-width:\s*640px/);
    expect(next).toMatch(/min-width:\s*480px/);
  });

  it("publishes a mixed base move, z-index, and isolation edit once", () => {
    const content = `<div data-agent-native-node-id="screen">
<div data-agent-native-node-id="S"></div>
<div data-agent-native-node-id="A" style="position:absolute"></div>
<div data-agent-native-node-id="B"></div>
<div data-agent-native-node-id="C"></div>
</div>`;
    const { args, applyLocalContentUpdate } = multiHarness(
      content,
      ["A", "B"],
      {
        rendered: {
          A: { computedStyles: { position: "absolute", zIndex: "auto" } },
          B: { computedStyles: { position: "static", zIndex: "auto" } },
        },
      },
    );

    runChangeSelectedZIndex(args, "back");

    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    const next = applyLocalContentUpdate.mock.calls[0]![0];
    expect(directChildNames(next)).toEqual(["A", "S", "B", "C"]);
    expect(next).toMatch(/isolation:\s*isolate/);
  });
  it("does not use a substring selector to classify another selected layer", () => {
    const content = `<div data-agent-native-node-id="screen">
<div data-agent-native-node-id="A"></div>
<div data-agent-native-node-id="AB" style="position:absolute"></div>
</div>`;
    const { args, applyLocalContentUpdate } = multiHarness(
      content,
      ["A", "AB"],
      {
        selectedElement: { computedStyles: { position: "absolute" } },
        rendered: {
          A: { computedStyles: { position: "static" } },
          AB: { computedStyles: { position: "absolute" } },
        },
      },
    );

    expect(runChangeSelectedZIndex(args, "front")).toEqual({
      status: "applied",
    });
    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    expect(applyLocalContentUpdate.mock.calls[0]![0]).toMatch(
      /data-agent-native-node-id="A"[^>]*z-index/,
    );
  });

  it("clears rendered metadata after an accepted structural edit", () => {
    const harnessed = multiHarness(G8_CONTENT, ["A"], {
      rendered: { A: { computedStyles: { position: "absolute" } } },
    });
    expect(harnessed.rendered.size).toBe(1);
    runChangeSelectedZIndex(harnessed.args, "front");
    expect(harnessed.rendered.size).toBe(0);
  });

  it("refuses an unmeasured layer-panel selection instead of using authored styles", () => {
    const harnessed = multiHarness(G8_CONTENT, ["A"]);
    (
      harnessed.args as { selectedElement: ElementInfo | null }
    ).selectedElement = null;

    expect(runChangeSelectedZIndex(harnessed.args, "front")).toEqual({
      status: "refused",
      reason: "selection",
    });
    expect(harnessed.applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(harnessed.args.commitVisualStyles).not.toHaveBeenCalled();
  });
});

describe("runChangeSelectedZIndex — refusal is atomic and visible", () => {
  it("does not publish when the content writer rejects the style patch", () => {
    const { args, applyLocalContentUpdate, currentContent, reportRefusal } =
      multiHarness(G8_CONTENT, ["A"], {
        publicationStatus: "rejected",
        selectedElement: { computedStyles: { position: "absolute" } },
        rendered: { A: { computedStyles: { position: "absolute" } } },
      });
    const result = runChangeSelectedZIndex(args, "forward");

    expect(result).toEqual({ status: "refused", reason: "publication" });
    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    expect(currentContent()).toBe(G8_CONTENT);
    expect(reportRefusal).toHaveBeenCalledWith("publication");
  });

  it("refuses runtime-only and repeated template anchors before any write", () => {
    const runtime = multiHarness(G8_CONTENT, ["A"]);
    const runtimeOwner = runtime.args.codeLayerOwnerByNodeIdRef.current
      .values()
      .next().value;
    if (runtimeOwner) runtimeOwner.runtimeOnly = true;
    expect(runChangeSelectedZIndex(runtime.args, "front")).toEqual({
      status: "refused",
      reason: "runtime-only",
    });
    expect(runtime.applyLocalContentUpdate).not.toHaveBeenCalled();

    const repeatContent = `<div data-agent-native-node-id="screen">
<template x-for="item in items"><div data-agent-native-node-id="row"></div></template>
</div>`;
    const repeat = multiHarness(repeatContent, ["row"]);
    expect(runChangeSelectedZIndex(repeat.args, "front")).toEqual({
      status: "refused",
      reason: "repeat-anchor",
    });
    expect(repeat.applyLocalContentUpdate).not.toHaveBeenCalled();
  });

  it("refuses a mixed linked-component move and style as one operation", () => {
    const content = `<section data-agent-native-node-id="main" data-agent-native-component-id="card">
<div data-agent-native-node-id="first" style="position:absolute"></div>
<div data-agent-native-node-id="second"></div>
</section>`;
    const { args, applyLocalContentUpdate, reportRefusal } = multiHarness(
      content,
      ["first", "second"],
      {
        rendered: {
          first: { computedStyles: { position: "absolute", zIndex: "auto" } },
          second: { computedStyles: { position: "static", zIndex: "auto" } },
        },
      },
    );

    const result = runChangeSelectedZIndex(args, "back");

    expect(result).toEqual({ status: "refused", reason: "linked-component" });
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(reportRefusal).toHaveBeenCalledWith("linked-component");
  });

  it("refuses responsive linked-component style edits before delegation", () => {
    const content = `<section data-agent-native-node-id="main" data-agent-native-component-id="card">
<div data-agent-native-node-id="first" style="position:absolute"></div>
</section>`;
    const { args, applyLocalContentUpdate, reportRefusal } = multiHarness(
      content,
      ["first"],
      {
        activeBreakpointUpperBoundPx: 640,
        rendered: { first: { computedStyles: { position: "absolute" } } },
      },
    );

    expect(runChangeSelectedZIndex(args, "front")).toEqual({
      status: "refused",
      reason: "responsive-scope",
    });
    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(reportRefusal).toHaveBeenCalledWith("responsive-scope");
  });

  it("reorders a linked component root beside an outer sibling", () => {
    const content = `<div data-agent-native-node-id="wrap">
<section data-agent-native-node-id="main" data-agent-native-component-id="card" style="position:absolute"><div data-agent-native-node-id="child"></div></section>
<div data-agent-native-node-id="outer" style="position:absolute"></div>
</div>`;
    const { args, applyLocalContentUpdate, reportRefusal } = multiHarness(
      content,
      ["main"],
      { rendered: { main: { computedStyles: { position: "absolute" } } } },
    );

    const result = runChangeSelectedZIndex(args, "front");

    expect(result).toEqual({ status: "applied" });
    expect(reportRefusal).not.toHaveBeenCalled();
    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    expect(
      directChildNames(applyLocalContentUpdate.mock.calls[0]![0]!, "wrap"),
    ).toEqual(["outer", "main"]);
  });

  it("stops positioned-descendant scans at an intermediate wrapper", () => {
    const content = `<div data-agent-native-node-id="screen">
<div data-agent-native-node-id="target"><div data-agent-native-node-id="wrapper" style="position:relative"><span data-agent-native-node-id="pin" style="position:absolute"></span></div></div>
<div data-agent-native-node-id="sibling"></div>
</div>`;
    const { args, applyLocalContentUpdate } = multiHarness(
      content,
      ["target"],
      {
        rendered: { target: { computedStyles: { position: "static" } } },
      },
    );

    runChangeSelectedZIndex(args, "forward");

    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(args.commitVisualStyles).toHaveBeenCalled();
  });
});
