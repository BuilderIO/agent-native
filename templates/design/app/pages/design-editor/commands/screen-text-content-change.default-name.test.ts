// @vitest-environment happy-dom
//
// Same DOM requirement as text-content-change.default-name.test.ts:
// html-layer-positioning.ts's attribute writer early-returns null under
// `typeof window === "undefined"`.
import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import {
  runScreenTextContentChange,
  type ScreenTextContentChangeArgs,
} from "./screen-text-content-change";

const SCREEN_ID = "board.html";

function buildArgs(
  content: string,
  isPendingCreation: boolean,
): {
  args: ScreenTextContentChangeArgs;
  nodeId: string;
  getContent: () => string;
} {
  let stored = content;
  // A different id than SCREEN_ID: runScreenTextContentChange only takes
  // this file's own (unnamed) path when screenId !== activeFile.id — the
  // board is deliberately kept out of activeFileId on creation (see
  // primitive-created.ts's "Board guard"), so this is the path an actual
  // board text commit always takes.
  const activeFile: DesignFile = {
    id: "index.html",
    filename: "index.html",
    fileType: "html",
    content: "<body></body>",
    createdAt: "",
    updatedAt: "",
  };
  const nodeId = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId: SCREEN_ID },
  }).nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "t1",
  )!.id;

  const args: ScreenTextContentChangeArgs = {
    activeFile,
    applyFileContentUpdate: (fileId, nextContent) => {
      const publication = prepareCanonicalSourceContent(nextContent, {
        fileId,
        fileType: "html",
      });
      stored = publication.content;
      return { status: "accepted", ...publication };
    },
    canEditDesign: true,
    designSourceType: "inline",
    // Mirrors prepareTextCreationFinalization's own contract: only this exact
    // node's creation commit names the layer. historyHandled is deliberately
    // false — an unrelated write can leave the undo stack stale without making
    // this any less the creation's first commit, and the name must still land.
    prepareTextCreationFinalization: (_fileId, nodeIds) => ({
      isCreationCommit:
        isPendingCreation && nodeIds.some((id) => id === nodeId),
      historyHandled: false,
      confirm: () => {},
    }),
    getScreenContent: () => stored,
    handleTextContentChange: () => {},
    liveScreenSnapshotsById: {},
    overviewScreens: [],
    recordPendingLiveTextEdit: () => {},
    setActiveFileId: () => {},
    setActiveTool: () => {},
    setMode: () => {},
    setSelectedElement: () => {},
    setSelectedLayerIdsState: () => {},
    t: (key) => key,
    updateLiveScreenSnapshotContent: () => false,
  };

  return { args, nodeId, getContent: () => stored };
}

describe("runScreenTextContentChange default text-layer naming", () => {
  it("names a freshly created board text layer after its typed content", () => {
    // Same draft shape appendCanvasPrimitiveToHtml stamps at creation: empty
    // draft, "Text" placeholder name.
    const content = `<body><div data-agent-native-node-id="t1" data-agent-native-layer-name="Text"></div></body>`;
    const { args, nodeId, getContent } = buildArgs(content, true);

    runScreenTextContentChange(
      args,
      SCREEN_ID,
      `[data-agent-native-node-id="t1"]`,
      "Standalone",
    );

    const nextNode = buildCodeLayerProjection(getContent(), {
      source: { kind: "design-file", fileId: SCREEN_ID },
    }).nodes.find((node) => node.id === nodeId)!;
    expect(nextNode.dataAttributes["data-agent-native-layer-name"]).toBe(
      "Standalone",
    );
  });

  it("does not rename an already-named board text layer on a later edit", () => {
    const content = `<body><div data-agent-native-node-id="t1" data-agent-native-layer-name="Label">Button</div></body>`;
    const { args, nodeId, getContent } = buildArgs(content, false);

    runScreenTextContentChange(
      args,
      SCREEN_ID,
      `[data-agent-native-node-id="t1"]`,
      "Sign up",
    );

    const nextNode = buildCodeLayerProjection(getContent(), {
      source: { kind: "design-file", fileId: SCREEN_ID },
    }).nodes.find((node) => node.id === nodeId)!;
    expect(nextNode.dataAttributes["data-agent-native-layer-name"]).toBe(
      "Label",
    );
    expect(nextNode.textSnippet?.trim()).toBe("Sign up");
  });
});

describe("runScreenTextContentChange refused publication", () => {
  it("keeps the creation record when the publication is refused", () => {
    const content = `<body><div data-agent-native-node-id="t1" data-agent-native-layer-name="Text"></div></body>`;
    const { args, getContent } = buildArgs(content, true);
    const confirm = vi.fn();
    const refused: ScreenTextContentChangeArgs = {
      ...args,
      applyFileContentUpdate: () => ({ status: "refused" }) as never,
      prepareTextCreationFinalization: () => ({
        isCreationCommit: true,
        historyHandled: true,
        confirm,
      }),
    };

    runScreenTextContentChange(
      refused,
      SCREEN_ID,
      `[data-agent-native-node-id="t1"]`,
      "Standalone",
    );

    // Nothing published, so the creation still owns its pending history — and
    // the typed text is still owed. Consuming the record here left it in
    // neither the source nor the undo stack.
    expect(confirm).not.toHaveBeenCalled();
    expect(getContent()).toBe(content);
  });
});
