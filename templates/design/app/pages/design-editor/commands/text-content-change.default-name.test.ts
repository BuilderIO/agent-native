// @vitest-environment happy-dom
//
// canvas-primitive-insert.ts's appendCanvasPrimitiveToHtml (and the
// html-layer-positioning.ts attribute writer this pulls in) early-return
// null under `typeof window === "undefined"` (the default node test
// environment), so this needs a real DOM.
import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import {
  runTextContentChange,
  type TextContentChangeArgs,
} from "./text-content-change";

function buildArgs(
  content: string,
  isPendingCreation: boolean,
): {
  args: TextContentChangeArgs;
  nodeId: string;
  getContent: () => string;
} {
  let stored = content;
  const activeFile: DesignFile = {
    id: "index.html",
    filename: "index.html",
    fileType: "html",
    content,
    createdAt: "",
    updatedAt: "",
  };
  const nodeId = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId: "index.html" },
  }).nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "t1",
  )!.id;

  const args: TextContentChangeArgs = {
    activeCanvasSourceType: "inline",
    activeFile,
    applyLocalContentUpdate: (nextContent) => {
      const publication = prepareCanonicalSourceContent(nextContent, {
        fileId: activeFile.id,
        fileType: activeFile.fileType,
      });
      stored = publication.content;
      return { status: "accepted", ...publication };
    },
    canEditDesign: true,
    // Mirrors finalizePendingTextCreation's own contract: true only when
    // this exact node is the one whose creation is being finalized.
    finalizePendingTextCreation: (_fileId, nodeIds) =>
      isPendingCreation && nodeIds.some((id) => id === nodeId),
    getFreshActiveContent: () => stored,
    liveScreenSnapshotsById: {},
    recordPendingLiveTextEdit: () => {},
    setActiveTool: () => {},
    setMode: () => {},
    setSelectedElement: () => {},
    setSelectedLayerIdsState: () => {},
    t: (key) => key,
    updateLiveScreenSnapshotContent: () => false,
  };

  return { args, nodeId, getContent: () => stored };
}

describe("runTextContentChange default text-layer naming", () => {
  it("names a freshly created text layer after its typed content", () => {
    // The draft primitive is committed with an empty draft and the "Text"
    // placeholder name (primitiveLayerName's text case), exactly as
    // appendCanvasPrimitiveToHtml stamps it at creation.
    const content = `<body><div data-agent-native-node-id="t1" data-agent-native-layer-name="Text"></div></body>`;
    const { args, nodeId, getContent } = buildArgs(content, true);

    runTextContentChange(args, `[data-agent-native-node-id="t1"]`, "Button");

    const nextNode = buildCodeLayerProjection(getContent(), {
      source: { kind: "design-file", fileId: "index.html" },
    }).nodes.find((node) => node.id === nodeId)!;
    expect(nextNode.dataAttributes["data-agent-native-layer-name"]).toBe(
      "Button",
    );
  });

  it("does not rename an already-named text layer on a later edit", () => {
    const content = `<body><div data-agent-native-node-id="t1" data-agent-native-layer-name="Label">Button</div></body>`;
    const { args, nodeId, getContent } = buildArgs(content, false);

    runTextContentChange(args, `[data-agent-native-node-id="t1"]`, "Sign up");

    const nextNode = buildCodeLayerProjection(getContent(), {
      source: { kind: "design-file", fileId: "index.html" },
    }).nodes.find((node) => node.id === nodeId)!;
    expect(nextNode.dataAttributes["data-agent-native-layer-name"]).toBe(
      "Label",
    );
    expect(nextNode.textSnippet?.trim()).toBe("Sign up");
  });
});
