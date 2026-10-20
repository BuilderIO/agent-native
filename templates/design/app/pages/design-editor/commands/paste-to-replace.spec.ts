// @vitest-environment happy-dom

import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import type { PortableStyleSnapshot } from "@/components/design/types";

import { buildCodeLayerProjection } from "../../../../shared/code-layer";
import type { DesignFile } from "../types";
import { runPasteToReplace } from "./paste-to-replace";

const CONTENT_WITH_IDS = `<!DOCTYPE html><html><body><div data-agent-native-node-id="parent" style="position:absolute;left:100px;top:100px;width:600px;height:400px"><div data-agent-native-node-id="target" style="position:absolute;left:300px;top:40px;width:200px;height:100px"></div></div></body></html>`;

const CONTENT_WITHOUT_TARGET_ID = CONTENT_WITH_IDS.replace(
  ' data-agent-native-node-id="target"',
  ' data-agent-native-layer-name="Target"',
);

describe("runPasteToReplace with pasted OS content", () => {
  it.each([
    ["an id", CONTENT_WITH_IDS],
    ["no id", CONTENT_WITHOUT_TARGET_ID],
  ])(
    "puts the pasted layer at the target's top-left in its parent (target with %s)",
    (_label, CONTENT) => {
      const target = buildCodeLayerProjection(CONTENT, {
        source: { kind: "design-file", fileId: "screen-1" },
      }).nodes.find((node) => node.style.top === "40px")!;
      const applyLocalContentUpdate = vi.fn();

      runPasteToReplace(
        {
          activeFile: { id: "screen-1", content: CONTENT } as DesignFile,
          applyLocalContentUpdate,
          canEditDesign: true,
          getCanvasClipboardEntries: () => [],
          getFreshActiveContent: () => CONTENT,
          runtimeStructureInsertRevisionRef: { current: 0 },
          selectInsertedLayers: vi.fn(),
          selectedCanvasSelector: target.selectors[0]!,
          selectedElement: {
            tagName: "div",
            selector: target.selectors[0]!,
            classes: [],
            computedStyles: {},
            boundingRect: { x: 400, y: 140, width: 200, height: 100 },
            isFlexChild: false,
            isFlexContainer: false,
          },
          setRuntimeStructureInsertRequest: vi.fn(),
          t: (key) => key,
        },
        '<div data-agent-native-node-id="pasted" data-agent-native-layer-name="Frame" style="position:absolute;width:24px;height:24px"></div>',
      );

      const doc = new DOMParser().parseFromString(
        applyLocalContentUpdate.mock.calls[0]![0] as string,
        "text/html",
      );
      expect(doc.querySelectorAll('[style*="height:100px"]')).toHaveLength(0);
      const pasted = doc.querySelector<HTMLElement>(
        '[data-agent-native-layer-name="Frame"]',
      )!;
      expect(pasted.parentElement?.dataset.agentNativeNodeId).toBe("parent");
      expect([pasted.style.left, pasted.style.top, pasted.style.width]).toEqual(
        ["300px", "40px", "24px"],
      );
    },
  );

  it("uses measured clone bounds for stylesheet-sized paste replacement", () => {
    const target = buildCodeLayerProjection(CONTENT_WITH_IDS, {
      source: { kind: "design-file", fileId: "screen-1" },
    }).nodes.find((node) => node.style.top === "40px")!;
    const applyLocalContentUpdate = vi.fn();
    const getPreparedCloneVisualOffset = vi.fn(() => ({ x: 13, y: 17 }));
    const layerHtml =
      '<div class="responsive-card" data-agent-native-layer-name="Frame" style="position:absolute;width:auto;height:auto;margin-left:13px;margin-top:17px;transform:scale(1.2);transform-origin:top">Frame</div>';

    runPasteToReplace(
      {
        activeFile: { id: "screen-1", content: CONTENT_WITH_IDS } as DesignFile,
        applyLocalContentUpdate,
        canEditDesign: true,
        getCanvasClipboardEntries: () => [],
        getFreshActiveContent: () => CONTENT_WITH_IDS,
        getRenderedElementInfoForSelector: () => ({
          tagName: "div",
          selector: target.selectors[0]!,
          classes: [],
          computedStyles: {},
          boundingRect: { x: 400, y: 140, width: 200, height: 100 },
          absoluteSiblingVisualOrigin: { x: 300, y: 40 },
          isFlexChild: false,
          isFlexContainer: false,
        }),
        getPreparedCloneVisualOffset,
        runtimeStructureInsertRevisionRef: { current: 0 },
        selectInsertedLayers: vi.fn(),
        selectedCanvasSelector: target.selectors[0]!,
        selectedElement: {
          tagName: "div",
          selector: target.selectors[0]!,
          classes: [],
          computedStyles: {},
          boundingRect: { x: 400, y: 140, width: 200, height: 100 },
          isFlexChild: false,
          isFlexContainer: false,
        },
        setRuntimeStructureInsertRequest: vi.fn(),
        t: (key) => key,
      },
      layerHtml,
    );

    expect(getPreparedCloneVisualOffset).toHaveBeenCalledWith(
      target.selectors[0],
      layerHtml,
      undefined,
      undefined,
      undefined,
    );
    const next = applyLocalContentUpdate.mock.calls[0]![0] as string;
    const doc = new DOMParser().parseFromString(next, "text/html");
    const replacement = doc.querySelector<HTMLElement>(
      '[data-agent-native-layer-name="Frame"]',
    )!;
    expect([replacement.style.left, replacement.style.top]).toEqual([
      "287px",
      "23px",
    ]);
    expect([replacement.style.width, replacement.style.height]).toEqual([
      "auto",
      "auto",
    ]);
    expect([replacement.style.marginLeft, replacement.style.marginTop]).toEqual(
      ["13px", "17px"],
    );
    expect(replacement.style.transformOrigin).toBe("top");
    expect(
      doc.querySelector('[data-agent-native-node-id="target"]'),
    ).toBeNull();
  });

  it("uses the measured same-file root snapshot while preserving descendant styles", () => {
    const target = buildCodeLayerProjection(CONTENT_WITH_IDS, {
      source: { kind: "design-file", fileId: "screen-1" },
    }).nodes.find((node) => node.style.top === "40px")!;
    const applyLocalContentUpdate = vi.fn();
    const layerHtml =
      '<div class="authored-card" data-agent-native-layer-name="Frame"><span>Child</span></div>';
    const sourceSnapshot: PortableStyleSnapshot = {
      version: 1 as const,
      nodes: [
        { path: [], styles: { color: "rgb(12, 34, 56)" } },
        { path: [0], styles: { fontWeight: "700" } },
      ],
    };
    const prunedSnapshot: PortableStyleSnapshot = {
      version: 1 as const,
      nodes: [
        { path: [], styles: {} },
        { path: [0], styles: { fontWeight: "700" } },
      ],
    };
    const getPreparedCloneVisualOffset = vi.fn(() => ({
      x: 13,
      y: 17,
      styleSnapshot: prunedSnapshot,
    }));

    runPasteToReplace({
      activeFile: { id: "screen-1", content: CONTENT_WITH_IDS } as DesignFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      getCanvasClipboardEntries: () => [
        {
          html: layerHtml,
          sourceFileId: "screen-1",
          portableStyleSnapshot: sourceSnapshot,
        },
      ],
      getFreshActiveContent: () => CONTENT_WITH_IDS,
      getRenderedElementInfoForSelector: () => ({
        tagName: "div",
        selector: target.selectors[0]!,
        classes: [],
        computedStyles: {},
        boundingRect: { x: 400, y: 140, width: 200, height: 100 },
        absoluteSiblingVisualOrigin: { x: 300, y: 40 },
        isFlexChild: false,
        isFlexContainer: false,
      }),
      getPreparedCloneVisualOffset,
      runtimeStructureInsertRevisionRef: { current: 0 },
      selectInsertedLayers: vi.fn(),
      selectedCanvasSelector: target.selectors[0]!,
      selectedElement: {
        tagName: "div",
        selector: target.selectors[0]!,
        classes: [],
        computedStyles: {},
        boundingRect: { x: 400, y: 140, width: 200, height: 100 },
        isFlexChild: false,
        isFlexContainer: false,
      },
      setRuntimeStructureInsertRequest: vi.fn(),
      t: (key) => key,
    });

    expect(getPreparedCloneVisualOffset).toHaveBeenCalledWith(
      target.selectors[0],
      layerHtml,
      sourceSnapshot,
      undefined,
      "screen-1",
    );
    const next = applyLocalContentUpdate.mock.calls[0]![0] as string;
    const doc = new DOMParser().parseFromString(next, "text/html");
    const replacement = doc.querySelector<HTMLElement>(
      '[data-agent-native-layer-name="Frame"]',
    )!;
    expect(replacement.style.color).toBe("");
    expect(replacement.getAttribute("data-agent-native-preserve-styles")).toBe(
      "true",
    );
    expect(replacement.querySelector("span")?.style.fontWeight).toBe("700");
  });

  it("keeps the original portable snapshot for a cross-screen replacement", () => {
    const target = buildCodeLayerProjection(CONTENT_WITH_IDS, {
      source: { kind: "design-file", fileId: "screen-1" },
    }).nodes.find((node) => node.style.top === "40px")!;
    const applyLocalContentUpdate = vi.fn();
    const layerHtml =
      '<div class="authored-card" data-agent-native-layer-name="Frame">Frame</div>';
    const snapshot = {
      version: 1 as const,
      nodes: [{ path: [], styles: { color: "rgb(12, 34, 56)" } }],
    };
    const getPreparedCloneVisualOffset = vi.fn(() => ({ x: 13, y: 17 }));

    runPasteToReplace({
      activeFile: { id: "screen-1", content: CONTENT_WITH_IDS } as DesignFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      getCanvasClipboardEntries: () => [
        {
          html: layerHtml,
          sourceFileId: "screen-source",
          portableStyleSnapshot: snapshot,
        },
      ],
      getFreshActiveContent: () => CONTENT_WITH_IDS,
      getRenderedElementInfoForSelector: () => ({
        tagName: "div",
        selector: target.selectors[0]!,
        classes: [],
        computedStyles: {},
        boundingRect: { x: 400, y: 140, width: 200, height: 100 },
        absoluteSiblingVisualOrigin: { x: 300, y: 40 },
        isFlexChild: false,
        isFlexContainer: false,
      }),
      getPreparedCloneVisualOffset,
      runtimeStructureInsertRevisionRef: { current: 0 },
      selectInsertedLayers: vi.fn(),
      selectedCanvasSelector: target.selectors[0]!,
      selectedElement: {
        tagName: "div",
        selector: target.selectors[0]!,
        classes: [],
        computedStyles: {},
        boundingRect: { x: 400, y: 140, width: 200, height: 100 },
        isFlexChild: false,
        isFlexContainer: false,
      },
      setRuntimeStructureInsertRequest: vi.fn(),
      t: (key) => key,
    });

    expect(getPreparedCloneVisualOffset).toHaveBeenCalledWith(
      target.selectors[0],
      layerHtml,
      snapshot,
      undefined,
      "screen-source",
    );
    const next = applyLocalContentUpdate.mock.calls[0]![0] as string;
    const doc = new DOMParser().parseFromString(next, "text/html");
    const replacement = doc.querySelector<HTMLElement>(
      '[data-agent-native-layer-name="Frame"]',
    )!;
    expect(replacement.style.color).toBe("rgb(12, 34, 56)");
  });

  it("leaves source content unchanged when clone geometry is unavailable", () => {
    const target = buildCodeLayerProjection(CONTENT_WITH_IDS, {
      source: { kind: "design-file", fileId: "screen-1" },
    }).nodes.find((node) => node.style.top === "40px")!;
    const applyLocalContentUpdate = vi.fn();

    runPasteToReplace(
      {
        activeFile: { id: "screen-1", content: CONTENT_WITH_IDS } as DesignFile,
        applyLocalContentUpdate,
        canEditDesign: true,
        getCanvasClipboardEntries: () => [],
        getFreshActiveContent: () => CONTENT_WITH_IDS,
        getRenderedElementInfoForSelector: () => ({
          tagName: "div",
          selector: target.selectors[0]!,
          classes: [],
          computedStyles: {},
          boundingRect: { x: 400, y: 140, width: 200, height: 100 },
          absoluteSiblingVisualOrigin: { x: 300, y: 40 },
          isFlexChild: false,
          isFlexContainer: false,
        }),
        getPreparedCloneVisualOffset: () => null,
        runtimeStructureInsertRevisionRef: { current: 0 },
        selectInsertedLayers: vi.fn(),
        selectedCanvasSelector: target.selectors[0]!,
        selectedElement: {
          tagName: "div",
          selector: target.selectors[0]!,
          classes: [],
          computedStyles: {},
          boundingRect: { x: 400, y: 140, width: 200, height: 100 },
          isFlexChild: false,
          isFlexContainer: false,
        },
        setRuntimeStructureInsertRequest: vi.fn(),
        t: (key) => key,
      },
      '<div data-agent-native-layer-name="Frame" style="width:auto;height:auto">Frame</div>',
    );

    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
  });

  it("keeps the trusted target position path when same-origin geometry is absent", () => {
    const target = buildCodeLayerProjection(CONTENT_WITH_IDS, {
      source: { kind: "design-file", fileId: "screen-1" },
    }).nodes.find((node) => node.style.top === "40px")!;
    const applyLocalContentUpdate = vi.fn();

    runPasteToReplace(
      {
        activeFile: { id: "screen-1", content: CONTENT_WITH_IDS } as DesignFile,
        applyLocalContentUpdate,
        canEditDesign: true,
        getCanvasClipboardEntries: () => [],
        getFreshActiveContent: () => CONTENT_WITH_IDS,
        getRenderedElementInfoForSelector: () => ({
          tagName: "div",
          selector: target.selectors[0]!,
          classes: [],
          computedStyles: {},
          boundingRect: { x: 400, y: 140, width: 200, height: 100 },
          absoluteSiblingVisualOrigin: { x: 300, y: 40 },
          isFlexChild: false,
          isFlexContainer: false,
        }),
        getPreparedCloneVisualOffset: () => undefined,
        runtimeStructureInsertRevisionRef: { current: 0 },
        selectInsertedLayers: vi.fn(),
        selectedCanvasSelector: target.selectors[0]!,
        selectedElement: {
          tagName: "div",
          selector: target.selectors[0]!,
          classes: [],
          computedStyles: {},
          boundingRect: { x: 400, y: 140, width: 200, height: 100 },
          isFlexChild: false,
          isFlexContainer: false,
        },
        setRuntimeStructureInsertRequest: vi.fn(),
        t: (key) => key,
      },
      '<div data-agent-native-layer-name="Frame" style="position:absolute;width:24px;height:24px">Frame</div>',
    );

    expect(applyLocalContentUpdate).toHaveBeenCalledOnce();
    const next = applyLocalContentUpdate.mock.calls[0]![0] as string;
    const doc = new DOMParser().parseFromString(next, "text/html");
    const replacement = doc.querySelector<HTMLElement>(
      '[data-agent-native-layer-name="Frame"]',
    )!;
    expect([replacement.style.left, replacement.style.top]).toEqual([
      "300px",
      "40px",
    ]);
  });

  it("keeps trusted live-url geometry when the source projection is unavailable", () => {
    const activeUrl = "http://localhost:8210/preview";
    const setRuntimeStructureInsertRequest = vi.fn();

    runPasteToReplace(
      {
        activeFile: { id: "screen-1", content: activeUrl } as DesignFile,
        applyLocalContentUpdate: vi.fn(),
        canEditDesign: true,
        getCanvasClipboardEntries: () => [],
        getFreshActiveContent: () => activeUrl,
        getRenderedElementInfoForSelector: () => undefined,
        getPreparedCloneVisualOffset: () => undefined,
        runtimeStructureInsertRevisionRef: { current: 0 },
        selectInsertedLayers: vi.fn(),
        selectedCanvasSelector: "#target",
        selectedElement: {
          tagName: "div",
          selector: "#target",
          classes: [],
          computedStyles: {},
          boundingRect: { x: 300, y: 40, width: 200, height: 100 },
          runtimeSelector: "#runtime-target",
          isFlexChild: false,
          isFlexContainer: false,
        },
        setRuntimeStructureInsertRequest,
        t: (key) => key,
      },
      '<div data-agent-native-layer-name="Frame" style="position:absolute;width:24px;height:24px">Frame</div>',
    );

    expect(setRuntimeStructureInsertRequest).toHaveBeenCalledOnce();
    const request = setRuntimeStructureInsertRequest.mock.calls[0]![0];
    const prepared = new DOMParser().parseFromString(request.html, "text/html");
    const replacement = prepared.querySelector<HTMLElement>(
      '[data-agent-native-layer-name="Frame"]',
    )!;
    expect([replacement.style.left, replacement.style.top]).toEqual([
      "300px",
      "40px",
    ]);
    expect(request.anchor.selector).toBe("#runtime-target");
  });

  it("does not use trusted live-url geometry after a direct clone measurement fails", () => {
    const activeUrl = "http://localhost:8210/preview";
    const setRuntimeStructureInsertRequest = vi.fn();
    const toastError = vi.spyOn(toast, "error");

    runPasteToReplace(
      {
        activeFile: { id: "screen-1", content: activeUrl } as DesignFile,
        applyLocalContentUpdate: vi.fn(),
        canEditDesign: true,
        getCanvasClipboardEntries: () => [],
        getFreshActiveContent: () => activeUrl,
        getRenderedElementInfoForSelector: () => undefined,
        getPreparedCloneVisualOffset: () => null,
        runtimeStructureInsertRevisionRef: { current: 0 },
        selectInsertedLayers: vi.fn(),
        selectedCanvasSelector: "#target",
        selectedElement: {
          tagName: "div",
          selector: "#target",
          classes: [],
          computedStyles: {},
          boundingRect: { x: 300, y: 40, width: 200, height: 100 },
          runtimeSelector: "#runtime-target",
          isFlexChild: false,
          isFlexContainer: false,
        },
        setRuntimeStructureInsertRequest,
        t: (key) => key,
      },
      '<div data-agent-native-layer-name="Frame" style="position:absolute;width:24px;height:24px">Frame</div>',
    );

    expect(setRuntimeStructureInsertRequest).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.toasts.layerMoveFailed",
      { duration: 4000 },
    );
    toastError.mockRestore();
  });

  it("does not use trusted live-url geometry after target measurement fails", () => {
    const activeUrl = "http://localhost:8210/preview";
    const setRuntimeStructureInsertRequest = vi.fn();
    const toastError = vi.spyOn(toast, "error");

    runPasteToReplace(
      {
        activeFile: { id: "screen-1", content: activeUrl } as DesignFile,
        applyLocalContentUpdate: vi.fn(),
        canEditDesign: true,
        getCanvasClipboardEntries: () => [],
        getFreshActiveContent: () => activeUrl,
        getRenderedElementInfoForSelector: () => null,
        getPreparedCloneVisualOffset: () => undefined,
        runtimeStructureInsertRevisionRef: { current: 0 },
        selectInsertedLayers: vi.fn(),
        selectedCanvasSelector: "#target",
        selectedElement: {
          tagName: "div",
          selector: "#target",
          classes: [],
          computedStyles: {},
          boundingRect: { x: 300, y: 40, width: 200, height: 100 },
          runtimeSelector: "#runtime-target",
          isFlexChild: false,
          isFlexContainer: false,
        },
        setRuntimeStructureInsertRequest,
        t: (key) => key,
      },
      '<div data-agent-native-layer-name="Frame" style="position:absolute;width:24px;height:24px">Frame</div>',
    );

    expect(setRuntimeStructureInsertRequest).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.toasts.layerMoveFailed",
      { duration: 4000 },
    );
    toastError.mockRestore();
  });

  it("replaces the enclosing whole-text layer when a nested span is selected", () => {
    const content = `<!doctype html><html><body><main data-agent-native-node-id="root"><section data-agent-native-node-id="holder" data-agent-native-layer-name="Holder" style="position:absolute;left:120px;top:120px;width:500px;height:320px"><div data-agent-native-node-id="caption" data-agent-native-layer-name="Caption" style="position:absolute;left:40px;top:60px;font-size:28px"><span style="text-decoration: underline">klsajfk</span></div></section></main></body></html>`;
    const projection = buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: "screen-1" },
    });
    const selected = projection.nodes.find((node) => node.tag === "span")!;
    const applyLocalContentUpdate = vi.fn();

    runPasteToReplace({
      activeFile: { id: "screen-1", content } as DesignFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      getCanvasClipboardEntries: () => [
        {
          html: '<section data-agent-native-node-id="holder" data-agent-native-layer-name="Holder" style="position:absolute;left:120px;top:120px;width:500px;height:320px"><div data-agent-native-node-id="caption" data-agent-native-layer-name="Caption" style="position:absolute;left:40px;top:60px;font-size:28px"><span style="text-decoration: underline">klsajfk</span></div></section>',
          rootNodeId: "holder",
          sourceFileId: "screen-1",
        },
      ],
      getFreshActiveContent: () => content,
      runtimeStructureInsertRevisionRef: { current: 0 },
      selectInsertedLayers: vi.fn(),
      selectedCanvasSelector: selected.selectors[0]!,
      selectedElement: {
        tagName: selected.tag,
        selector: selected.selectors[0]!,
        sourceId: selected.id,
        classes: selected.classes,
        computedStyles: {},
        inlineStyles: {},
        hasOwnText: selected.paintsOwnText,
        wholeTextStyleRoot: selected.wholeTextStyleRoot,
        boundingRect: { x: 160, y: 180, width: 140, height: 32 },
        parentBoundingRect: { x: 160, y: 180, width: 140, height: 32 },
        isFlexChild: false,
        isFlexContainer: false,
      },
      setRuntimeStructureInsertRequest: vi.fn(),
      t: (key) => key,
    });

    const next = applyLocalContentUpdate.mock.calls[0]![0] as string;
    const doc = new DOMParser().parseFromString(next, "text/html");
    const holder = doc.querySelector<HTMLElement>(
      '[data-agent-native-layer-name="Holder"]:not([data-agent-native-node-id="holder"])',
    )!;

    expect(
      doc.querySelector('[data-agent-native-node-id="caption"]'),
    ).toBeNull();
    expect(
      holder.parentElement?.getAttribute("data-agent-native-node-id"),
    ).toBe("holder");
    expect([holder.style.left, holder.style.top]).toEqual(["40px", "60px"]);
    expect(holder.querySelector("span")?.textContent).toBe("klsajfk");
  });

  it("positions a promoted flow-text replacement from the promoted target's measured origin", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        readonly is2D = true;
        readonly a = 2;
        readonly b = 0;
        readonly c = 0;
        readonly d = 2;
        readonly e = 0;
        readonly f = 0;

        constructor(_transform: string) {}
      },
    );
    const content = `<!doctype html><html><body><main data-agent-native-node-id="root"><section data-agent-native-node-id="holder" style="position:relative;left:100px;top:80px;width:500px;height:320px;border:2px solid;padding:20px;transform:scale(2);transform-origin:top left"><div data-agent-native-node-id="before" style="height:80px">Before</div><div data-agent-native-node-id="caption" data-agent-native-layer-name="Caption" style="font-size:28px;width:50px;height:20px;transform:scale(2);transform-origin:50% 50%"><span style="text-decoration:underline">Caption text</span></div><p data-agent-native-node-id="after">After</p></section></main></body></html>`;
    const projection = buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: "screen-1" },
    });
    const selected = projection.nodes.find((node) => node.tag === "span")!;
    const applyLocalContentUpdate = vi.fn();

    runPasteToReplace({
      activeFile: { id: "screen-1", content } as DesignFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      getCanvasClipboardEntries: () => [
        {
          html: '<div data-agent-native-node-id="caption" data-agent-native-layer-name="Caption" style="font-size:28px;width:50px;height:20px;transform:scale(2);transform-origin:50% 50%"><span style="text-decoration:underline">Caption text</span></div>',
          rootNodeId: "caption",
          sourceFileId: "screen-1",
        },
      ],
      getFreshActiveContent: () => content,
      getRenderedElementInfoForSelector: () => ({
        tagName: "div",
        selector: '[data-agent-native-node-id="caption"]',
        classes: [],
        computedStyles: {},
        boundingRect: { x: 152, y: 302, width: 100, height: 40 },
        absoluteSiblingVisualOrigin: { x: 25, y: 110 },
        isFlexChild: false,
        isFlexContainer: false,
      }),
      runtimeStructureInsertRevisionRef: { current: 0 },
      selectInsertedLayers: vi.fn(),
      selectedCanvasSelector: selected.selectors[0]!,
      selectedElement: {
        tagName: selected.tag,
        selector: selected.selectors[0]!,
        sourceId: selected.id,
        classes: selected.classes,
        computedStyles: {},
        inlineStyles: {},
        hasOwnText: selected.paintsOwnText,
        wholeTextStyleRoot: selected.wholeTextStyleRoot,
        boundingRect: { x: 152, y: 202, width: 82, height: 34 },
        parentBoundingRect: { x: 152, y: 202, width: 180, height: 34 },
        positionContainingBlockOrigin: { x: 102, y: 82 },
        positionContainingBlockTransform: { a: 1, b: 0, c: 0, d: 1 },
        isFlexChild: false,
        isFlexContainer: false,
      },
      setRuntimeStructureInsertRequest: vi.fn(),
      t: (key) => key,
    });

    const next = applyLocalContentUpdate.mock.calls[0]?.[0] as string;
    const doc = new DOMParser().parseFromString(next, "text/html");
    const replacement = doc.querySelector<HTMLElement>(
      '[data-agent-native-layer-name="Caption"]:not([data-agent-native-node-id="caption"])',
    );

    expect(
      replacement?.parentElement?.getAttribute("data-agent-native-node-id"),
    ).toBe("holder");
    expect([replacement?.style.left, replacement?.style.top]).toEqual([
      "50px",
      "120px",
    ]);
    expect(
      doc.querySelector('[data-agent-native-node-id="caption"]'),
    ).toBeNull();
    expect(
      doc.querySelector('[data-agent-native-node-id="before"]'),
    ).not.toBeNull();
    expect(
      doc.querySelector('[data-agent-native-node-id="after"]'),
    ).not.toBeNull();
  });

  it("leaves source unchanged when promoted flow-text geometry cannot be measured", () => {
    const content =
      '<main><section data-agent-native-node-id="holder"><div data-agent-native-node-id="caption"><span>Caption text</span></div></section></main>';
    const projection = buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: "screen-1" },
    });
    const selected = projection.nodes.find((node) => node.tag === "span")!;
    const applyLocalContentUpdate = vi.fn();
    const toastError = vi.spyOn(toast, "error");

    runPasteToReplace({
      activeFile: { id: "screen-1", content } as DesignFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      getCanvasClipboardEntries: () => [
        {
          html: '<div data-agent-native-layer-name="Caption"><span>Caption text</span></div>',
          rootNodeId: "clipboard-caption",
          sourceFileId: "screen-2",
        },
      ],
      getFreshActiveContent: () => content,
      getRenderedElementInfoForSelector: () => null,
      runtimeStructureInsertRevisionRef: { current: 0 },
      selectInsertedLayers: vi.fn(),
      selectedCanvasSelector: selected.selectors[0]!,
      selectedElement: {
        tagName: selected.tag,
        selector: selected.selectors[0]!,
        sourceId: selected.id,
        classes: selected.classes,
        computedStyles: {},
        inlineStyles: {},
        hasOwnText: selected.paintsOwnText,
        wholeTextStyleRoot: selected.wholeTextStyleRoot,
        boundingRect: { x: 10, y: 20, width: 80, height: 24 },
        isFlexChild: false,
        isFlexContainer: false,
      },
      setRuntimeStructureInsertRequest: vi.fn(),
      t: (key) => key,
    });

    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.toasts.pasteReplaceFailed",
      { duration: 4000 },
    );
    toastError.mockRestore();
  });

  it.each(["static", "relative", "fixed"] as const)(
    "does not reuse authored left/top for a %s target without live geometry",
    (position) => {
      const content = `<main><button data-agent-native-node-id="target" style="position:${position};left:20px;top:30px">Target</button></main>`;
      const selected = buildCodeLayerProjection(content, {
        source: { kind: "design-file", fileId: "screen-1" },
      }).nodes.find((node) => node.tag === "button")!;
      const applyLocalContentUpdate = vi.fn();
      const toastError = vi.spyOn(toast, "error");

      runPasteToReplace(
        {
          activeFile: { id: "screen-1", content } as DesignFile,
          applyLocalContentUpdate,
          canEditDesign: true,
          getCanvasClipboardEntries: () => [],
          getFreshActiveContent: () => content,
          runtimeStructureInsertRevisionRef: { current: 0 },
          selectInsertedLayers: vi.fn(),
          selectedCanvasSelector: selected.selectors[0]!,
          selectedElement: {
            tagName: selected.tag,
            selector: selected.selectors[0]!,
            sourceId: selected.id,
            classes: selected.classes,
            computedStyles: {},
            inlineStyles: {},
            boundingRect: { x: 20, y: 30, width: 80, height: 32 },
            isFlexChild: false,
            isFlexContainer: false,
          },
          setRuntimeStructureInsertRequest: vi.fn(),
          t: (key) => key,
        },
        '<button data-agent-native-layer-name="Replacement">Replacement</button>',
      );

      expect(applyLocalContentUpdate).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith(
        "designEditor.toasts.pasteReplaceFailed",
        { duration: 4000 },
      );
      toastError.mockRestore();
    },
  );

  it("does not fall back to authored coordinates when live measurement fails", () => {
    const content =
      '<main><button data-agent-native-node-id="target" style="position:absolute;left:2px;top:3px">Target</button></main>';
    const selected = buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: "screen-1" },
    }).nodes.find((node) => node.tag === "button")!;
    const applyLocalContentUpdate = vi.fn();
    const toastError = vi.spyOn(toast, "error");

    runPasteToReplace(
      {
        activeFile: { id: "screen-1", content } as DesignFile,
        applyLocalContentUpdate,
        canEditDesign: true,
        getCanvasClipboardEntries: () => [],
        getFreshActiveContent: () => content,
        getRenderedElementInfoForSelector: () => null,
        runtimeStructureInsertRevisionRef: { current: 0 },
        selectInsertedLayers: vi.fn(),
        selectedCanvasSelector: selected.selectors[0]!,
        selectedElement: {
          tagName: selected.tag,
          selector: selected.selectors[0]!,
          sourceId: selected.id,
          classes: selected.classes,
          computedStyles: {},
          inlineStyles: {},
          boundingRect: { x: 2, y: 3, width: 80, height: 32 },
          isFlexChild: false,
          isFlexContainer: false,
        },
        setRuntimeStructureInsertRequest: vi.fn(),
        t: (key) => key,
      },
      '<button data-agent-native-layer-name="Replacement">Replacement</button>',
    );

    expect(applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.toasts.pasteReplaceFailed",
      { duration: 4000 },
    );
    toastError.mockRestore();
  });

  it("uses fresh geometry for an ordinary replacement target", () => {
    const content =
      '<main><button data-agent-native-node-id="target" style="position:absolute;left:2px;top:3px">Target</button><p>After</p></main>';
    const projection = buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: "screen-1" },
    });
    const selected = projection.nodes.find((node) => node.tag === "button")!;
    const applyLocalContentUpdate = vi.fn();

    runPasteToReplace({
      activeFile: { id: "screen-1", content } as DesignFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      getCanvasClipboardEntries: () => [
        {
          html: '<button data-agent-native-layer-name="Target">Replacement</button>',
          rootNodeId: "replacement",
          sourceFileId: "screen-2",
        },
      ],
      getFreshActiveContent: () => content,
      getRenderedElementInfoForSelector: () => ({
        tagName: "button",
        selector: '[data-agent-native-node-id="target"]',
        classes: [],
        computedStyles: {},
        boundingRect: { x: 120, y: 230, width: 80, height: 32 },
        absoluteSiblingVisualOrigin: { x: 20, y: 30 },
        isFlexChild: false,
        isFlexContainer: false,
      }),
      runtimeStructureInsertRevisionRef: { current: 0 },
      selectInsertedLayers: vi.fn(),
      selectedCanvasSelector: selected.selectors[0]!,
      selectedElement: {
        tagName: selected.tag,
        selector: selected.selectors[0]!,
        sourceId: selected.id,
        classes: selected.classes,
        computedStyles: {},
        inlineStyles: {},
        hasOwnText: selected.paintsOwnText,
        wholeTextStyleRoot: selected.wholeTextStyleRoot,
        boundingRect: { x: 2, y: 4, width: 80, height: 32 },
        positionContainingBlockOrigin: { x: 0, y: 0 },
        positionContainingBlockTransform: { a: 1, b: 0, c: 0, d: 1 },
        isFlexChild: false,
        isFlexContainer: false,
      },
      setRuntimeStructureInsertRequest: vi.fn(),
      t: (key) => key,
    });

    const next = applyLocalContentUpdate.mock.calls[0]?.[0] as string;
    const doc = new DOMParser().parseFromString(next, "text/html");
    const replacement = doc.querySelector<HTMLElement>(
      '[data-agent-native-layer-name="Target"]',
    );

    expect([replacement?.style.left, replacement?.style.top]).toEqual([
      "20px",
      "30px",
    ]);
  });

  it("subtracts the clone's own transform offset from the measured visual origin", () => {
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        readonly is2D = true;
        readonly a = 0;
        readonly b = 1;
        readonly c = -1;
        readonly d = 0;
        readonly e = 0;
        readonly f = 0;

        constructor(_transform: string) {}
      },
    );
    const content =
      '<main><button data-agent-native-node-id="target">Target</button></main>';
    const selected = buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: "screen-1" },
    }).nodes.find((node) => node.tag === "button")!;
    const applyLocalContentUpdate = vi.fn();

    runPasteToReplace({
      activeFile: { id: "screen-1", content } as DesignFile,
      applyLocalContentUpdate,
      canEditDesign: true,
      getCanvasClipboardEntries: () => [
        {
          html: '<button data-agent-native-layer-name="Target" style="width:40px;height:24px;transform:matrix(0, 1, -1, 0, 0, 0);transform-origin:20px 12px">Replacement</button>',
          rootNodeId: "replacement",
          sourceFileId: "screen-2",
        },
      ],
      getFreshActiveContent: () => content,
      getRenderedElementInfoForSelector: () => ({
        tagName: "button",
        selector: '[data-agent-native-node-id="target"]',
        classes: [],
        computedStyles: {},
        boundingRect: { x: 30, y: 40, width: 1, height: 1 },
        absoluteSiblingVisualOrigin: { x: 30, y: 40 },
        isFlexChild: false,
        isFlexContainer: false,
      }),
      runtimeStructureInsertRevisionRef: { current: 0 },
      selectInsertedLayers: vi.fn(),
      selectedCanvasSelector: selected.selectors[0]!,
      selectedElement: {
        tagName: selected.tag,
        selector: selected.selectors[0]!,
        sourceId: selected.id,
        classes: selected.classes,
        computedStyles: {},
        inlineStyles: {},
        hasOwnText: selected.paintsOwnText,
        wholeTextStyleRoot: selected.wholeTextStyleRoot,
        boundingRect: { x: 0, y: 0, width: 1, height: 1 },
        isFlexChild: false,
        isFlexContainer: false,
      },
      setRuntimeStructureInsertRequest: vi.fn(),
      t: (key) => key,
    });

    const next = applyLocalContentUpdate.mock.calls[0]?.[0] as string;
    const doc = new DOMParser().parseFromString(next, "text/html");
    const replacement = doc.querySelector<HTMLElement>(
      '[data-agent-native-layer-name="Target"]',
    );

    expect([replacement?.style.left, replacement?.style.top]).toEqual([
      "22px",
      "48px",
    ]);
  });

  it.each([
    ["frame", 'data-an-primitive="frame"'],
    ["group", 'data-agent-native-group="true"'],
  ])(
    "does not promote an inline text selection to a containing %s",
    (_kind, kindAttribute) => {
      const content = `<main data-agent-native-node-id="root"><section data-agent-native-node-id="frame" ${kindAttribute} style="position:relative;width:500px;height:320px"><span data-agent-native-node-id="label" style="position:absolute;left:40px;top:60px">Caption</span></section></main>`;
      const projection = buildCodeLayerProjection(content, {
        source: { kind: "design-file", fileId: "screen-1" },
      });
      const selected = projection.nodes.find((node) => node.tag === "span")!;
      const applyLocalContentUpdate = vi.fn();

      runPasteToReplace(
        {
          activeFile: { id: "screen-1", content } as DesignFile,
          applyLocalContentUpdate,
          canEditDesign: true,
          getCanvasClipboardEntries: () => [],
          getFreshActiveContent: () => content,
          runtimeStructureInsertRevisionRef: { current: 0 },
          selectInsertedLayers: vi.fn(),
          selectedCanvasSelector: selected.selectors[0]!,
          selectedElement: {
            tagName: selected.tag,
            selector: selected.selectors[0]!,
            sourceId: selected.id,
            classes: selected.classes,
            computedStyles: {},
            inlineStyles: {},
            hasOwnText: selected.paintsOwnText,
            wholeTextStyleRoot: selected.wholeTextStyleRoot,
            boundingRect: { x: 40, y: 60, width: 100, height: 24 },
            parentBoundingRect: { x: 0, y: 0, width: 500, height: 320 },
            isFlexChild: false,
            isFlexContainer: false,
          },
          setRuntimeStructureInsertRequest: vi.fn(),
          t: (key) => key,
        },
        '<div data-agent-native-node-id="pasted" data-agent-native-layer-name="Pasted"></div>',
      );

      const next = applyLocalContentUpdate.mock.calls[0]![0] as string;
      const doc = new DOMParser().parseFromString(next, "text/html");
      const frame = doc.querySelector('[data-agent-native-node-id="frame"]');
      const pasted = doc.querySelector(
        '[data-agent-native-layer-name="Pasted"]',
      );

      expect(frame).not.toBeNull();
      expect(
        pasted?.parentElement?.getAttribute("data-agent-native-node-id"),
      ).toBe("frame");
    },
  );
});
