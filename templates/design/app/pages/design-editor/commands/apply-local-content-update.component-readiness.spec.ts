import { buildCodeLayerProjection } from "@shared/code-layer";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
  componentNodeIdMatches,
  isComponentInstance,
} from "@shared/component-model";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { ApplyLocalContentUpdateArgs } from "@/pages/design-editor/commands/apply-local-content-update";
import {
  createPendingLocalFileContent,
  restorePendingFileContent,
  shouldRetirePendingLocalFileContent,
  type PendingLocalFileContent,
} from "@/pages/design-editor/editor-state";
import type { DesignFile } from "@/pages/design-editor/types";

import { runApplyLocalContentUpdate } from "./apply-local-content-update";

const DESIGN_ID = "design-readiness";
const FILE_ID = "screen-readiness";
const QUERY_KEY = ["action", "get-design", { id: DESIGN_ID }] as const;

function mainSource(withInstance = false) {
  return `<main><section data-agent-native-node-id="main-root" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="card"><div data-agent-native-node-id="main-title">Card</div></section>${
    withInstance
      ? `<section data-agent-native-node-id="instance-root" data-agent-native-component="Card" ${COMPONENT_REF_ATTR}="card"><div data-agent-native-node-id="instance-title" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-title">Card</div></section>`
      : ""
  }</main>`;
}

function pendingEntry(
  current: PendingLocalFileContent | undefined,
  file: DesignFile | undefined,
  content: string,
  baseUpdatedAt?: string | null,
) {
  return createPendingLocalFileContent({
    current,
    file,
    content,
    baseUpdatedAt,
  });
}

describe("component details source readiness", () => {
  it("keeps a new clone gated through the cache echo and queued mark, then accepts the server ack", () => {
    const queryClient = new QueryClient();
    const originalFile: DesignFile = {
      id: FILE_ID,
      filename: "Screen 1",
      fileType: "html",
      content: mainSource(),
      createdAt: "C1",
      updatedAt: "T1",
    };
    queryClient.setQueryData(QUERY_KEY, { files: [originalFile] });
    const pendingByFile = new Map<string, PendingLocalFileContent>();

    const markPendingLocalFileContent = (
      fileId: string,
      content: string,
      baseUpdatedAt?: string | null,
    ) => {
      const cachedFile = queryClient
        .getQueryData<{ files: DesignFile[] }>(QUERY_KEY)
        ?.files.find((file) => file.id === fileId);
      const current = pendingByFile.get(fileId);
      pendingByFile.set(
        fileId,
        pendingEntry(current, cachedFile, content, baseUpdatedAt),
      );
    };
    const args: ApplyLocalContentUpdateArgs = {
      acknowledgeAuthoritativeClipboardMutation: vi.fn(),
      activeFile: originalFile,
      canEditDesignRef: { current: true },
      cancelQueuedFileContentSave: vi.fn(),
      clearPendingLocalFileContent: vi.fn(),
      collabContentFileIdRef: { current: FILE_ID },
      collabContentRef: { current: originalFile.content ?? "" },
      id: DESIGN_ID,
      isSynced: false,
      lastLocalContentRef: { current: originalFile.content ?? "" },
      latestActiveContentRef: { current: originalFile.content ?? "" },
      markPendingLocalFileContent,
      queryClient,
      queueFileContentSave: (fileId, content) => {
        markPendingLocalFileContent(fileId, content);
      },
      recordContentHistoryEntry: vi.fn(),
      recordLocalContentHistoryChangeFallback: vi.fn(),
      recordLocalContentHistoryEntry: vi.fn(),
      replacePreviewContent: () => "applied",
      setCollabContent: vi.fn(),
      setCollabContentFileId: vi.fn(),
      setContentRenderRevision: vi.fn(),
      suppressContentHistoryRef: { current: true },
      t: (key) => key,
      undoManagerRef: { current: null },
      viewModeRef: { current: "single" },
      ydoc: null,
    };
    const nextContent = mainSource(true);

    const result = runApplyLocalContentUpdate(args, nextContent, {
      skipPreview: true,
    });

    if (result.status !== "accepted") {
      throw new Error("The local component clone update was refused");
    }
    expect(result.status).toBe("accepted");
    const optimisticFile = queryClient
      .getQueryData<{ files: DesignFile[] }>(QUERY_KEY)
      ?.files.find((file) => file.id === FILE_ID)!;
    const pending = pendingByFile.get(FILE_ID)!;
    expect(optimisticFile.content).toBe(result.content);
    expect(optimisticFile.updatedAt).toBe("T1");
    expect(pending.content).toBe(result.content);
    expect(pending.baseContent).toBe(originalFile.content);
    expect(pending.baseUpdatedAt).toBe("T1");
    expect(shouldRetirePendingLocalFileContent(pending, optimisticFile)).toBe(
      false,
    );

    const optimisticProjection = buildCodeLayerProjection(result.content, {
      source: { kind: "design-file", fileId: FILE_ID },
    });
    const selectedInstance = optimisticProjection.nodes.find(
      (node) =>
        isComponentInstance(node) &&
        node.dataAttributes[COMPONENT_REF_ATTR] === "card",
    );
    expect(selectedInstance).toBeDefined();
    const selectedId =
      selectedInstance!.dataAttributes["data-agent-native-node-id"]!;
    const baselineProjection = buildCodeLayerProjection(pending.baseContent!, {
      source: { kind: "design-file", fileId: FILE_ID },
    });
    expect(
      baselineProjection.nodes.some(
        (node) =>
          isComponentInstance(node) && componentNodeIdMatches(node, selectedId),
      ),
    ).toBe(false);

    const acknowledgedFile = { ...optimisticFile, updatedAt: "T2" };
    queryClient.setQueryData(QUERY_KEY, { files: [acknowledgedFile] });
    expect(
      shouldRetirePendingLocalFileContent(
        pending,
        queryClient.getQueryData<{ files: DesignFile[] }>(QUERY_KEY)!.files[0]!,
      ),
    ).toBe(true);
    queryClient.clear();
  });

  it("keeps an existing component ready while its style edit is pending", () => {
    const source = mainSource(true);
    const file: DesignFile = {
      id: FILE_ID,
      filename: "Screen 1",
      fileType: "html",
      content: source,
      createdAt: "C1",
      updatedAt: "T1",
    };
    const pending = pendingEntry(
      undefined,
      file,
      source.replace("Card</div>", "Changed</div>"),
      "T1",
    );
    const selected = buildCodeLayerProjection(source, {
      source: { kind: "design-file", fileId: FILE_ID },
    }).nodes.find(
      (node) =>
        isComponentInstance(node) &&
        node.dataAttributes[COMPONENT_REF_ATTR] === "card",
    )!;
    const selectedId = selected.dataAttributes["data-agent-native-node-id"]!;
    const baselineProjection = buildCodeLayerProjection(pending.baseContent!, {
      source: { kind: "design-file", fileId: FILE_ID },
    });

    expect(
      baselineProjection.nodes.some(
        (node) =>
          isComponentInstance(node) && componentNodeIdMatches(node, selectedId),
      ),
    ).toBe(true);
  });

  it("rolls back only the rejected cache version and leaves newer source or draft bytes alone", () => {
    const base = mainSource();
    const rejected = mainSource(true);
    const file: DesignFile = {
      id: FILE_ID,
      filename: "Screen 1",
      fileType: "html",
      content: base,
      createdAt: "C1",
      updatedAt: "T1",
    };
    const pending = pendingEntry(undefined, file, rejected);
    const echoed = { ...file, content: rejected };
    expect(
      restorePendingFileContent({ files: [echoed] }, FILE_ID, pending, rejected)
        .files?.[0],
    ).toMatchObject({ content: base, updatedAt: "T1" });

    const newerSource = {
      ...echoed,
      content: "<main>Remote</main>",
      updatedAt: "T2",
    };
    expect(
      restorePendingFileContent(
        { files: [newerSource] },
        FILE_ID,
        pending,
        rejected,
      ).files?.[0],
    ).toBe(newerSource);

    const acceptedSameBytes = { ...echoed, updatedAt: "T2" };
    expect(
      restorePendingFileContent(
        { files: [acceptedSameBytes] },
        FILE_ID,
        pending,
        rejected,
      ).files?.[0],
    ).toBe(acceptedSameBytes);

    const newerDraft = pendingEntry(
      { ...pending, content: "<main>Newer local draft</main>" },
      echoed,
      "<main>Newer local draft</main>",
    );
    expect(
      restorePendingFileContent(
        { files: [echoed] },
        FILE_ID,
        newerDraft,
        rejected,
      ).files?.[0],
    ).toBe(echoed);
  });

  it("captures the cached server watermark when the first mark omits it", () => {
    const base = mainSource();
    const file: DesignFile = {
      id: FILE_ID,
      filename: "Screen 1",
      fileType: "html",
      content: base,
      createdAt: "C1",
      updatedAt: "T1",
    };
    const pending = pendingEntry(undefined, file, mainSource(true));

    expect(pending.baseUpdatedAt).toBe("T1");
    expect(
      shouldRetirePendingLocalFileContent(pending, {
        content: pending.content,
        updatedAt: "T1",
      }),
    ).toBe(false);
  });
});
