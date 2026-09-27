// @vitest-environment happy-dom
//
// canvas-primitive-insert.ts's appendCanvasPrimitiveToHtml (and the
// html-layer-positioning.ts attribute writer this pulls in) early-return
// null under `typeof window === "undefined"` (the default node test
// environment), so this needs a real DOM.
import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import { elementInfoForOwnedCodeLayerNode } from "@/pages/design-editor/code-layer-state";
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
    prepareTextCreationFinalization: (_fileId, nodeIds) => ({
      isCreationCommit:
        isPendingCreation && nodeIds.some((id) => id === nodeId),
      historyHandled: false,
      confirm: () => {},
    }),
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

describe("runTextContentChange selected live element", () => {
  it("uses the source-layer identity when the bridge selector no longer resolves", () => {
    const content = `<body><div data-agent-native-node-id="t1">Before</div><div data-agent-native-node-id="t2">Other</div></body>`;
    const { args, nodeId, getContent } = buildArgs(content, false);
    const selectedElement: { current: ElementInfo | null } = { current: null };
    const sourceIdentityInfo: ElementInfo = {
      tagName: "span",
      sourceId: "stale-runtime-id",
      selector: `[data-agent-native-node-id="missing"]`,
      sourceLayerIdentity: { screenId: "index.html", nodeId },
      classes: [],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 100, height: 24 },
      isFlexChild: false,
      isFlexContainer: false,
    };

    expect(
      runTextContentChange(
        {
          ...args,
          setSelectedElement: (update) => {
            selectedElement.current =
              typeof update === "function"
                ? update(selectedElement.current)
                : update;
          },
        },
        sourceIdentityInfo.selector!,
        "After",
        sourceIdentityInfo,
      ),
    ).toBe("accepted");

    const projection = buildCodeLayerProjection(getContent(), {
      source: { kind: "design-file", fileId: "index.html" },
    });
    expect(
      projection.nodes.find((node) => node.id === nodeId)?.textSnippet,
    ).toContain("After");
    expect(
      projection.nodes.find(
        (node) => node.dataAttributes["data-agent-native-node-id"] === "t2",
      )?.textSnippet,
    ).toContain("Other");
    expect(selectedElement.current?.sourceLayerIdentity).toEqual({
      screenId: "index.html",
      nodeId,
    });
  });

  it("retains the host layer identity and mixed style snapshot after the source commit", () => {
    const content = `<body><div data-agent-native-node-id="t1">Before</div></body>`;
    const { args, getContent } = buildArgs(content, false);
    const selectedElement: { current: ElementInfo | null } = { current: null };
    const liveElementInfo: ElementInfo = {
      tagName: "div",
      sourceId: "t1",
      selector: '[data-agent-native-node-id="t1"]',
      classes: [],
      computedStyles: { fontSize: "Mixed" },
      boundingRect: { x: 0, y: 0, width: 100, height: 24 },
      isFlexChild: false,
      isFlexContainer: false,
      portableStyleSnapshot: {
        version: 1,
        rootSourceId: "t1",
        nodes: [{ path: [], styles: { fontSize: "Mixed" } }],
      },
    };
    const selectionArgs: TextContentChangeArgs = {
      ...args,
      setSelectedElement: (update) => {
        selectedElement.current =
          typeof update === "function"
            ? update(selectedElement.current)
            : update;
      },
    };

    expect(
      runTextContentChange(
        selectionArgs,
        liveElementInfo.selector!,
        "After",
        liveElementInfo,
      ),
    ).toBe("accepted");

    const node = buildCodeLayerProjection(getContent(), {
      source: { kind: "design-file", fileId: "index.html" },
    }).nodes.find(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === "t1",
    )!;
    expect(selectedElement.current?.sourceLayerIdentity).toEqual({
      screenId: "index.html",
      nodeId: node.id,
    });
    expect(
      elementInfoForOwnedCodeLayerNode({
        info: selectedElement.current,
        node,
        ownerFileId: "index.html",
      }).computedStyles.fontSize,
    ).toBe("Mixed");
  });
});

describe("runTextContentChange rejected live-snapshot write", () => {
  it("keeps the creation record when the live snapshot write is rejected", () => {
    const content = `<body><div data-agent-native-node-id="t1" data-agent-native-layer-name="Text"></div></body>`;
    const { args } = buildArgs(content, true);
    const confirm = vi.fn();
    const rejected: TextContentChangeArgs = {
      ...args,
      liveScreenSnapshotsById: {
        "index.html": { html: content } as never,
      },
      updateLiveScreenSnapshotContent: () => false,
      prepareTextCreationFinalization: () => ({
        isCreationCommit: true,
        historyHandled: true,
        confirm,
      }),
    };

    runTextContentChange(
      rejected,
      `[data-agent-native-node-id="t1"]`,
      "Standalone",
    );

    expect(confirm).not.toHaveBeenCalled();
  });
});
