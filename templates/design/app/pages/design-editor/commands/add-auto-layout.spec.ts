import {
  buildCodeLayerProjection,
  type CodeLayerNode,
} from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError }),
}));

import type { FrameMeasurement } from "@/pages/design-editor/measure-child-rects";

import { runAddAutoLayout, type AddAutoLayoutArgs } from "./add-auto-layout";

const SOURCE = { kind: "design-file" as const, fileId: "screen" };

const px = (value: string | undefined) => Number.parseFloat(value ?? "") || 0;

// Stands in for the live preview: every box renders where its inline px say.
function measureFromStyles(
  projection: ReturnType<typeof buildCodeLayerProjection>,
) {
  return (node: CodeLayerNode): FrameMeasurement => ({
    status: "measured",
    display: node.style.display ?? "block",
    boxSizing: node.style["box-sizing"] ?? "content-box",
    size: { width: px(node.style.width), height: px(node.style.height) },
    paddingBox: { width: px(node.style.width), height: px(node.style.height) },
    children: node.children.map((childId) => {
      const child = projection.nodes.find(
        (candidate) => candidate.id === childId,
      )!;
      return {
        id: child.dataAttributes["data-agent-native-node-id"]!,
        rect: {
          x: px(child.style.left),
          y: px(child.style.top),
          width: px(child.style.width),
          height: px(child.style.height),
        },
        position: child.style.position ?? "static",
        transformed: false,
        box: { sizing: "content-box", edges: { width: 0, height: 0 } },
      };
    }),
    unidentifiedChildren: 0,
  });
}

function addAutoLayout(
  content: string,
  selectedIds: string | string[],
  options: {
    measure?: (node: CodeLayerNode) => FrameMeasurement;
    measureSelection?: AddAutoLayoutArgs["measureSelection"];
  } = {},
): string {
  const projection = buildCodeLayerProjection(content, { source: SOURCE });
  const selected = [selectedIds]
    .flat()
    .map(
      (selectedId) =>
        projection.nodes.find(
          (node) =>
            node.dataAttributes["data-agent-native-node-id"] === selectedId,
        )!.id,
    );
  let published = "";
  runAddAutoLayout({
    activeFile: { id: "screen" },
    applyFileContentUpdate: vi.fn(),
    applyLocalContentUpdate: (next: string) => {
      published = next;
      return { status: "accepted", content: next, nodeIdMap: new Map() };
    },
    canEditDesign: true,
    collectSizeHints: () => ({ hints: {}, unmeasured: [] }),
    codeLayerOwnerByNodeIdRef: { current: new Map() },
    designSourceType: "inline",
    effectiveCodeLayerStateRef: {
      current: { lockedIds: new Set(), hiddenIds: new Set() },
    },
    files: [],
    getActiveFileSelectedNodeIds: () => selected,
    getFreshActiveContent: () => content,
    getScreenContent: () => content,
    measureLayoutFrame: options.measure ?? measureFromStyles(projection),
    measureSelection:
      options.measureSelection ??
      (() => ({ status: "unmeasurable", nodeId: "", reason: "no-preview" })),
    overviewScreens: [],
    overviewSelectedScreenIds: [],
    runtimeLayerSnapshotsById: {},
    selectedElement: null,
    selectedLayerIdsState: selected,
    sendRuntimeLayerSemanticHandoff: () => false,
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    t: (key: string) => key,
    viewModeRef: { current: "single" },
  } as unknown as AddAutoLayoutArgs);
  return published;
}

const styleOf = (content: string, id: string) =>
  new RegExp(`data-agent-native-node-id="${id}"[^>]*style="([^"]*)"`).exec(
    content,
  )?.[1] ?? "";

describe("runAddAutoLayout on a freeform container", () => {
  // The card sits away from its parent's origin, so any mix of
  // parent-relative and container-relative rects shows up as wrong padding.
  const CARD = `<body><div data-agent-native-node-id="card" data-an-primitive="frame" style="position:absolute;left:400px;top:300px;width:200px;height:136px">
<div data-agent-native-node-id="second" style="position:absolute;left:16px;top:76px;width:168px;height:44px"></div>
<div data-agent-native-node-id="first" data-an-primitive="frame" style="position:absolute;left:16px;top:16px;width:168px;height:44px"></div>
</div></body>`;

  it("flows children in their on-canvas order", () => {
    const next = addAutoLayout(CARD, "card");
    expect(next).not.toBe("");
    expect(next.indexOf('node-id="first"')).toBeGreaterThan(-1);
    expect(next.indexOf('node-id="first"')).toBeLessThan(
      next.indexOf('node-id="second"'),
    );
  });

  it("infers padding from the container's own box", () => {
    const card = styleOf(addAutoLayout(CARD, "card"), "card");
    expect(card).toMatch(/padding:\s*16px 16px 16px 16px/);
    expect(card).toMatch(/gap:\s*16px/);
  });

  it("keeps the card's rendered size by giving the inferred padding back out of its content-box width and height", () => {
    const card = styleOf(addAutoLayout(CARD, "card"), "card");
    expect(card).toMatch(/width:\s*168px/);
    expect(card).toMatch(/height:\s*104px/);
  });

  it("never pins frame children with position: static !important", () => {
    const next = addAutoLayout(CARD, "card");
    expect(next).not.toMatch(/position:\s*static\s*!important/);
    expect(styleOf(next, "first")).not.toMatch(/position:\s*absolute/);
    expect(styleOf(next, "second")).not.toMatch(/position:\s*absolute/);
  });

  it("refuses visibly instead of guessing when the card cannot be measured", () => {
    toastError.mockClear();
    const next = addAutoLayout(CARD, "card", {
      measure: (node) => ({
        status: "unmeasurable",
        nodeId: node.id,
        reason: "not-found",
      }),
    });
    expect(next).toBe("");
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.toasts.layoutUnmeasurable",
      expect.anything(),
    );
  });
});

describe("runAddAutoLayout on a multi-layer selection", () => {
  const SIBLINGS = `<body><div data-agent-native-node-id="b" style="position:absolute;left:120px;top:10px;width:40px;height:40px"></div><div data-agent-native-node-id="a" style="position:absolute;left:10px;top:10px;width:40px;height:40px"></div></body>`;

  it("refuses visibly when a selected layer cannot be measured", () => {
    toastError.mockClear();
    expect(addAutoLayout(SIBLINGS, ["a", "b"])).toBe("");
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.toasts.layoutUnmeasurable",
      expect.anything(),
    );
  });

  it("flows the wrapper along the measured arrangement, in on-canvas order", () => {
    const rectOf: Record<string, { x: number; y: number }> = {
      a: { x: 10, y: 10 },
      b: { x: 120, y: 10 },
    };
    const next = addAutoLayout(SIBLINGS, ["b", "a"], {
      measureSelection: (nodes) =>
        ({
          status: "measured",
          nodes: nodes.map((node) => ({
            id: node.id,
            rect: {
              ...rectOf[node.dataAttributes["data-agent-native-node-id"]!]!,
              width: 40,
              height: 40,
            },
          })),
        }) as never,
    });
    expect(next).toMatch(/flex-direction:\s*row/);
    expect(next).toMatch(/gap:\s*70px/);
    expect(next.indexOf('node-id="a"')).toBeLessThan(
      next.indexOf('node-id="b"'),
    );
  });
});
