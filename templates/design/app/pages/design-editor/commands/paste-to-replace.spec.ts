// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

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
