// @vitest-environment happy-dom

import { createRequire } from "node:module";

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { afterEach, describe, expect, it } from "vitest";

import { availableSizingForElement } from "@/components/design/edit-panel/element-classification";
import type { CanvasPrimitiveInsert } from "@/components/design/multi-screen/types";
import { elementInfoFromCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runCreatePrimitive } from "./create-primitive";
import type { CreatePrimitiveArgs } from "./create-primitive";
import { runLayerMove, type LayerMoveArgs } from "./layer-move";

const requireFromDesign = createRequire(import.meta.url);
const requireFromPlaywright = createRequire(
  requireFromDesign.resolve("@playwright/test"),
);
const { chromium } = requireFromPlaywright("playwright");

const SCREEN_ID = "screen-flow.html";

function file(content: string): DesignFile {
  return {
    id: SCREEN_ID,
    filename: SCREEN_ID,
    fileType: "html",
    content,
    createdAt: "",
    updatedAt: "",
  };
}

function mountPreview(content: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-screen-iframe-id", SCREEN_ID);
  iframe.setAttribute("data-design-preview-iframe", "true");
  document.body.append(iframe);
  writePreview(content);
}

function mountUnreadablePreview(): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-screen-iframe-id", SCREEN_ID);
  iframe.setAttribute("data-design-preview-iframe", "true");
  document.body.append(iframe);
  Object.defineProperty(iframe, "contentDocument", {
    configurable: true,
    value: null,
  });
}

function writePreview(content: string): void {
  const iframe = document.querySelector<HTMLIFrameElement>(
    `[data-screen-iframe-id="${SCREEN_ID}"]`,
  );
  if (!iframe) throw new Error("Preview iframe is missing");
  const preview = iframe.contentDocument!;
  preview.open();
  preview.write(content);
  preview.close();
}

function attemptCreatePrimitive(
  content: string,
  primitive: CanvasPrimitiveInsert,
) {
  const activeFile = file(content);
  let nextContent: string | null = null;
  let localUpdates = 0;
  let contentHistoryEntries = 0;
  let queuedSaves = 0;
  const result = runCreatePrimitive(
    {
      activeFile,
      applyFileContentUpdate: () => {
        contentHistoryEntries += 1;
        queuedSaves += 1;
        return { status: "refused" as const };
      },
      applyLocalContentUpdate: (updated) => {
        localUpdates += 1;
        const prepared = prepareCanonicalSourceContent(updated, {
          fileId: activeFile.id,
          fileType: activeFile.fileType,
        });
        nextContent = prepared.content;
        return {
          status: "accepted" as const,
          content: prepared.content,
          nodeIdMap: prepared.nodeIdMap,
        };
      },
      boardFileId: undefined,
      canvasBackground: "#ffffff",
      canEditDesign: true,
      files: [activeFile],
      getScreenContent: () => content,
      pendingTextCreationHistoryRef: { current: null },
      pendingTextEditNodeIdRef: { current: null },
      runtimeStructureInsertRevisionRef: { current: 0 },
      setRuntimeStructureInsertRequest: () => {},
      t: (key) => key,
      viewModeRef: { current: "single" },
      activeBreakpointWidthState: undefined,
      overviewScreens: [
        {
          id: SCREEN_ID,
          filename: SCREEN_ID,
          content,
          updatedAt: "",
          heightPinned: false,
          breakpointWidths: [],
        },
      ] as unknown as NonNullable<CreatePrimitiveArgs["overviewScreens"]>,
    } satisfies CreatePrimitiveArgs,
    SCREEN_ID,
    primitive,
  );
  return {
    contentHistoryEntries,
    localUpdates,
    nextContent,
    queuedSaves,
    result,
  };
}

function createPrimitive(content: string, primitive: CanvasPrimitiveInsert) {
  const attempt = attemptCreatePrimitive(content, primitive);
  const { nextContent, result } = attempt;
  if (!result || !nextContent) {
    throw new Error("runCreatePrimitive did not persist the primitive");
  }
  return {
    content: nextContent,
    nodeId: primitive.nodeId ?? (typeof result === "string" ? result : ""),
  };
}

function runSameScreenReparent(
  content: string,
  nodeId: string,
  targetId: string,
) {
  const projection = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId: SCREEN_ID },
  });
  const tree = buildCodeLayerTree(projection);
  const owners: LayerMoveArgs["codeLayerOwnerByNodeId"] = new Map();
  for (const node of projection.nodes) {
    owners.set(node.id, {
      fileId: SCREEN_ID,
      node,
      sourceProjection: projection,
      tree,
      runtimeOnly: false,
    });
  }
  const target = projection.nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === targetId,
  );
  const dragged = projection.nodes.find(
    (node) =>
      node.id === nodeId ||
      node.dataAttributes["data-agent-native-node-id"] === nodeId,
  );
  if (!target) throw new Error(`Missing reparent target ${targetId}`);
  if (!dragged) throw new Error(`Missing dragged node ${nodeId}`);
  const moved = new Map<string, string>();
  const activeFile = file(content);
  runLayerMove(
    {
      activeFile,
      applyFileContentUpdate: (id, next) => {
        const prepared = prepareCanonicalSourceContent(next, {
          fileId: id,
          fileType: "html",
        });
        moved.set(id, prepared.content);
        return {
          status: "accepted" as const,
          content: prepared.content,
          nodeIdMap: prepared.nodeIdMap,
        };
      },
      canEditDesign: true,
      canMoveLayer: () => true,
      codeLayerOwnerByNodeId: owners,
      effectiveCodeLayerState: { lockedIds: new Set(), hiddenIds: new Set() },
      files: [activeFile],
      getFreshActiveContent: () => content,
      getScreenContent: () => content,
      handleLayerMoveToScreen: () => {},
      handleScreenLayerMove: () => {},
      recordContentHistoryEntry: () => {},
      recordLocalContentHistoryEntry: () => {},
      remapMotionTracksForClone: () => {},
      runtimeStructureMoveRevisionRef: { current: 0 },
      sendRuntimeLayerMoveSemanticHandoff: () => false,
      setExpandedLayerIds: () => {},
      setRuntimeStructureMoveRequest: () => {},
      setSelectedElement: () => {},
      setSelectedLayerIdsState: () => {},
      t: (key) => key,
      viewModeRef: { current: "single" },
      visualScreenFileIds: new Set(),
      overviewScreens: [
        { id: SCREEN_ID, breakpointWidths: [] },
      ] as unknown as NonNullable<LayerMoveArgs["overviewScreens"]>,
    } satisfies LayerMoveArgs,
    { draggedIds: [dragged.id], targetId: target.id, placement: "inside" },
  );
  const result = moved.get(SCREEN_ID);
  if (!result) throw new Error("runLayerMove did not persist the reparent");
  return result;
}

async function renderedMetrics(
  content: string,
  nodeId: string,
  parentId: string,
) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(content);
    return await page.evaluate(
      ({ nodeId, parentId }: { nodeId: string; parentId: string }) => {
        const element = document.querySelector<HTMLElement>(
          `[data-agent-native-node-id="${nodeId}"]`,
        );
        const parent = document.querySelector<HTMLElement>(
          `[data-agent-native-node-id="${parentId}"]`,
        );
        if (!element || !parent)
          throw new Error("Rendered fixture nodes missing");
        return {
          position: getComputedStyle(element).position,
          parentDisplay: getComputedStyle(parent).display,
          parentHeight: parent.getBoundingClientRect().height,
          inlinePosition: element.style.position,
        };
      },
      { nodeId, parentId },
    );
  } finally {
    await browser.close();
  }
}

const FLOW_SOURCE = `<!doctype html><html><head><style>*{box-sizing:border-box}</style></head><body data-agent-native-node-id="screen-body" style="margin:0;position:relative;display:flex;flex-direction:column;width:800px;height:600px"><section id="metadata" data-agent-native-node-id="metadata" data-agent-native-layer-name="Metadata" data-an-primitive="frame" style="position:absolute;left:420px;top:80px;width:300px;height:fit-content;display:flex;flex-direction:column;gap:4px"></section></body></html>`;

const FREEFORM_SOURCE = `<!doctype html><html><head><style>*{box-sizing:border-box}</style></head><body data-agent-native-node-id="screen-body" style="margin:0;position:relative;display:block;width:800px;height:600px"></body></html>`;

describe("new text creation and same-screen Layers reparent flow", () => {
  afterEach(() => document.body.replaceChildren());

  it("creates in computed flow, retains Fill after reparent, and preserves freeform/ignored positioning", async () => {
    mountPreview(FLOW_SOURCE);
    const created = createPrimitive(FLOW_SOURCE, {
      kind: "text",
      nodeId: "new-flow-title",
      geometry: { x: 24, y: 24, width: 180, height: 40, rotation: 0 },
      text: "New title",
      autoSize: true,
    });
    writePreview(created.content);
    let projection = buildCodeLayerProjection(created.content, {
      source: { kind: "design-file", fileId: SCREEN_ID },
    });
    const newText = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === created.nodeId,
    );
    expect(newText).toBeTruthy();
    expect(newText?.style.position).not.toBe("absolute");

    const afterMove = runSameScreenReparent(
      created.content,
      newText!.id,
      "metadata",
    );
    const rendered = await renderedMetrics(
      afterMove,
      created.nodeId,
      "metadata",
    );
    expect(rendered.position).not.toBe("absolute");
    expect(rendered.parentDisplay).toBe("flex");
    expect(rendered.parentHeight).toBeGreaterThan(0);

    projection = buildCodeLayerProjection(afterMove, {
      source: { kind: "design-file", fileId: SCREEN_ID },
    });
    const movedText = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === created.nodeId,
    )!;
    const elementInfo = elementInfoFromCodeLayerNode(movedText);
    elementInfo.computedStyles.position = rendered.position;
    elementInfo.inlineStyles = {
      ...elementInfo.inlineStyles,
      position: rendered.inlinePosition,
    };
    expect(availableSizingForElement(elementInfo).horizontal).toContain("fill");

    writePreview(afterMove);
    const createdPolygon = createPrimitive(afterMove, {
      kind: "polygon",
      nodeId: "new-flow-polygon",
      geometry: { x: 24, y: 120, width: 80, height: 50, rotation: 0 },
      fill: "#4f46e5",
    });
    writePreview(createdPolygon.content);
    const polygonProjection = buildCodeLayerProjection(createdPolygon.content, {
      source: { kind: "design-file", fileId: SCREEN_ID },
    });
    const polygon = polygonProjection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] ===
        createdPolygon.nodeId,
    );
    expect(polygon?.tag).toBe("svg");
    expect(polygon?.style.position).not.toBe("absolute");
    const polygonAfterMove = runSameScreenReparent(
      createdPolygon.content,
      polygon!.id,
      "metadata",
    );
    const polygonRendered = await renderedMetrics(
      polygonAfterMove,
      createdPolygon.nodeId,
      "metadata",
    );
    expect(polygonRendered.position).not.toBe("absolute");

    writePreview(FREEFORM_SOURCE);
    const freeform = createPrimitive(FREEFORM_SOURCE, {
      kind: "text",
      nodeId: "new-freeform-title",
      geometry: { x: 24, y: 24, width: 180, height: 40, rotation: 0 },
      text: "Freeform title",
      autoSize: true,
    });
    const freeformRendered = await renderedMetrics(
      freeform.content,
      "new-freeform-title",
      "screen-body",
    );
    expect(freeformRendered.position).toBe("absolute");

    const ignoredSource = `<!doctype html><html><body style="margin:0;display:flex;flex-direction:column;width:800px;height:600px"><section data-agent-native-node-id="source" data-an-primitive="frame" style="position:relative;width:300px;height:160px;display:flex;flex-direction:column"><div data-agent-native-node-id="authored-ignored" data-an-primitive="text" style="position:absolute;left:12px;top:8px;width:max-content;height:auto">Ignored title</div></section><section data-agent-native-node-id="metadata" data-an-primitive="frame" style="position:relative;width:300px;height:fit-content;display:flex;flex-direction:column"></section></body></html>`;
    writePreview(ignoredSource);
    const ignoredAfterMove = runSameScreenReparent(
      ignoredSource,
      "authored-ignored",
      "metadata",
    );
    const ignoredRendered = await renderedMetrics(
      ignoredAfterMove,
      "authored-ignored",
      "metadata",
    );
    expect(ignoredRendered.position).toBe("absolute");
  });
});

describe("creation flow-preview proof guards", () => {
  afterEach(() => document.body.replaceChildren());

  const primitive = (
    nodeId: string,
    x = 24,
    y = 24,
  ): CanvasPrimitiveInsert => ({
    kind: "text",
    nodeId,
    geometry: { x, y, width: 180, height: 40, rotation: 0 },
    text: "Guarded title",
    autoSize: true,
  });

  function expectRefusedWithoutPersistence(
    attempt: ReturnType<typeof attemptCreatePrimitive>,
  ): void {
    expect(attempt.result).toBe(false);
    expect(attempt.nextContent).toBeNull();
    expect(attempt.localUpdates).toBe(0);
    expect(attempt.contentHistoryEntries).toBe(0);
    expect(attempt.queuedSaves).toBe(0);
  }

  it("refuses a mounted iframe with an unreadable document", () => {
    mountUnreadablePreview();
    expectRefusedWithoutPersistence(
      attemptCreatePrimitive(FLOW_SOURCE, primitive("stale-preview-title")),
    );
  });

  it("refuses an ambiguous exact authored frame host", () => {
    const ambiguousSource = `<!doctype html><html><body style="margin:0;display:flex;width:800px;height:600px"><section data-agent-native-node-id="duplicate-host" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:300px;display:flex"></section><section data-agent-native-node-id="duplicate-host" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:300px;display:flex"></section></body></html>`;
    mountPreview(ambiguousSource);
    expectRefusedWithoutPersistence(
      attemptCreatePrimitive(
        ambiguousSource,
        primitive("ambiguous-host-title", 24, 24),
      ),
    );
  });

  it("refuses when the mounted preview no longer contains the source host", () => {
    const source = `<!doctype html><html><body style="margin:0;display:flex;width:800px;height:600px"><section data-agent-native-node-id="source-host" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:300px;display:flex"></section></body></html>`;
    const stalePreview = `<!doctype html><html><body style="margin:0;display:flex;width:800px;height:600px"><section data-agent-native-node-id="different-host" data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:300px;display:flex"></section></body></html>`;
    mountPreview(stalePreview);
    expectRefusedWithoutPersistence(
      attemptCreatePrimitive(source, primitive("missing-host-title", 24, 24)),
    );
  });

  it("refuses a mounted nested frame host without an authored identity", () => {
    const source = `<!doctype html><html><body style="margin:0;display:flex;width:800px;height:600px"><section data-an-primitive="frame" style="position:absolute;left:0;top:0;width:300px;height:300px;display:flex"></section></body></html>`;
    mountPreview(source);
    expectRefusedWithoutPersistence(
      attemptCreatePrimitive(
        source,
        primitive("unidentified-host-title", 24, 24),
      ),
    );
  });

  it("keeps absolute creation as the fallback when no preview iframe is mounted", async () => {
    const created = createPrimitive(
      FLOW_SOURCE,
      primitive("unmounted-preview-title"),
    );
    const rendered = await renderedMetrics(
      created.content,
      created.nodeId,
      "screen-body",
    );
    expect(rendered.position).toBe("absolute");
  });
});
