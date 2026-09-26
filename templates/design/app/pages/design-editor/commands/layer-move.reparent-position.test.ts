import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { runPublishCanonicalContent } from "@/pages/design-editor/commands/publish-canonical-content";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove, type LayerMoveArgs } from "./layer-move";

const FIXTURE = `<body>
  <div data-agent-native-node-id="panel" style="position:relative;left:20px;top:20px;width:300px;height:200px"></div>
  <div data-agent-native-node-id="sticker" data-agent-native-layer-name="Sticker" style="position:absolute;left:500px;top:1000px;width:60px;height:40px"></div>
</body>`;

const FLOW_FIXTURE = `<body style="margin:0;padding:32px;display:flex;flex-direction:column;gap:24px">
  <section data-agent-native-node-id="origin" style="position:relative;width:700px;height:300px"></section>
  <div data-agent-native-node-id="main-content" style="width:260px;height:180px">Main Content</div>
  <section data-agent-native-node-id="workspace" style="display:flex;flex-direction:row;gap:24px;width:700px;height:300px">
    <div data-agent-native-node-id="sidebar" style="width:200px;height:200px"></div>
  </section>
</body>`;

const ABSOLUTE_FLOW_FIXTURE = `<body>
  <section data-agent-native-node-id="freeform" style="position:relative;left:20px;top:20px;width:300px;height:200px">
    <div data-agent-native-node-id="absolute-child" style="position:absolute;left:30px;top:40px;width:60px;height:40px">Freeform child</div>
  </section>
  <section data-agent-native-node-id="workspace" style="display:flex;flex-direction:row;width:700px;height:300px">
    <div data-agent-native-node-id="sidebar" style="width:200px;height:200px"></div>
  </section>
</body>`;

const IGNORED_AUTO_LAYOUT_FIXTURE = `<body>
  <section data-agent-native-node-id="source-layout" style="position:relative;left:20px;top:20px;width:300px;height:200px;display:flex">
    <div data-agent-native-node-id="pinned" style="position:absolute;left:30px;top:40px;width:60px;height:40px">Pinned child</div>
  </section>
  <section data-agent-native-node-id="workspace" style="position:relative;left:400px;top:200px;display:flex;flex-direction:row;width:700px;height:300px">
    <div data-agent-native-node-id="sidebar" style="width:200px;height:200px"></div>
  </section>
</body>`;

const CLASS_AUTHORED_LAYOUT_FIXTURE = `<!doctype html><html><head><style>
.regular-parent { display: block; }
.stylesheet-absolute { position: absolute; left: 30px; top: 40px; width: 60px; height: 40px; }
.stylesheet-flow { display: flex; gap: 16px; }
</style></head><body>
  <section class="regular-parent"><div data-agent-native-node-id="moving" class="stylesheet-absolute">Moved</div></section>
  <section data-agent-native-node-id="workspace" class="stylesheet-flow"></section>
</body></html>`;

afterEach(() => document.body.replaceChildren());

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

function mountPreview(content: string, iframeId: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-screen-iframe-id", iframeId);
  document.body.append(iframe);
  const preview = iframe.contentDocument!;
  preview.open();
  preview.write(content);
  preview.close();
  return iframe;
}

function mountBoardPreview(content: string): HTMLIFrameElement {
  const surface = document.createElement("div");
  surface.setAttribute("data-board-surface-layer", "");
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-design-preview-iframe", "");
  surface.append(iframe);
  document.body.append(surface);
  const preview = iframe.contentDocument!;
  preview.open();
  preview.write(content);
  preview.close();
  return iframe;
}

function publishFixture(fileId: string, content: string): string {
  return runPublishCanonicalContent(
    {
      canEditDesignRef: { current: true },
      pendingLocalFileContentsRef: { current: new Map() },
      cancelIdentityMigration: () => {},
      queueFileContentSave: () => {},
    },
    fileId,
    content,
  );
}

function buildArgs(
  content: string,
  draggedAttrId = "sticker",
  targetAttrId = "panel",
  draggedOccurrence = 0,
): {
  args: Omit<LayerMoveArgs, "canMoveLayer">;
  targetId: string;
  draggedId: string;
} {
  const projection = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId: "index.html" },
  });
  const tree = buildCodeLayerTree(projection);
  const codeLayerOwnerByNodeId = new Map(
    projection.nodes.map((node) => [
      node.id,
      {
        fileId: "index.html",
        node,
        sourceProjection: projection,
        tree,
        runtimeOnly: false,
      },
    ]),
  );
  const targetId = projection.nodes.find(
    (n) => n.dataAttributes["data-agent-native-node-id"] === targetAttrId,
  )!.id;
  const draggedId = projection.nodes.filter(
    (n) => n.dataAttributes["data-agent-native-node-id"] === draggedAttrId,
  )[draggedOccurrence]!.id;

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
      const publication = acceptFixture(_fileId, nextContent);
      updatedContent = publication.content;
      return publication;
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
  (args as any).__getUpdatedContent = () => updatedContent;
  return { args, targetId, draggedId };
}

describe("runLayerMove: positioning when layers change parents", () => {
  it("rebases left/top into the new parent's coordinate space so on-screen position is unchanged", () => {
    const { args, targetId, draggedId } = buildArgs(FIXTURE);
    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    const updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(
      updatedContent,
      "runLayerMove did not persist any content update",
    ).not.toBeNull();

    expect(updatedContent).not.toMatch(/left:\s*500px/);
    expect(updatedContent).not.toMatch(/top:\s*1000px/);

    const stickerMatch =
      /data-agent-native-node-id="sticker"[^>]*style="([^"]*)"/.exec(
        updatedContent!,
      );
    expect(stickerMatch, "sticker not found in updated content").not.toBeNull();
    expect(stickerMatch![1]).toContain("left: 480px");
    expect(stickerMatch![1]).toContain("top: 980px");

    const projection = buildCodeLayerProjection(updatedContent!, {
      source: { kind: "design-file", fileId: "index.html" },
    });
    const movedSticker = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "sticker",
    );
    expect(movedSticker).toMatchObject({
      layerName: "Sticker",
      layerNameAttribute: "data-agent-native-layer-name",
    });
  });

  it("keeps a Layers-moved normal-flow child eligible for Fill in auto layout", () => {
    const { args, targetId, draggedId } = buildArgs(
      FLOW_FIXTURE,
      "main-content",
      "workspace",
    );
    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    let updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(
      updatedContent,
      "runLayerMove did not persist any content update",
    ).not.toBeNull();
    let projection = buildCodeLayerProjection(updatedContent!, {
      source: { kind: "design-file", fileId: "index.html" },
    });
    const movedNode = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "main-content",
    );
    expect(movedNode?.parentId).toBe(targetId);

    const widthPatch = applyVisualEdit(
      updatedContent!,
      {
        kind: "style",
        target: { nodeId: movedNode!.id },
        property: "width",
        value: "auto",
      },
      { source: projection.source },
    );
    expect(widthPatch.result.status).toBe("applied");
    const flexPatch = applyVisualEdit(
      widthPatch.content,
      {
        kind: "style",
        target: { nodeId: movedNode!.id },
        property: "flex",
        value: "1 0 0",
      },
      { source: projection.source },
    );
    expect(flexPatch.result.status).toBe("applied");
    updatedContent = flexPatch.content;
    projection = buildCodeLayerProjection(updatedContent, {
      source: { kind: "design-file", fileId: "index.html" },
    });
    const filledNode = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "main-content",
    );

    expect(filledNode?.parentId).toBe(targetId);
    expect(filledNode?.style).toMatchObject({
      width: "auto",
      flex: "1 0 0",
    });
    expect(filledNode?.style.position).toBeUndefined();
    expect(filledNode?.style.left).toBeUndefined();
    expect(filledNode?.style.top).toBeUndefined();
  });

  it("converts a freely positioned Frame child to flow when it enters auto layout", () => {
    const { args, targetId, draggedId } = buildArgs(
      ABSOLUTE_FLOW_FIXTURE,
      "absolute-child",
      "workspace",
    );
    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    const updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(updatedContent).not.toBeNull();
    const projection = buildCodeLayerProjection(updatedContent!, {
      source: { kind: "design-file", fileId: "index.html" },
    });
    const movedNode = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "absolute-child",
    );

    expect(movedNode?.parentId).toBe(targetId);
    expect(movedNode?.style.position).toBe("relative !important");
    expect(movedNode?.style.left).toBe("auto !important");
    expect(movedNode?.style.top).toBe("auto !important");
  });

  it("keeps an absolute child already ignored by auto layout out of the new flow", () => {
    const { args, targetId, draggedId } = buildArgs(
      IGNORED_AUTO_LAYOUT_FIXTURE,
      "pinned",
      "workspace",
    );
    const sourceOwner = Array.from(args.codeLayerOwnerByNodeId.values()).find(
      (owner) =>
        owner.node.dataAttributes["data-agent-native-node-id"] === "pinned",
    );
    expect(sourceOwner?.node.layout.parentDisplay).toBe("flex");

    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    const updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(updatedContent).not.toBeNull();
    const projection = buildCodeLayerProjection(updatedContent!, {
      source: { kind: "design-file", fileId: "index.html" },
    });
    const movedNode = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "pinned",
    );

    expect(movedNode?.parentId).toBe(targetId);
    expect(movedNode?.style.position).toBe("absolute");
  });

  it("uses the owning breakpoint iframe to normalize stylesheet positioning", () => {
    const { args, targetId, draggedId } = buildArgs(
      CLASS_AUTHORED_LAYOUT_FIXTURE,
      "moving",
      "workspace",
    );
    args.activeBreakpointWidthState = 390;
    args.boardFileId = "board-file";
    mountPreview(CLASS_AUTHORED_LAYOUT_FIXTURE, "index.html::bp-390");

    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    const updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(updatedContent).not.toBeNull();
    const projection = buildCodeLayerProjection(updatedContent!, {
      source: { kind: "design-file", fileId: "index.html" },
    });
    const movedNode = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
    );
    expect(movedNode?.parentId).toBe(targetId);
    expect(movedNode?.classes).toContain("stylesheet-absolute");
    expect(movedNode?.style.position).toBe("relative !important");
    expect(movedNode?.style.left).toBe("auto !important");
    expect(movedNode?.style.top).toBe("auto !important");
  });

  it("resolves live layout facts from the board surface iframe", () => {
    const { args, targetId, draggedId } = buildArgs(
      CLASS_AUTHORED_LAYOUT_FIXTURE,
      "moving",
      "workspace",
    );
    args.boardFileId = "index.html";
    mountBoardPreview(CLASS_AUTHORED_LAYOUT_FIXTURE);

    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    const updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(updatedContent).not.toBeNull();
    const movedNode = buildCodeLayerProjection(updatedContent!, {
      source: { kind: "design-file", fileId: "index.html" },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
    );
    expect(movedNode?.parentId).toBe(targetId);
    expect(movedNode?.style.position).toBe("relative !important");
    expect(movedNode?.style.left).toBe("auto !important");
    expect(movedNode?.style.top).toBe("auto !important");
  });

  it("keeps an absolute Frame as a containing block when forcing it into flow", () => {
    const frameFixture = `<html><head><style>
.regular-parent { display: block; }
.stylesheet-absolute { position: absolute; left: 30px; top: 40px; width: 60px; height: 40px; }
.stylesheet-flow { display: flex; }
</style></head><body>
  <section class="regular-parent"><section data-an-primitive="frame" data-agent-native-node-id="moving-frame" class="stylesheet-absolute"><div data-agent-native-node-id="nested-absolute" style="position:absolute;left:8px;top:9px"></div></section></section>
  <section data-agent-native-node-id="workspace" class="stylesheet-flow"></section>
</body></html>`;
    const { args, targetId, draggedId } = buildArgs(
      frameFixture,
      "moving-frame",
      "workspace",
    );
    const iframe = mountPreview(frameFixture, "index.html");

    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    const updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(updatedContent).not.toBeNull();
    const projection = buildCodeLayerProjection(updatedContent!, {
      source: { kind: "design-file", fileId: "index.html" },
    });
    const movedFrame = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "moving-frame",
    );
    expect(movedFrame?.parentId).toBe(targetId);
    expect(movedFrame?.style.position).toBe("relative !important");
    expect(movedFrame?.style.left).toBe("auto !important");
    iframe.contentDocument!.open();
    iframe.contentDocument!.write(updatedContent!);
    iframe.contentDocument!.close();
    const liveFrame = iframe.contentDocument!.querySelector(
      '[data-agent-native-node-id="moving-frame"]',
    );
    const liveDescendant = iframe.contentDocument!.querySelector(
      '[data-agent-native-node-id="nested-absolute"]',
    );
    expect(
      iframe.contentDocument!.defaultView!.getComputedStyle(liveFrame!)
        .position,
    ).toBe("relative");
    expect(
      iframe.contentDocument!.defaultView!.getComputedStyle(liveDescendant!)
        .position,
    ).toBe("absolute");
  });

  it("keeps a forced non-Frame containing block for nested absolute children", () => {
    const fixture = `<html><head><style>
.regular-parent { display: block; }
.stylesheet-absolute { position: absolute; left: 30px; top: 40px; width: 60px; height: 40px; }
.stylesheet-flow { display: flex; }
</style></head><body>
  <section class="regular-parent"><section data-agent-native-node-id="moving-container" class="stylesheet-absolute"><div data-agent-native-node-id="nested-absolute" style="position:absolute;right:8px;bottom:9px;width:4px;height:5px"></div></section></section>
  <section data-agent-native-node-id="workspace" class="stylesheet-flow"></section>
</body></html>`;
    const { args, targetId, draggedId } = buildArgs(
      fixture,
      "moving-container",
      "workspace",
    );
    mountPreview(fixture, "index.html");

    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    const updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(updatedContent).not.toBeNull();
    const projection = buildCodeLayerProjection(updatedContent!, {
      source: { kind: "design-file", fileId: "index.html" },
    });
    const movedContainer = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "moving-container",
    );
    const nested = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "nested-absolute",
    );
    expect(movedContainer?.style.position).toBe("relative !important");
    expect(movedContainer?.style.left).toBe("auto !important");
    expect(movedContainer?.style.right).toBe("auto !important");
    expect(nested?.style).toMatchObject({
      position: "absolute",
      right: "8px",
      bottom: "9px",
    });
  });

  it("preserves Ignore auto layout from a stylesheet-authored source parent", () => {
    const ignoredFixture = `<html><head><style>
.source-layout { display: flex; }
.css-absolute { position: absolute; left: 24px; top: 32px; }
</style></head><body>
  <section class="source-layout"><div data-agent-native-node-id="ignored" class="css-absolute" style="position:absolute;left:24px;top:32px">Ignored</div></section>
  <section data-agent-native-node-id="workspace" class="flex"></section>
</body></html>`;
    const { args, targetId, draggedId } = buildArgs(
      ignoredFixture,
      "ignored",
      "workspace",
    );
    const iframe = mountPreview(ignoredFixture, "index.html");

    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    const updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(updatedContent).not.toBeNull();
    const movedNode = buildCodeLayerProjection(updatedContent!, {
      source: { kind: "design-file", fileId: "index.html" },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "ignored",
    );
    expect(movedNode?.parentId).toBe(targetId);
    expect(movedNode?.classes).toContain("css-absolute");
    expect(movedNode?.style.position).toBe("absolute");
    expect(updatedContent).not.toContain("position: static !important");
    iframe.contentDocument!.open();
    iframe.contentDocument!.write(updatedContent!);
    iframe.contentDocument!.close();
    const liveNode = iframe.contentDocument!.querySelector(
      '[data-agent-native-node-id="ignored"]',
    );
    expect(
      iframe.contentDocument!.defaultView!.getComputedStyle(liveNode!).position,
    ).toBe("absolute");
  });

  it("uses the exact structural alias for duplicate authored IDs", () => {
    const rawDuplicateFixture = `<html><head><style>
.freeform { display: block; }
.flow-parent { display: flex; }
.absolute-paint { position: absolute; left: 12px; top: 18px; }
</style></head><body>
  <section class="freeform"><button data-agent-native-node-id="reused" class="absolute-paint">First</button></section>
  <section class="freeform"><button data-agent-native-node-id="reused" class="absolute-paint">Second</button></section>
  <section data-agent-native-node-id="workspace" class="flow-parent"></section>
</body></html>`;
    const duplicateFixture = publishFixture("index.html", rawDuplicateFixture);
    const canonicalProjection = buildCodeLayerProjection(duplicateFixture, {
      source: { kind: "design-file", fileId: "index.html" },
    });
    const canonicalSecondId = canonicalProjection.nodes.find(
      (node) => node.tag === "button" && node.textSnippet === "Second",
    )?.dataAttributes["data-agent-native-node-id"];
    expect(canonicalSecondId).toBeTruthy();
    expect(canonicalSecondId).not.toBe("reused");
    const { args, targetId, draggedId } = buildArgs(
      duplicateFixture,
      canonicalSecondId!,
      "workspace",
    );
    mountPreview(duplicateFixture, "index.html");

    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    const updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(updatedContent).not.toBeNull();
    const projection = buildCodeLayerProjection(updatedContent!, {
      source: { kind: "design-file", fileId: "index.html" },
    });
    const first = projection.nodes.find(
      (node) => node.tag === "button" && node.textSnippet === "First",
    );
    const second = projection.nodes.find(
      (node) => node.tag === "button" && node.textSnippet === "Second",
    );
    expect(first?.parentId).not.toBe(targetId);
    expect(second?.parentId).toBe(targetId);
    expect(second?.style.position).toBe("relative !important");
  });

  it.each([
    ["authored ids", false],
    ["stable node ids", true],
  ])(
    "refuses a missing selected duplicate by %s instead of using its twin",
    (_label, duplicateStableIds) => {
      const firstStableId = duplicateStableIds ? "reused" : "first";
      const secondStableId = duplicateStableIds ? "reused" : "second";
      const firstAuthoredId = duplicateStableIds
        ? "first-authored"
        : "duplicate";
      const secondAuthoredId = duplicateStableIds
        ? "second-authored"
        : "duplicate";
      const duplicateFixture = `<html><head><style>
.freeform { display:block; position:relative; }
.auto-parent { display:flex; position:relative; }
.workspace { display:flex; }
</style></head><body>
  <section class="freeform"><button id="${firstAuthoredId}" data-agent-native-node-id="${firstStableId}" style="position:absolute;left:11px;top:13px">First</button></section>
  <section class="auto-parent"><button id="${secondAuthoredId}" data-agent-native-node-id="${secondStableId}" style="position:fixed;left:29px;top:31px">Second</button></section>
  <section data-agent-native-node-id="workspace" class="workspace"></section>
</body></html>`;
      const { args, targetId, draggedId } = buildArgs(
        duplicateFixture,
        secondStableId,
        "workspace",
        duplicateStableIds ? 1 : 0,
      );
      const iframe = mountPreview(duplicateFixture, "index.html");
      const selectedPath =
        args.codeLayerOwnerByNodeId.get(draggedId)?.node.path;
      expect(selectedPath).toBeTruthy();
      iframe.contentDocument!.querySelector(selectedPath!)?.remove();

      runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
        draggedIds: [draggedId],
        targetId,
        placement: "inside",
      });

      expect(
        (args as any).__getUpdatedContent(),
        "a duplicate that vanished from its owner iframe must not resolve to its surviving twin",
      ).toBeNull();
    },
  );

  it("refuses a present iframe whose document is unreadable instead of using source fallback", () => {
    const { args, targetId, draggedId } = buildArgs(
      CLASS_AUTHORED_LAYOUT_FIXTURE,
      "moving",
      "workspace",
    );
    const iframe = mountPreview(CLASS_AUTHORED_LAYOUT_FIXTURE, "index.html");
    Object.defineProperty(iframe, "contentDocument", { get: () => null });

    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    expect((args as any).__getUpdatedContent()).toBeNull();
  });

  it("refuses a stale exact live owner instead of falling back to a selector guess", () => {
    const { args, targetId, draggedId } = buildArgs(
      CLASS_AUTHORED_LAYOUT_FIXTURE,
      "moving",
      "workspace",
    );
    mountPreview("<body><p>stale preview</p></body>", "index.html");

    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    expect((args as any).__getUpdatedContent()).toBeNull();
  });

  it("honors inline display:block over a flow utility class", () => {
    const blockFixture = `<body>
  <section data-agent-native-node-id="origin" style="position:relative;width:300px;height:200px">
    <div data-agent-native-node-id="moving" style="position:absolute;left:30px;top:40px;width:60px;height:40px">Moved</div>
  </section>
  <section data-agent-native-node-id="workspace" class="flex" style="display:block;width:700px;height:300px"></section>
</body>`;
    const { args, targetId, draggedId } = buildArgs(
      blockFixture,
      "moving",
      "workspace",
    );

    runLayerMove({ ...args, canMoveLayer: () => true } as LayerMoveArgs, {
      draggedIds: [draggedId],
      targetId,
      placement: "inside",
    });

    const updatedContent = (args as any).__getUpdatedContent() as string | null;
    expect(updatedContent).not.toBeNull();
    const movedNode = buildCodeLayerProjection(updatedContent!, {
      source: { kind: "design-file", fileId: "index.html" },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
    );
    expect(movedNode?.parentId).toBe(targetId);
    expect(movedNode?.style.position).toBe("absolute");
  });
});
