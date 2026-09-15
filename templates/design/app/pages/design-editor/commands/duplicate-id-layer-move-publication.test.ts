// @vitest-environment happy-dom

import { createRequire } from "node:module";

import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { sourceContentHash } from "@shared/source-workspace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runApplyFileContentUpdate } from "@/pages/design-editor/commands/apply-file-content-update";
import { runPublishCanonicalContent } from "@/pages/design-editor/commands/publish-canonical-content";
import type { PendingLocalFileContent } from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryEntry,
  ContentHistorySelectionAfterMap,
} from "@/pages/design-editor/history";
import { getContentHistoryChanges } from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

import { runLayerMove, type LayerMoveArgs } from "./layer-move";

const SOURCE_ID = "duplicate-source.html";
const TARGET_ID = "duplicate-target.html";
const ACTIVE_ID = "other-active.html";
const requireFromDesign = createRequire(import.meta.url);
const requireFromPlaywright = createRequire(
  requireFromDesign.resolve("@playwright/test"),
);
const { chromium } = requireFromPlaywright("playwright");

const rawSource =
  '<html><body><section class="source-frame" style="position:relative"><div id="duplicate" style="position:absolute;left:17px;top:29px">Chosen</div><div id="duplicate" style="position:absolute;left:71px;top:83px">Keep</div></section></body></html>';
const rawTarget =
  '<html><body><section class="target-frame" style="display:flex;flex-direction:column"><div id="duplicate">First anchor</div><div id="duplicate">Target anchor</div></section></body></html>';

let browser: any;

function file(id: string, content: string): DesignFile {
  return {
    id,
    filename: id,
    fileType: "html",
    content,
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
  };
}

function nodeByText(content: string, fileId: string, text: string) {
  const projection = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId },
  });
  const node = projection.nodes.find(
    (candidate) =>
      candidate.tag === "div" &&
      candidate.source !== null &&
      content
        .slice(candidate.source.contentStart, candidate.source.contentEnd)
        .includes(text),
  );
  if (!node) throw new Error(`Could not find ${text} in ${fileId}`);
  return { node, projection };
}

function mountPreview(content: string, fileId: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-screen-iframe-id", fileId);
  document.body.append(iframe);
  const preview = iframe.contentDocument;
  if (!preview) throw new Error(`Preview document unavailable for ${fileId}`);
  preview.open();
  preview.write(content);
  preview.close();
  return preview;
}

function moveElementBeforeSibling(
  preview: Document,
  stableId: string,
  siblingStableId: string,
) {
  const moved = preview.querySelector(
    `[data-agent-native-node-id="${stableId}"]`,
  );
  const sibling = preview.querySelector(
    `[data-agent-native-node-id="${siblingStableId}"]`,
  );
  if (!moved?.parentElement || !sibling?.parentElement) {
    throw new Error("Could not find live nodes for the same-count reorder");
  }
  sibling.parentElement.insertBefore(moved, sibling);
}

describe("duplicate authored IDs through publication, Layers move, and render", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    document.body.replaceChildren();
  });

  it("moves the intended published node after a same-count live reorder and saves renderable bytes", async () => {
    const saves: Array<{
      fileId: string;
      content: string;
      options: {
        expectedVersionHash: string;
        identityMigrationSourceContent?: string;
      };
    }> = [];
    const pending = new Map<string, PendingLocalFileContent>();
    const persisted = new Map<string, string>();
    const publishArgs = {
      canEditDesignRef: { current: true },
      pendingLocalFileContentsRef: { current: pending },
      cancelIdentityMigration: (fileId: string) => pending.delete(fileId),
      queueFileContentSave: (
        fileId: string,
        content: string,
        options: {
          expectedVersionHash: string;
          syncCollab: boolean;
          immediate: boolean;
          identityMigrationSourceContent: string;
        },
      ) => {
        saves.push({ fileId, content, options });
        pending.set(fileId, {
          content,
          startedAt: Date.now(),
          identityMigrationSourceContent:
            options.identityMigrationSourceContent,
        });
        persisted.set(fileId, content);
      },
    };

    const publishedSource = runPublishCanonicalContent(
      publishArgs,
      SOURCE_ID,
      rawSource,
    );
    const publishedTarget = runPublishCanonicalContent(
      publishArgs,
      TARGET_ID,
      rawTarget,
    );
    expect(publishedSource).not.toBe(rawSource);
    expect(publishedTarget).not.toBe(rawTarget);
    expect(publishedSource.match(/id="duplicate"/g)).toHaveLength(2);
    expect(publishedTarget.match(/id="duplicate"/g)).toHaveLength(2);
    expect(saves.map((save) => save.fileId)).toEqual([SOURCE_ID, TARGET_ID]);
    expect(saves[0]?.options.expectedVersionHash).toBe(
      sourceContentHash(rawSource),
    );
    expect(saves[1]?.options.expectedVersionHash).toBe(
      sourceContentHash(rawTarget),
    );

    const sourceLookup = nodeByText(publishedSource, SOURCE_ID, "Chosen");
    const keepLookup = nodeByText(publishedSource, SOURCE_ID, "Keep");
    const firstAnchorLookup = nodeByText(
      publishedTarget,
      TARGET_ID,
      "First anchor",
    );
    const targetAnchorLookup = nodeByText(
      publishedTarget,
      TARGET_ID,
      "Target anchor",
    );
    const chosenId =
      sourceLookup.node.dataAttributes["data-agent-native-node-id"]!;
    const keepId = keepLookup.node.dataAttributes["data-agent-native-node-id"]!;
    const firstAnchorId =
      firstAnchorLookup.node.dataAttributes["data-agent-native-node-id"]!;
    const targetAnchorId =
      targetAnchorLookup.node.dataAttributes["data-agent-native-node-id"]!;
    expect(new Set([chosenId, keepId]).size).toBe(2);
    expect(new Set([firstAnchorId, targetAnchorId]).size).toBe(2);

    const sourcePreview = mountPreview(publishedSource, SOURCE_ID);
    const targetPreview = mountPreview(publishedTarget, TARGET_ID);
    moveElementBeforeSibling(sourcePreview, keepId, chosenId);
    moveElementBeforeSibling(targetPreview, targetAnchorId, firstAnchorId);
    expect(sourcePreview.querySelectorAll('[id="duplicate"]').length).toBe(2);
    expect(targetPreview.querySelectorAll('[id="duplicate"]').length).toBe(2);

    let designState: { files: DesignFile[] } = {
      files: [
        file(SOURCE_ID, publishedSource),
        file(TARGET_ID, publishedTarget),
        file(ACTIVE_ID, "<html><body>active</body></html>"),
      ],
    };
    const screenContents = new Map(persisted);
    const applyArgs = {
      acknowledgeAuthoritativeClipboardMutation: () => {},
      activeFile: file(ACTIVE_ID, designState.files[2]!.content),
      applyFileContentUpdate: (fileId: string, content: string) => {
        persisted.set(fileId, content);
      },
      applyLocalContentUpdate: () => ({ status: "refused" as const }),
      canEditDesignRef: { current: true },
      cancelQueuedFileContentSave: () => {},
      clearPendingLocalFileContent: (fileId: string) => pending.delete(fileId),
      files: designState.files,
      getScreenContent: (fileId: string) => screenContents.get(fileId) ?? "",
      id: "design-project",
      markPendingLocalFileContent: (
        fileId: string,
        content: string,
        _updatedAt?: string | null,
        identityMigrationSourceContent?: string,
      ) => {
        pending.set(fileId, {
          content,
          startedAt: Date.now(),
          identityMigrationSourceContent,
        });
      },
      overviewIsSynced: false,
      overviewPresenceFileId: null,
      overviewYdoc: null,
      queryClient: {
        setQueryData: (_key: unknown, updater: (old: unknown) => unknown) => {
          designState = updater(designState) as typeof designState;
          for (const updated of designState.files) {
            if (updated.id === SOURCE_ID || updated.id === TARGET_ID) {
              screenContents.set(updated.id, updated.content);
            }
          }
        },
      },
      queueFileContentSave: (
        fileId: string,
        content: string,
        options: { expectedVersionHash: string },
      ) => {
        saves.push({ fileId, content, options });
        persisted.set(fileId, content);
        screenContents.set(fileId, content);
      },
      recordContentHistoryEntry: () => {},
      suppressContentHistoryRef: { current: false },
      t: (key: string) => key,
    };

    const sourceProjection = sourceLookup.projection;
    const targetProjection = targetAnchorLookup.projection;
    const owners: LayerMoveArgs["codeLayerOwnerByNodeId"] = new Map();
    for (const node of sourceProjection.nodes) {
      owners.set(node.id, {
        fileId: SOURCE_ID,
        node,
        sourceProjection,
        tree: buildCodeLayerTree(sourceProjection),
        runtimeOnly: false,
      });
    }
    for (const node of targetProjection.nodes) {
      owners.set(node.id, {
        fileId: TARGET_ID,
        node,
        sourceProjection: targetProjection,
        tree: buildCodeLayerTree(targetProjection),
        runtimeOnly: false,
      });
    }
    const selectedAfterMove: string[][] = [];
    const contentUndoStackRef = { current: [] as ContentHistoryEntry[] };
    const contentHistorySelectionAfterRef = {
      current: new WeakMap() as ContentHistorySelectionAfterMap,
    };
    const layerArgs = {
      activeFile: file(ACTIVE_ID, designState.files[2]!.content),
      activeFileId: ACTIVE_ID,
      applyFileContentUpdate: (
        fileId: string,
        content: string,
        options?: object,
      ) => {
        return runApplyFileContentUpdate(
          applyArgs as never,
          fileId,
          content,
          options,
        );
      },
      canEditDesign: true,
      canMoveLayer: () => true,
      codeLayerOwnerByNodeId: owners,
      contentHistorySelectionAfterRef,
      contentUndoStackRef,
      effectiveCodeLayerState: {
        lockedIds: new Set<string>(),
        hiddenIds: new Set<string>(),
      },
      files: designState.files,
      getFreshActiveContent: () => designState.files[2]!.content,
      getScreenContent: (fileId: string) => screenContents.get(fileId) ?? "",
      handleLayerMoveToScreen: () => {},
      handleScreenLayerMove: () => {},
      overviewSelectedScreenIds: [SOURCE_ID],
      recordContentHistoryEntry: (entry: ContentHistoryEntry) =>
        contentUndoStackRef.current.push(entry),
      recordLocalContentHistoryEntry: () => {},
      remapMotionTracksForClone: () => {},
      runtimeStructureMoveRevisionRef: { current: 0 },
      sendRuntimeLayerMoveSemanticHandoff: () => false,
      setExpandedLayerIds: () => {},
      setRuntimeStructureMoveRequest: () => {},
      setSelectedElement: () => {},
      setSelectedLayerIdsState: (
        update: string[] | ((previous: string[]) => string[]),
      ) => {
        selectedAfterMove.push(
          typeof update === "function" ? update([]) : update,
        );
      },
      t: (key: string) => key,
      viewModeRef: { current: "overview" as const },
      visualScreenFileIds: new Set<string>(),
    };

    runLayerMove(layerArgs, {
      draggedIds: [sourceLookup.node.id],
      targetId: targetAnchorLookup.node.id,
      placement: "after",
    });

    const savedSource = persisted.get(SOURCE_ID)!;
    const savedTarget = persisted.get(TARGET_ID)!;
    expect(savedSource).toContain("Keep");
    expect(savedSource).not.toContain("Chosen");
    expect(savedTarget).toContain("Chosen");
    expect(savedTarget).toContain('id="duplicate"');
    expect(selectedAfterMove).toHaveLength(1);
    expect(saves.slice(2).map((save) => save.fileId)).toEqual([
      SOURCE_ID,
      TARGET_ID,
    ]);
    expect(saves[2]?.options.expectedVersionHash).toBe(
      sourceContentHash(publishedSource),
    );
    expect(saves[3]?.options.expectedVersionHash).toBe(
      sourceContentHash(publishedTarget),
    );

    const savedProjection = buildCodeLayerProjection(savedTarget, {
      source: { kind: "design-file", fileId: TARGET_ID },
    });
    const chosen = savedProjection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === chosenId,
    );
    expect(chosen).toBeDefined();
    expect(selectedAfterMove).toEqual([[chosen!.id]]);
    expect(chosen?.attributes.id).toBe("duplicate");
    const moveEntry = contentUndoStackRef.current[0];
    expect(moveEntry).toBeDefined();
    const selectionAfterMove = contentHistorySelectionAfterRef.current.get(
      moveEntry!,
    );
    expect(selectionAfterMove).toMatchObject({
      activeFileId: ACTIVE_ID,
      overviewSelectedScreenIds: [SOURCE_ID],
      selectedLayerIds: [chosen!.id],
    });
    expect(selectionAfterMove?.sourceContentByFileId).toEqual({
      [TARGET_ID]: savedTarget,
    });
    expect(selectionAfterMove?.sourceContentByFileId?.[TARGET_ID]).toBe(
      savedTarget,
    );
    expect(
      getContentHistoryChanges(moveEntry!).map(({ fileId, after }) => ({
        fileId,
        after,
      })),
    ).toEqual([
      { fileId: SOURCE_ID, after: savedSource },
      { fileId: TARGET_ID, after: savedTarget },
    ]);

    const page = await browser.newPage();
    try {
      await page.setContent(savedTarget);
      const rendered = await page
        .locator(".target-frame")
        .locator(":scope > div")
        .evaluateAll((elements: HTMLElement[]) =>
          elements.map((element) => ({
            text: element.textContent?.trim(),
            stableId: element.getAttribute("data-agent-native-node-id"),
            authoredId: element.getAttribute("id"),
          })),
        );
      expect(
        rendered.map((element: { text?: string }) => element.text),
      ).toEqual(["First anchor", "Target anchor", "Chosen"]);
      expect(rendered[2]).toMatchObject({
        stableId: chosenId,
        authoredId: "duplicate",
      });
    } finally {
      await page.close();
    }
  });
});
