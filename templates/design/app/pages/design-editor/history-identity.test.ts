import { buildCodeLayerProjection } from "@shared/code-layer";
import {
  annotateScreenHtmlForPersist,
  normalizeScreenHtml,
} from "@shared/screen-annotation";
import { describe, it, expect, vi } from "vitest";

import { runGetSelectedLayerSnapshots } from "@/pages/design-editor/commands/get-selected-layer-snapshots";
import {
  captureHistorySelectionFromOwners,
  captureHistorySelectionSources,
  prepareDeletedFileRestore,
  remapContentHistory,
  remapHistorySelection,
  resolveHistorySelection,
  remapHistoryChange,
} from "@/pages/design-editor/history-identity";
const before = "<main><p>Note</p><p>Note</p></main>";
const after = '<main><p style="color:red">Note</p><p>Note</p></main>';
const nodeId = (html: string, fileId: string) =>
  buildCodeLayerProjection(html, { source: { kind: "design-file", fileId } })
    .nodes[1]!.id;
const selection = (fileId: string, html: string) =>
  captureHistorySelectionSources(
    {
      activeFileId: fileId,
      overviewSelectedScreenIds: [fileId],
      selectedLayerIds: [nodeId(html, fileId)],
    },
    { [fileId]: html },
  );

describe("recreated source identity is version-specific", () => {
  it("keeps raw historical source, resolves both replay directions, and gives duplicate a real target", () => {
    const prepared = prepareDeletedFileRestore({
      id: "a",
      content: after,
      fileType: "html",
    });
    expect(prepared.content).toBe(annotateScreenHtmlForPersist(after, "html"));
    expect(prepared.mapNodeIds("new-a").get(nodeId(after, "a"))).toBe(
      nodeId(prepared.content, "new-a"),
    );
    const original = { fileId: "a", before, after };
    const peer = {
      fileId: "b",
      before: "<main><p>peer</p></main>",
      after: "<main><p>new peer</p></main>",
      isCheckpoint: true,
    };
    const afterMap = new WeakMap();
    afterMap.set(original, selection("a", after));
    const mapped = remapContentHistory(
      [peer, original],
      [selection("b", peer.before), selection("a", before)],
      afterMap,
      new Map([["a", "new-a"]]),
    );
    expect(mapped.stack[0]).toBe(peer);
    expect(mapped.stack[1]).toMatchObject({ fileId: "new-a", before, after });
    for (const [source, snapshot] of [
      [before, mapped.selections[1]],
      [after, afterMap.get(mapped.stack[1])],
    ] as const) {
      const resolved = resolveHistorySelection(snapshot, {
        "new-a": source,
        b: peer.after,
      });
      expect(resolved.selection!.selectedLayerIds).toEqual([
        nodeId(source, "new-a"),
      ]);
      expect(resolved.element?.sourceLayerIdentity).toEqual({
        screenId: "new-a",
        nodeId: nodeId(source, "new-a"),
      });
      const file = {
        id: "new-a",
        content: source,
        filename: "index.html",
        fileType: "html",
      };
      const snapshots = runGetSelectedLayerSnapshots({
        activeFile: file,
        files: [file],
        designSourceType: "inline",
        getFreshActiveContent: () => source,
        getScreenContent: () => source,
        liveScreenSnapshotsById: {},
        runtimeLayerSnapshotsById: {},
        overviewScreens: [],
        selectedElement: resolved.element,
        selectedElementLayerId: nodeId(source, "new-a"),
        selectedLayerIdsState: resolved.selection!.selectedLayerIds,
      } as any);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.node.id).toBe(nodeId(source, "new-a"));
    }
    const pure = remapHistorySelection(
      selection("a", after),
      new Map([["a", "new-a"]]),
    );
    expect(
      resolveHistorySelection(pure, { "new-a": prepared.content }).selection!
        .selectedLayerIds,
    ).toEqual([nodeId(prepared.content, "new-a")]);
    expect(
      resolveHistorySelection(pure, { "new-a": after }).selection!
        .selectedLayerIds,
    ).toEqual([nodeId(after, "new-a")]);
  });
  it("preserves the old normalization namespace through recreation and reverse raw replay", () => {
    const normalized = normalizeScreenHtml(before, {
      source: { kind: "design-file", fileId: "a" },
    }).content;
    const mapped = remapHistorySelection(
      selection("a", normalized),
      new Map([["a", "new-a"]]),
    );
    expect(mapped.sourceFileIdByFileId).toEqual({ "new-a": "a" });
    const resolved = resolveHistorySelection(mapped, { "new-a": before });
    expect(resolved.selection!.selectedLayerIds).toEqual([
      nodeId(before, "new-a"),
    ]);
    expect(resolved.element?.sourceLayerIdentity?.screenId).toBe("new-a");
  });
  it("reads only selected owners and skips empty or Screen-only captures across 60 Screens", () => {
    const owners = new Map(
      Array.from({ length: 60 }, (_, i) => [
        nodeId(before, `file-${i}`),
        { fileId: `file-${i}` },
      ]),
    );
    const read = vi.fn(() => before);
    const base = {
      activeFileId: "file-0",
      overviewSelectedScreenIds: ["file-0"],
      selectedLayerIds: [] as string[],
    };
    captureHistorySelectionFromOwners(base, owners, read);
    captureHistorySelectionFromOwners(
      { ...base, selectedLayerIds: ["file-0"] },
      owners,
      read,
    );
    expect(read).not.toHaveBeenCalled();
    const captured = captureHistorySelectionFromOwners(
      {
        ...base,
        selectedLayerIds: [nodeId(before, "file-2"), nodeId(before, "file-2")],
      },
      owners,
      read,
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("file-2");
    expect(Object.keys(captured.sourceContentByFileId!)).toEqual(["file-2"]);
  });
  it("drops unproven recreated selection while preserving peer identity and metadata", () => {
    const old = {
      activeFileId: "a",
      overviewSelectedScreenIds: ["a"],
      selectedLayerIds: [nodeId(after, "a")],
    };
    expect(
      remapHistorySelection(old, new Map([["a", "new-a"]])).selectedLayerIds,
    ).toEqual([]);
    const captured = remapHistorySelection(
      selection("a", after),
      new Map([["a", "new-a"]]),
    );
    expect(
      resolveHistorySelection(captured, {
        "new-a": "<main><p>different</p></main>",
      }).selection!.selectedLayerIds,
    ).toEqual([]);
    const peer = selection("b", before);
    expect(remapHistorySelection(peer, new Map([["a", "new-a"]]))).toBe(peer);
    const change = {
      fileId: "a",
      before,
      after,
      designDataChange: {
        undo: [
          {
            op: "set" as const,
            path: ["screenMetadata", "a", "width"] as [string, ...string[]],
            value: 100,
          },
        ],
        redo: [
          {
            op: "set" as const,
            path: ["screenMetadata", "b", "width"] as [string, ...string[]],
            value: 200,
          },
        ],
      },
    };
    const mapped = remapHistoryChange(change, new Map([["a", "new-a"]]));
    expect(mapped.designDataChange!.undo[0]!.path).toEqual([
      "screenMetadata",
      "new-a",
      "width",
    ]);
    const foreign = remapHistoryChange(
      { ...change, fileId: "b" },
      new Map([["a", "new-a"]]),
    );
    expect(foreign.fileId).toBe("b");
    expect(foreign.designDataChange!.undo[0]!.path[1]).toBe("new-a");
    expect(mapped.designDataChange!.redo[0]).toBe(
      change.designDataChange.redo[0],
    );
  });
});
