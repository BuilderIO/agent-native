import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
// @vitest-environment happy-dom
//
// html-layer-positioning.ts's DOMParser-based rebase helpers early-return
// null under `typeof window === "undefined"` (the default node test
// environment), which would make this test pass/fail independent of the
// actual id-resolution bug this file exists to pin.
import { describe, expect, it } from "vitest";

import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove, type LayerMoveArgs } from "./layer-move";

/**
 * "Sticker" is a top-level absolutely positioned sibling; "Panel" is an
 * unrelated positioned container. Panel-relative drop must rebase Sticker's
 * left/top so it keeps the same on-screen position, not just reparent it
 * with its old body-relative coordinates (which would now resolve against
 * Panel's own box instead). Matches e2e/parity-layers-panel.spec.ts's
 * "dropping an absolutely positioned layer row onto a Frame row keeps its
 * on-screen position".
 */
const FIXTURE = `<body>
  <div data-agent-native-node-id="panel" style="position:relative;left:20px;top:20px;width:300px;height:200px"></div>
  <div data-agent-native-node-id="sticker" style="position:absolute;left:500px;top:1000px;width:60px;height:40px"></div>
</body>`;

function buildArgs(content: string): {
  args: Omit<LayerMoveArgs, "canMoveLayer">;
  panelId: string;
  stickerId: string;
} {
  const projection = buildCodeLayerProjection(content);
  const tree = buildCodeLayerTree(projection);
  const codeLayerOwnerByNodeId = new Map(
    projection.nodes.map((node) => [
      node.id,
      { fileId: "index.html", node, tree, runtimeOnly: false },
    ]),
  );
  const panelId = projection.nodes.find(
    (n) => n.dataAttributes["data-agent-native-node-id"] === "panel",
  )!.id;
  const stickerId = projection.nodes.find(
    (n) => n.dataAttributes["data-agent-native-node-id"] === "sticker",
  )!.id;

  const activeFile: DesignFile = {
    id: "index.html",
    filename: "index.html",
    fileType: "html",
    content,
    createdAt: "",
    updatedAt: "",
  };

  let updatedContent: string | null = null;

  const args: Omit<LayerMoveArgs, "canMoveLayer"> = {
    activeFile,
    applyFileContentUpdate: (_fileId, nextContent) => {
      updatedContent = nextContent;
    },
    canEditDesign: true,
    codeLayerOwnerByNodeId,
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
    t: (key: string) => key,
    viewModeRef: { current: "single" },
    visualScreenFileIds: new Set(),
  };
  // Expose the captured result via a getter the test reads after the call.
  (args as any).__getUpdatedContent = () => updatedContent;
  return { args, panelId, stickerId };
}

describe("runLayerMove: absolute-position rebase on panel reparent", () => {
  it("rebases left/top into the new parent's coordinate space so on-screen position is unchanged", () => {
    const { args, panelId, stickerId } = buildArgs(FIXTURE);
    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [stickerId],
      targetId: panelId,
      placement: "inside",
    });

    const updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(
      updatedContent,
      "runLayerMove did not persist any content update",
    ).not.toBeNull();

    // The bug: left/top left untouched at the old body-relative values,
    // which now render relative to Panel's own box instead.
    expect(updatedContent).not.toMatch(/left:\s*500px/);
    expect(updatedContent).not.toMatch(/top:\s*1000px/);

    // Sticker (world position 500,1000) reparented under Panel (world
    // position 20,20) must land at Panel-relative (480, 980) so it renders
    // at the same on-screen spot as before.
    const stickerMatch =
      /data-agent-native-node-id="sticker"[^>]*style="([^"]*)"/.exec(
        updatedContent!,
      );
    expect(stickerMatch, "sticker not found in updated content").not.toBeNull();
    expect(stickerMatch![1]).toContain("left: 480px");
    expect(stickerMatch![1]).toContain("top: 980px");
  });
});
