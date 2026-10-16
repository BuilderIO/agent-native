import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import type { CanvasLayerMarqueeSelection } from "@/components/design/multi-screen/types";
import type { ElementInfo } from "@/components/design/types";

import {
  runLayerMarqueeSelectionChange,
  type LayerMarqueeSelectionChangeArgs,
} from "./layer-marquee-selection-change";

function elementInfo(sourceId: string, tagName: string): ElementInfo {
  return {
    tagName,
    sourceId,
    selector: `[data-agent-native-node-id="${sourceId}"]`,
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 40, height: 30 },
    isFlexChild: false,
    isFlexContainer: false,
  };
}

function runMarqueeSelection(
  selection: CanvasLayerMarqueeSelection[],
  metaKey: boolean,
) {
  const projection = buildCodeLayerProjection(
    '<main data-agent-native-node-id="card"><section data-agent-native-node-id="kid-a">Kid A</section><section data-agent-native-node-id="kid-b">Kid B</section></main>',
    {
      source: {
        kind: "design-file",
        fileId: "screen-a",
        filename: "screen-a.html",
      },
    },
  );
  let selectedLayerIds: string[] = [];
  const setSelectedLayerIdsState = vi.fn<
    LayerMarqueeSelectionChangeArgs["setSelectedLayerIdsState"]
  >((update) => {
    selectedLayerIds =
      typeof update === "function" ? update(selectedLayerIds) : update;
  });
  const args: LayerMarqueeSelectionChangeArgs = {
    clearPendingOverviewLayerSelectionTimer: vi.fn(),
    getCodeLayerProjectionForScreen: vi.fn(() => projection),
    hasActiveSelectionRef: { current: false },
    lastMarqueeSelectionSignatureRef: { current: null },
    pendingOverviewLayerSelectionRef: { current: null },
    pendingOverviewScreenSelectionRef: { current: null },
    setActiveFileId: vi.fn(),
    setActiveTool: vi.fn(),
    setCreatedOverviewLayerSelection: vi.fn(),
    setMode: vi.fn(),
    setOverviewClearSelectionRequest: vi.fn(),
    setOverviewSelectedScreenIds: vi.fn(),
    setSelectedElement: vi.fn(),
    setSelectedLayerIdsState,
    viewModeRef: { current: "overview" },
  };

  runLayerMarqueeSelectionChange(args, selection, {
    source: "marquee",
    final: true,
    metaKey,
    ctrlKey: false,
    shiftKey: false,
    additive: false,
  });

  return { projection, selectedLayerIds };
}

describe("runLayerMarqueeSelectionChange", () => {
  it("replaces an intermediate ancestor hit during a Cmd deep marquee", () => {
    const projection = buildCodeLayerProjection(
      '<main data-agent-native-node-id="card"><section data-agent-native-node-id="kid-a">Kid A</section><section data-agent-native-node-id="kid-b">Kid B</section></main>',
      {
        source: {
          kind: "design-file",
          fileId: "screen-a",
          filename: "screen-a.html",
        },
      },
    );
    let selectedLayerIds: string[] = [];
    const args: LayerMarqueeSelectionChangeArgs = {
      clearPendingOverviewLayerSelectionTimer: vi.fn(),
      getCodeLayerProjectionForScreen: vi.fn(() => projection),
      hasActiveSelectionRef: { current: false },
      lastMarqueeSelectionSignatureRef: { current: null },
      pendingOverviewLayerSelectionRef: { current: null },
      pendingOverviewScreenSelectionRef: { current: null },
      setActiveFileId: vi.fn(),
      setActiveTool: vi.fn(),
      setCreatedOverviewLayerSelection: vi.fn(),
      setMode: vi.fn(),
      setOverviewClearSelectionRequest: vi.fn(),
      setOverviewSelectedScreenIds: vi.fn(),
      setSelectedElement: vi.fn(),
      setSelectedLayerIdsState: (update) => {
        selectedLayerIds =
          typeof update === "function" ? update(selectedLayerIds) : update;
      },
      viewModeRef: { current: "overview" },
    };
    const card = elementInfo("card", "main");
    const kidA = elementInfo("kid-a", "section");
    const kidB = elementInfo("kid-b", "section");
    const bridgeIntent = {
      source: "marquee" as const,
      additive: true,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      final: false,
    };

    runLayerMarqueeSelectionChange(
      args,
      [{ screenId: "screen-a", info: card }],
      bridgeIntent,
    );
    runLayerMarqueeSelectionChange(
      args,
      [
        { screenId: "screen-a", info: card },
        { screenId: "screen-a", info: kidA },
        { screenId: "screen-a", info: kidB },
      ],
      { ...bridgeIntent, final: true },
    );

    const expectedIds = projection.nodes
      .filter((node) =>
        ["kid-a", "kid-b"].includes(
          node.dataAttributes["data-agent-native-node-id"],
        ),
      )
      .map((node) => node.id);
    expect(new Set(selectedLayerIds)).toEqual(new Set(expectedIds));
  });

  it("deep-selects intersected descendants without also selecting their hit ancestor", () => {
    const result = runMarqueeSelection(
      [
        { screenId: "screen-a", info: elementInfo("card", "main") },
        { screenId: "screen-a", info: elementInfo("kid-a", "section") },
        { screenId: "screen-a", info: elementInfo("kid-b", "section") },
      ],
      true,
    );

    const expectedIds = result.projection.nodes
      .filter((node) =>
        ["kid-a", "kid-b"].includes(
          node.dataAttributes["data-agent-native-node-id"],
        ),
      )
      .map((node) => node.id);
    expect(result.selectedLayerIds).toEqual(expectedIds);
  });

  it("retains a hit container when no hit descendant is selected", () => {
    const result = runMarqueeSelection(
      [{ screenId: "screen-a", info: elementInfo("card", "main") }],
      true,
    );
    const expectedCardId = result.projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "card",
    )?.id;

    expect(expectedCardId).toBeDefined();
    expect(result.selectedLayerIds).toEqual([expectedCardId]);
  });

  it("retains overlapping sibling hits in a deep marquee", () => {
    const result = runMarqueeSelection(
      [
        { screenId: "screen-a", info: elementInfo("kid-a", "section") },
        { screenId: "screen-a", info: elementInfo("kid-b", "section") },
      ],
      true,
    );
    const expectedIds = result.projection.nodes
      .filter((node) =>
        ["kid-a", "kid-b"].includes(
          node.dataAttributes["data-agent-native-node-id"],
        ),
      )
      .map((node) => node.id);

    expect(result.selectedLayerIds).toEqual(expectedIds);
  });

  it("does not change ordinary marquee hits", () => {
    const result = runMarqueeSelection(
      [
        { screenId: "screen-a", info: elementInfo("card", "main") },
        { screenId: "screen-a", info: elementInfo("kid-a", "section") },
      ],
      false,
    );
    const expectedIds = result.projection.nodes
      .filter((node) =>
        ["card", "kid-a"].includes(
          node.dataAttributes["data-agent-native-node-id"],
        ),
      )
      .map((node) => node.id);

    expect(result.selectedLayerIds).toEqual(expectedIds);
  });
});
