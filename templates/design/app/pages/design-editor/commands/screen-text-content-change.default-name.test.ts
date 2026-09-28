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
    prepareTextCreationFinalization: (_fileId, nodeIds) => ({
      isCreationCommit:
        isPendingCreation && nodeIds.some((id) => id === nodeId),
      historyHandled: false,
      confirm: () => {},
    }),
    getScreenContent: () => stored,
    handleTextContentChange: () => "accepted",
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

    const status = runScreenTextContentChange(
      refused,
      SCREEN_ID,
      `[data-agent-native-node-id="t1"]`,
      "Standalone",
    );

    expect(status).toBe("refused");
    expect(confirm).not.toHaveBeenCalled();
    expect(getContent()).toBe(content);
  });
});

describe("runScreenTextContentChange rejected live-snapshot write", () => {
  it("keeps the creation record when the live snapshot write is rejected", () => {
    const content = `<body><div data-agent-native-node-id="t1" data-agent-native-layer-name="Text"></div></body>`;
    const { args } = buildArgs(content, true);
    const confirm = vi.fn();
    const rejected: ScreenTextContentChangeArgs = {
      ...args,
      liveScreenSnapshotsById: {
        [SCREEN_ID]: { html: content } as never,
      },
      updateLiveScreenSnapshotContent: () => false,
      prepareTextCreationFinalization: () => ({
        isCreationCommit: true,
        historyHandled: true,
        confirm,
      }),
    };

    const status = runScreenTextContentChange(
      rejected,
      SCREEN_ID,
      `[data-agent-native-node-id="t1"]`,
      "Standalone",
    );

    expect(status).toBe("refused");
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("runScreenTextContentChange acceptance after a source transition", () => {
  it("reports an accepted live-snapshot write as accepted, with no source readback", () => {
    const content = `<body><div data-agent-native-node-id="t1" data-agent-native-layer-name="Text">Before</div></body>`;
    const capturedWhileLocalhost = { [SCREEN_ID]: { html: content } as never };
    const liveFileIds = new Set([SCREEN_ID]);
    const retainedAfterTransition = Object.fromEntries(
      Object.entries(capturedWhileLocalhost).filter(([fileId]) =>
        liveFileIds.has(fileId),
      ),
    );
    expect(retainedAfterTransition[SCREEN_ID]).toBeDefined();

    const { args } = buildArgs(content, true);
    const confirm = vi.fn();
    const getScreenContent = vi.fn(() => content);
    const transitioned: ScreenTextContentChangeArgs = {
      ...args,
      getScreenContent,
      overviewScreens: [{ id: SCREEN_ID, sourceType: "fusion" } as never],
      liveScreenSnapshotsById: retainedAfterTransition,
      updateLiveScreenSnapshotContent: () => true,
      prepareTextCreationFinalization: () => ({
        isCreationCommit: true,
        historyHandled: true,
        confirm,
      }),
    };

    const status = runScreenTextContentChange(
      transitioned,
      SCREEN_ID,
      `[data-agent-native-node-id="t1"]`,
      "Standalone",
    );

    expect(status).toBe("accepted");
    expect(confirm).toHaveBeenCalledOnce();
    expect(getScreenContent).not.toHaveBeenCalled();
  });
});

describe("runScreenTextContentChange selection identity", () => {
  it("uses the source-layer identity when the bridge selector no longer resolves", () => {
    const content = `<body><div data-agent-native-node-id="t1">Before</div><div data-agent-native-node-id="t2">Other</div></body>`;
    const { args, nodeId, getContent } = buildArgs(content, false);
    let selected: unknown = null;
    const sourceIdentityInfo = {
      tagName: "span",
      sourceId: "stale-runtime-id",
      selector: `[data-agent-native-node-id="missing"]`,
      sourceLayerIdentity: { screenId: SCREEN_ID, nodeId },
      classes: [],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 95, height: 19 },
      isFlexChild: false,
      isFlexContainer: false,
    };

    expect(
      runScreenTextContentChange(
        {
          ...args,
          setSelectedElement: ((update: (prev: unknown) => unknown) => {
            selected = update(null);
          }) as never,
        },
        SCREEN_ID,
        sourceIdentityInfo.selector,
        "After",
        sourceIdentityInfo,
      ),
    ).toBe("accepted");

    const projection = buildCodeLayerProjection(getContent(), {
      source: { kind: "design-file", fileId: SCREEN_ID },
    });
    expect(
      projection.nodes.find((node) => node.id === nodeId)?.textSnippet,
    ).toContain("After");
    expect(
      projection.nodes.find(
        (node) => node.dataAttributes["data-agent-native-node-id"] === "t2",
      )?.textSnippet,
    ).toContain("Other");
    expect(selected).toMatchObject({
      sourceLayerIdentity: { screenId: SCREEN_ID, nodeId },
    });
  });

  it("keeps the committed text's layer identity so the inspector can size it", () => {
    const content = `<body><div data-agent-native-node-id="t1" data-agent-native-layer-name="Label">Button</div></body>`;
    const { args, nodeId } = buildArgs(content, false);
    let selected: unknown = null;
    const previous = {
      selector: `[data-agent-native-node-id="t1"]`,
      sourceLayerIdentity: { screenId: SCREEN_ID, nodeId },
    };
    runScreenTextContentChange(
      {
        ...args,
        setSelectedElement: ((update: (prev: unknown) => unknown) => {
          selected = update(previous);
        }) as never,
      },
      SCREEN_ID,
      `[data-agent-native-node-id="t1"]`,
      "Sign up",
      {
        selector: `[data-agent-native-node-id="t1"]`,
        boundingRect: { x: 0, y: 0, width: 95, height: 19 },
        computedStyles: { width: "95px" },
      } as never,
    );
    expect(selected).toMatchObject({
      sourceLayerIdentity: { screenId: SCREEN_ID, nodeId },
      boundingRect: { width: 95, height: 19 },
    });
  });
});
