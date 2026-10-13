// @vitest-environment node

import { createRequire } from "node:module";

import {
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdsInHtml,
} from "@shared/code-layer";
import { normalizeScreenHtml } from "@shared/screen-annotation";
import { applySourceEdit } from "@shared/source-workspace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  captureHistorySelectionSources,
  prepareDeletedFileRestore,
  remapContentHistory,
  resolveHistorySelection,
} from "@/pages/design-editor/history-identity";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

const requireFromDesign = createRequire(import.meta.url);
const requireFromPlaywright = createRequire(
  requireFromDesign.resolve("@playwright/test"),
);
const { chromium } = requireFromPlaywright("playwright");

const ORIGINAL_FILE_ID = "screen-before-delete";
const RESTORED_FILE_ID = "screen-after-undo";
const RAW_HTML =
  '<main><button id="duplicate">Alpha</button><button id="duplicate">Beta</button><p class="bg-blue-600 p-2">Normalization witness</p></main>';

let browser: any;

function layerNode(content: string, fileId: string, text: string) {
  const node = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId },
  }).nodes.find(
    (candidate) =>
      candidate.source !== null &&
      content
        .slice(candidate.source.contentStart, candidate.source.contentEnd)
        .includes(text),
  );
  if (!node) throw new Error(`layer for ${text} not found in ${fileId}`);
  return node;
}

function selectionFor(fileId: string, content: string, text: string) {
  const node = layerNode(content, fileId, text);
  return captureHistorySelectionSources(
    {
      activeFileId: fileId,
      overviewSelectedScreenIds: [fileId],
      selectedLayerIds: [node.id],
    },
    { [fileId]: content },
  );
}

function selectedButtonText(
  content: string,
  fileId: string,
  selectedId: string,
) {
  const node = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId },
  }).nodes.find((candidate) => candidate.id === selectedId);
  if (!node?.source) throw new Error(`selected node ${selectedId} not found`);
  return content.slice(node.source.contentStart, node.source.contentEnd);
}

describe("helper-level duplicate raw-id source and history roundtrip", () => {
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("keeps the selected duplicate-id element through an AI source edit and delete-restore normalization", async () => {
    const stamped = ensureCodeLayerNodeIdsInHtml(RAW_HTML, {
      source: { kind: "design-file", fileId: ORIGINAL_FILE_ID },
    });
    const before = stamped.content;
    const originalButtons = buildCodeLayerProjection(before, {
      source: { kind: "design-file", fileId: ORIGINAL_FILE_ID },
    }).nodes.filter((node) => node.tag === "button");
    const originalStableIds = originalButtons.map(
      (node) => node.dataAttributes["data-agent-native-node-id"],
    );

    expect(stamped.changed).toBe(true);
    expect(before).not.toContain("data-an-text");
    expect(before).not.toContain("<span");
    expect(before.match(/id="duplicate"/g) ?? []).toHaveLength(2);
    expect(originalStableIds).toHaveLength(2);
    expect(new Set(originalStableIds).size).toBe(2);

    const aiEdit = applySourceEdit(before, {
      kind: "exact-replace",
      search: ">Beta</button>",
      replace: ">Beta revised</button>",
    });
    expect(aiEdit.changed).toBe(true);
    expect(aiEdit.editsApplied).toBe(1);
    const after = aiEdit.content;
    const afterButtons = buildCodeLayerProjection(after, {
      source: { kind: "design-file", fileId: ORIGINAL_FILE_ID },
    }).nodes.filter((node) => node.tag === "button");
    expect(
      afterButtons.map(
        (node) => node.dataAttributes["data-agent-native-node-id"],
      ),
    ).toEqual(originalStableIds);

    const beforeSelection = selectionFor(ORIGINAL_FILE_ID, before, "Beta");
    const afterSelection = selectionFor(
      ORIGINAL_FILE_ID,
      after,
      "Beta revised",
    );
    const change = { fileId: ORIGINAL_FILE_ID, before, after };
    const afterMap = new WeakMap<object, typeof afterSelection>();
    afterMap.set(change, afterSelection);

    const restore = prepareDeletedFileRestore({
      id: ORIGINAL_FILE_ID,
      content: after,
      fileType: "html",
    });
    const restoreIdMap = restore.mapNodeIds(RESTORED_FILE_ID);
    const restoredAfterButtons = buildCodeLayerProjection(restore.content, {
      source: { kind: "design-file", fileId: RESTORED_FILE_ID },
    }).nodes.filter((node) => node.tag === "button");
    expect(restore.content).not.toBe(after);
    expect(restore.content).toContain("data-an-text");
    expect(restoreIdMap.get(afterButtons[1]!.id)).toBe(
      restoredAfterButtons[1]!.id,
    );

    const history = remapContentHistory(
      [change],
      [beforeSelection],
      afterMap,
      new Map([[ORIGINAL_FILE_ID, RESTORED_FILE_ID]]),
    );
    expect(history.stack[0]).toMatchObject({
      fileId: RESTORED_FILE_ID,
      before,
      after,
    });
    expect((history.stack[0] as typeof change).before).toBe(before);
    expect((history.stack[0] as typeof change).after).toBe(after);

    const undoContent = normalizeScreenHtml(before).content;
    const undo = resolveHistorySelection(history.selections[0], {
      [RESTORED_FILE_ID]: undoContent,
    });
    expect(undo.selection?.selectedLayerIds).toHaveLength(1);
    expect(
      selectedButtonText(
        undoContent,
        RESTORED_FILE_ID,
        undo.selection!.selectedLayerIds[0]!,
      ),
    ).toContain("Beta");

    const remappedAfterSelection = afterMap.get(history.stack[0]!);
    const redo = resolveHistorySelection(remappedAfterSelection, {
      [RESTORED_FILE_ID]: restore.content,
    });
    expect(redo.selection?.selectedLayerIds).toHaveLength(1);
    expect(
      selectedButtonText(
        restore.content,
        RESTORED_FILE_ID,
        redo.selection!.selectedLayerIds[0]!,
      ),
    ).toContain("Beta revised");

    const page = await browser.newPage();
    try {
      await page.setContent(restore.content);
      const rendered = await page
        .locator("button")
        .evaluateAll((buttons: HTMLElement[]) =>
          buttons.map((button) => ({
            id: button.getAttribute("id"),
            stableId: button.getAttribute("data-agent-native-node-id"),
            text: button.textContent?.trim(),
          })),
        );
      expect(rendered).toEqual([
        { id: "duplicate", stableId: originalStableIds[0], text: "Alpha" },
        {
          id: "duplicate",
          stableId: originalStableIds[1],
          text: "Beta revised",
        },
      ]);
    } finally {
      await page.close();
    }
  });

  it("replays a raw captured text selection across identity-only publication in both directions", () => {
    const raw =
      '<main><p class="bg-blue-600 p-2">Portable text selection</p></main>';
    const prepared = prepareCanonicalSourceContent(raw, {
      fileId: ORIGINAL_FILE_ID,
    });

    expect(prepared.changed).toBe(true);
    expect(prepared.content).toContain("data-agent-native-node-id");
    expect(prepared.content).not.toContain("data-an-text");
    expect(normalizeScreenHtml(raw).content).not.toBe(prepared.content);

    const rawSelection = selectionFor(
      ORIGINAL_FILE_ID,
      raw,
      "Portable text selection",
    );
    const forward = resolveHistorySelection(rawSelection, {
      [ORIGINAL_FILE_ID]: prepared.content,
    });
    expect(forward.selection?.selectedLayerIds).toHaveLength(1);
    const preparedSelected = layerNode(
      prepared.content,
      ORIGINAL_FILE_ID,
      "Portable text selection",
    );
    expect(forward.selection?.selectedLayerIds).toEqual([preparedSelected.id]);

    const preparedSelection = selectionFor(
      ORIGINAL_FILE_ID,
      prepared.content,
      "Portable text selection",
    );
    const reverse = resolveHistorySelection(preparedSelection, {
      [ORIGINAL_FILE_ID]: raw,
    });
    expect(reverse.selection?.selectedLayerIds).toEqual([
      layerNode(raw, ORIGINAL_FILE_ID, "Portable text selection").id,
    ]);
  });
});
