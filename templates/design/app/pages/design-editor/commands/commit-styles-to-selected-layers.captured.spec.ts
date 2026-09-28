import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import {
  elementInfoFromCodeLayerNode,
  type SelectedLayerTarget,
} from "@/pages/design-editor/code-layer-state";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import {
  runCommitStylesToSelectedLayers,
  type CapturedStyleTargetCommitOptions,
  type CommitStylesToSelectedLayersArgs,
} from "./commit-styles-to-selected-layers";

function htmlFor(...ids: string[]) {
  return `<body>${ids
    .map(
      (id) =>
        `<div data-agent-native-node-id="${id}" style="color:red">${id}</div>`,
    )
    .join("")}</body>`;
}

function acceptFixture(fileId: string, content: string) {
  const prepared = prepareCanonicalSourceContent(content, {
    fileId,
    fileType: "html",
  });
  return {
    status: "accepted" as const,
    content: prepared.content,
    nodeIdMap: prepared.nodeIdMap,
  };
}

function targetsFor(
  content: string,
  fileId: string,
  ids: string[],
): SelectedLayerTarget[] {
  const source = { kind: "design-file" as const, fileId };
  const projection = buildCodeLayerProjection(content, { source });
  const tree = buildCodeLayerTree(projection);
  return ids.map((id) => {
    const node = projection.nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === id,
    );
    if (!node) throw new Error(`Missing fixture layer ${id}`);
    return {
      layerId: node.id,
      fileId,
      node,
      tree,
      elementInfo: elementInfoFromCodeLayerNode(node),
    };
  });
}

function makeHarness(args: {
  files: Record<string, string>;
  activeFileId: string;
  selectedTargets: SelectedLayerTarget[];
}) {
  const { files, activeFileId, selectedTargets } = args;
  const activeContent = files[activeFileId];
  if (!activeContent) throw new Error(`Missing active file ${activeFileId}`);
  const activeFile: DesignFile = {
    id: activeFileId,
    filename: `${activeFileId}.html`,
    fileType: "html",
    content: activeContent,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const updates: Array<{ fileId: string; content: string }> = [];
  const selectedElementUpdates: Array<unknown> = [];
  let selectedElement: ElementInfo | null =
    selectedTargets.length > 0
      ? selectedTargets[selectedTargets.length - 1]!.elementInfo
      : null;
  const setSelectedElement: CommitStylesToSelectedLayersArgs["setSelectedElement"] =
    (update) => {
      selectedElementUpdates.push(update);
      selectedElement =
        typeof update === "function" ? update(selectedElement) : update;
    };

  const commandArgs: CommitStylesToSelectedLayersArgs = {
    activeBreakpointUpperBoundPx: 1200,
    activeBreakpointWidthStateRef: { current: 480 },
    activeContent,
    activeFile,
    applyFileContentUpdate: (fileId, content) => {
      const publication = acceptFixture(fileId, content);
      updates.push({ fileId, content: publication.content });
      return publication;
    },
    canEditDesign: true,
    effectiveCodeLayerStateRef: {
      current: { lockedIds: new Set(), hiddenIds: new Set() },
    },
    getScreenContent: (fileId) => files[fileId] ?? "",
    lastLocalContentRef: { current: null },
    latestActiveContentRef: { current: null },
    responsiveEditScopeRef: { current: "cascade-smaller" },
    selectedLayerTargetsRef: { current: selectedTargets },
    selectedLayerIdsStateRef: {
      current: selectedTargets.map((target) => target.layerId),
    },
    setSelectedElement,
  };

  return {
    args: commandArgs,
    updates,
    selectedElementUpdates,
    get selectedElement() {
      return selectedElement;
    },
  };
}

function capturedOptions(
  targets: SelectedLayerTarget[],
  options: Partial<
    Omit<CapturedStyleTargetCommitOptions, "capturedTargetIds">
  > = {},
): CapturedStyleTargetCommitOptions {
  return {
    capturedTargetIds: targets.map((target) => target.layerId),
    scope: { upperBoundPx: null, lowerBoundPx: null },
    ...options,
  };
}

function styleValue(content: string, fileId: string, id: string) {
  const source = { kind: "design-file" as const, fileId };
  const node = buildCodeLayerProjection(content, { source }).nodes.find(
    (candidate) => candidate.dataAttributes["data-agent-native-node-id"] === id,
  );
  return node?.style.color;
}

describe("runCommitStylesToSelectedLayers captured targets", () => {
  it("writes the captured layer after selection changes and keeps the new selection", () => {
    const files = {
      screenA: htmlFor("a"),
      screenB: htmlFor("b", "c"),
    };
    const [capturedA] = targetsFor(files.screenA, "screenA", ["a"]);
    const selectedBC = targetsFor(files.screenB, "screenB", ["c", "b"]);
    if (!capturedA) throw new Error("Missing captured target");
    const harness = makeHarness({
      files,
      activeFileId: "screenB",
      selectedTargets: selectedBC,
    });

    const applied = runCommitStylesToSelectedLayers(
      harness.args,
      { color: "#123456" },
      [capturedA],
      capturedOptions([capturedA], {
        interactionState: "hover",
        scope: { upperBoundPx: 600, lowerBoundPx: 400 },
      }),
    );

    expect(applied).toBe(true);
    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0]?.fileId).toBe("screenA");
    expect(harness.updates[0]?.content).toContain(
      '[data-agent-native-node-id="a"]:hover',
    );
    expect(harness.updates[0]?.content).toContain("max-width: 600px");
    expect(styleValue(harness.updates[0]!.content, "screenA", "a")).toBe("red");
    expect(harness.selectedElementUpdates).toHaveLength(0);
    expect(harness.selectedElement?.sourceId).toBe("b");
  });

  it("writes all captured targets in their original exact breakpoint scope", () => {
    const files = {
      screenA: htmlFor("a"),
      screenB: htmlFor("b"),
      screenC: htmlFor("c"),
    };
    const [capturedA] = targetsFor(files.screenA, "screenA", ["a"]);
    const selectedB = targetsFor(files.screenB, "screenB", ["b"]);
    const [capturedC] = targetsFor(files.screenC, "screenC", ["c"]);
    if (!capturedA || !capturedC) throw new Error("Missing captured target");
    const capturedTargets = [capturedA, capturedC];
    const harness = makeHarness({
      files,
      activeFileId: "screenB",
      selectedTargets: selectedB,
    });

    const applied = runCommitStylesToSelectedLayers(
      harness.args,
      { color: "#123456" },
      capturedTargets,
      capturedOptions(capturedTargets, {
        scope: { upperBoundPx: 900, lowerBoundPx: 600 },
      }),
    );

    expect(applied).toBe(true);
    expect(harness.updates.map((update) => update.fileId)).toEqual([
      "screenA",
      "screenC",
    ]);
    for (const update of harness.updates) {
      expect(update.content).toContain(
        "@media (min-width: 600px) and (max-width: 900px)",
      );
      expect(update.content).toContain("color: #123456;");
    }
    expect(harness.selectedElementUpdates).toHaveLength(0);
    expect(harness.selectedElement?.sourceId).toBe("b");
  });

  it("refuses the whole commit when a captured target no longer resolves", () => {
    const capturedSource = htmlFor("a", "c");
    const files = {
      screenA: htmlFor("a"),
      screenB: htmlFor("b"),
    };
    const capturedTargets = targetsFor(capturedSource, "screenA", ["a", "c"]);
    const selectedB = targetsFor(files.screenB, "screenB", ["b"]);
    const harness = makeHarness({
      files,
      activeFileId: "screenB",
      selectedTargets: selectedB,
    });

    const applied = runCommitStylesToSelectedLayers(
      harness.args,
      { color: "#123456" },
      capturedTargets,
      capturedOptions(capturedTargets),
    );

    expect(applied).toBe(false);
    expect(harness.updates).toHaveLength(0);
    expect(harness.selectedElementUpdates).toHaveLength(0);
    expect(harness.selectedElement?.sourceId).toBe("b");
  });

  it("refreshes the inspector when the captured target remains selected", () => {
    const screenA = htmlFor("a");
    const [capturedA] = targetsFor(screenA, "screenA", ["a"]);
    if (!capturedA) throw new Error("Missing captured target");
    const harness = makeHarness({
      files: { screenA },
      activeFileId: "screenA",
      selectedTargets: [capturedA],
    });

    const applied = runCommitStylesToSelectedLayers(
      harness.args,
      { color: "#123456" },
      [capturedA],
      capturedOptions([capturedA]),
    );

    expect(applied).toBe(true);
    expect(harness.selectedElementUpdates).toHaveLength(1);
    expect(harness.selectedElement?.computedStyles.color).toBe("#123456");
  });
});
