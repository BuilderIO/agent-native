// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  absolutePlacePointForDrop,
  runCrossScreenElementDrop,
  shouldAbsolutePlaceOnEmptyScreen,
} from "./cross-screen-element-drop";

const EMPTY_SCREEN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body></body></html>`;

const SCREEN_WITH_FRAME = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1"></div>
</body></html>`;

describe("shouldAbsolutePlaceOnEmptyScreen", () => {
  it("places at the pointer when the destination body has no elements", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: EMPTY_SCREEN,
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toBe(true);
  });

  it("leaves flow-insert alone when the destination already has layers", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: SCREEN_WITH_FRAME,
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toBe(false);
  });

  it("does not treat a live-app URL destination as an empty screen", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: "http://localhost:5173/",
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toBe(false);
  });

  it("requires a pointer", () => {
    expect(
      shouldAbsolutePlaceOnEmptyScreen({
        destHtml: EMPTY_SCREEN,
        targetLocalPoint: null,
      }),
    ).toBe(false);
  });
});

describe("absolutePlacePointForDrop", () => {
  it("uses the pointer on an empty screen even when a stale anchor rect is present", () => {
    expect(
      absolutePlacePointForDrop({
        placeAbsoluteOnEmptyScreen: true,
        targetAnchorRect: { left: 180, top: 240 },
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toEqual({ x: 180, y: 240 });
  });

  it("subtracts the anchor origin when placing into a positioned container", () => {
    expect(
      absolutePlacePointForDrop({
        placeAbsoluteOnEmptyScreen: false,
        targetAnchorRect: { left: 100, top: 50 },
        targetLocalPoint: { x: 180, y: 240 },
      }),
    ).toEqual({ x: 80, y: 190 });
  });
});

describe("runCrossScreenElementDrop duplicate routing", () => {
  it.each(["localhost", "fusion"])(
    "queues an inline Alt-drag copy for a %s screen",
    (sourceType) => {
      const runtimeStructureInsertRevisionRef = { current: 0 };
      let runtimeStructureInsertRequest: unknown = null;

      runCrossScreenElementDrop(
        {
          applyFileContentUpdate: () => {
            throw new Error("live duplicate must not write stored content");
          },
          boardFileId: undefined,
          canEditDesign: true,
          clearPendingOverviewLayerSelectionTimer: () => {},
          codeLayerOwnerByNodeIdRef: { current: new Map() },
          designSourceType: "inline",
          getScreenContent: (screenId) =>
            screenId === "source"
              ? SCREEN_WITH_FRAME
              : "http://localhost:5173/",
          id: undefined,
          overviewScreens: [
            {
              id: "target",
              filename: "target.html",
              content: "http://localhost:5173/",
              updatedAt: "2026-09-11T00:00:00.000Z",
              heightPinned: false,
              sourceType,
            },
          ],
          pendingOverviewLayerSelectionRef: { current: null },
          pendingOverviewScreenSelectionRef: { current: null },
          recordContentHistoryEntry: () => {},
          runtimeStructureInsertRevisionRef,
          sendRuntimeLayerMoveSemanticHandoff: () => {
            throw new Error("duplicate must not use move-only handoff");
          },
          setActiveFileId: () => {},
          setCreatedOverviewLayerSelection: () => {},
          setOverviewSelectedScreenIds: () => {},
          setRuntimeStructureInsertRequest: (value) => {
            runtimeStructureInsertRequest =
              typeof value === "function" ? value(null) : value;
          },
          setSelectedElement: () => {},
          setSelectedLayerIdsState: () => {},
          t: (key) => key,
          viewModeRef: { current: "overview" },
        },
        {
          sourceSelector: "#source",
          sourceNodeId: "source-id",
          sourceScreenId: "source",
          targetScreenId: "target",
          targetAnchorSelector: "body",
          targetAnchorPlacement: "inside",
          targetDropMode: "absolute-container",
          targetAnchorRect: { left: 100, top: 50, width: 400, height: 300 },
          targetLocalPoint: { x: 240, y: 300 },
          sourcePointerOffset: { x: 10, y: 12 },
          duplicate: true,
          sourceCloneHtml:
            '<section id="source-root" data-agent-native-node-id="copy-id" style="position:absolute;left:4px;top:6px"></section>',
        },
      );

      expect(runtimeStructureInsertRevisionRef.current).toBe(1);
      expect(runtimeStructureInsertRequest).toMatchObject({
        screenId: "target",
        anchor: { selector: "body" },
        placement: "inside",
      });
      const insertedHtml = (runtimeStructureInsertRequest as { html: string })
        .html;
      expect(insertedHtml).not.toContain('id="source-root"');
      expect(insertedHtml).toMatch(/data-agent-native-node-id="[^"]+"/);
      expect(insertedHtml).toContain("left: 130px");
      expect(insertedHtml).toContain("top: 238px");
    },
  );
});
