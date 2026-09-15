import { ensureCodeLayerNodeIdsInHtml } from "@shared/code-layer";
import { afterEach, expect, it } from "vitest";
import * as Y from "yjs";

import { runObserveCollabText } from "@/pages/design-editor/effects/observe-collab-text";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

const before = "<main><button>Before</button></main>";
const duplicateSource =
  '<main><button data-agent-native-node-id="shared">A</button><button data-agent-native-node-id="shared">B</button></main>';

afterEach(() => {
  // Each test owns its Y.Doc; no global event listeners are installed.
});

it("publishes canonical ID-repaired source to preview for a remote Yjs update", () => {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  ytext.insert(0, before);
  const expected = ensureCodeLayerNodeIdsInHtml(duplicateSource, {
    source: { kind: "design-file", fileId: "screen-a" },
  }).content;
  let previewContent = "";
  let acceptedContent: string | null = before;
  const collabFileId = { current: "screen-a" as string | null };
  const latest = { current: before as string | null };
  const lastLocal = { current: before as string | null };
  const cleanup = runObserveCollabText({
    publishCanonicalContent: (fileId, sourceContent, fileType) =>
      prepareCanonicalSourceContent(sourceContent, { fileId, fileType })
        .content,
    fileType: "html",
    activeFileId: "screen-a",
    agentActive: false,
    documentFileContentRef: { current: before },
    documentFileUpdatedAtRef: { current: "1" },
    isSynced: true,
    lastAppliedFileContentRef: { current: before },
    lastAppliedFileUpdatedAtRef: { current: "1" },
    lastLocalContentRef: lastLocal,
    latestActiveContentRef: latest,
    pendingLocalFileContentsRef: { current: new Map() },
    recordExternalContentHistoryCheckpoint: () => {},
    replacePreviewContent: (content) => {
      previewContent = content;
      return "applied";
    },
    setCollabContent: (update) => {
      acceptedContent =
        typeof update === "function" ? update(acceptedContent) : update;
    },
    setCollabContentFileId: (update) => {
      collabFileId.current =
        typeof update === "function" ? update(collabFileId.current) : update;
    },
    setContentRenderRevision: () => {},
    setHoveredElement: (update) =>
      typeof update === "function" ? update(null) : update,
    setSelectedElement: (update) =>
      typeof update === "function" ? update(null) : update,
    undoManagerRef: { current: null },
    ydoc,
  });

  ydoc.transact(
    () => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, duplicateSource);
    },
    { peer: true },
  );

  expect(acceptedContent).toBe(expected);
  expect(previewContent).toBe(expected);
  cleanup?.();
  ydoc.destroy();
});
