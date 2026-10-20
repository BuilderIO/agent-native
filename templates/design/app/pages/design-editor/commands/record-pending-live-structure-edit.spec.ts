import { describe, expect, it, vi } from "vitest";

import {
  pendingStructureRedoCommand,
  pendingLiveStructureRedoSourceEdit,
  type PendingLiveStructureEdit,
} from "../pending-edits";
import {
  commitPendingLiveStructureEdits,
  preparePendingLiveStructureEdit,
  runRecordPendingLiveStructureEdit,
  type RecordPendingLiveStructureEditArgs,
} from "./record-pending-live-structure-edit";

function state(): RecordPendingLiveStructureEditArgs {
  return {
    canEditDesign: true,
    cancelPendingStructureVerification: vi.fn(),
    files: [
      {
        id: "screen",
        filename: "page.tsx",
        content: "",
        updatedAt: "1",
        createdAt: "1",
        fileType: "tsx",
      },
    ],
    localhostConnectionRootPathByIdRef: { current: new Map() },
    overviewScreens: [
      {
        id: "screen",
        filename: "page.tsx",
        content: "http://127.0.0.1:3000",
        updatedAt: "1",
        sourceType: "localhost",
        heightPinned: false,
      },
    ],
    pendingLiveNonStyleEditsRef: { current: [] },
    pendingLiveNonStyleRedoStackRef: { current: [] },
    pendingLiveNonStyleUndoStackRef: { current: [] },
    pendingStructureRedoReplayRef: { current: undefined },
    pendingStructureRedoReplayTimerRef: { current: undefined },
    pendingStructureRedoPreparedEditsRef: { current: undefined },
    pendingVisualStyleRedoStackRef: { current: [] },
    runtimeLayerSnapshotsById: {},
    setPendingLiveNonStyleEdits: vi.fn(),
  };
}

function prepare(args: RecordPendingLiveStructureEditArgs, selector: string) {
  return preparePendingLiveStructureEdit(
    args,
    "screen",
    selector,
    "#anchor",
    "inside",
    undefined,
    { sourceId: selector.slice(1), transactionId: "group" },
  );
}

describe("pending live structure batch", () => {
  it("keeps collision remint intent in the pending edit used by redo", () => {
    const args = state();

    runRecordPendingLiveStructureEdit(
      args,
      "screen",
      "[data-node=inserted]",
      "#anchor",
      "inside",
      undefined,
      {
        insertedHtml: '<div data-agent-native-node-id="shared">Moved</div>',
        remintCollidingNodeIds: true,
      },
    );

    const undoEntry = args.pendingLiveNonStyleUndoStackRef.current[0];
    if (!undoEntry || undoEntry.kind !== "structure") {
      throw new Error("expected a structure undo entry");
    }
    const edit: PendingLiveStructureEdit = undoEntry.edit;
    expect(edit).toMatchObject({
      insertedHtml: expect.any(String),
      remintCollidingNodeIds: true,
    });
    expect(pendingStructureRedoCommand(edit!)).toEqual({
      kind: "insert",
      html: edit!.insertedHtml,
      remintCollidingNodeIds: true,
    });
  });

  it("replays the inserted member of a grouped move when delete is primary", () => {
    const args = state();
    const destination = prepare(args, "#destination")!;
    const sourceDelete = {
      ...prepare(args, "#source")!,
      removed: true as const,
    };
    const grouped = {
      ...sourceDelete,
      groupedEdits: [
        {
          ...destination,
          insertedHtml: '<div data-agent-native-node-id="moved" />',
          remintCollidingNodeIds: true,
        },
        sourceDelete,
      ],
    };

    expect(pendingStructureRedoCommand(grouped)).toEqual({
      kind: "insert",
      html: grouped.groupedEdits[0].insertedHtml,
      remintCollidingNodeIds: true,
    });
  });

  it("reattaches grouped undo members before selecting a redo command", () => {
    const args = state();
    const destination = {
      ...prepare(args, "#destination")!,
      insertedHtml: '<div data-agent-native-node-id="moved" />',
      remintCollidingNodeIds: true,
    };
    const sourceDelete = {
      ...prepare(args, "#source")!,
      removed: true as const,
    };
    const entry = {
      kind: "structure" as const,
      edit: sourceDelete,
      groupedEdits: [destination, sourceDelete],
    };

    const replaySource = pendingLiveStructureRedoSourceEdit(entry);
    expect(pendingStructureRedoCommand(replaySource)).toEqual({
      kind: "insert",
      html: expect.any(String),
      remintCollidingNodeIds: true,
    });
    expect(replaySource.groupedEdits).toEqual(entry.groupedEdits);
  });

  it("does not mutate existing state when a later member rejects or throws", () => {
    const args = state();
    const prior = prepare(args, "#prior")!;
    args.pendingLiveNonStyleEditsRef.current = [prior];
    const undo = { kind: "structure" as const, edit: prior };
    args.pendingLiveNonStyleUndoStackRef.current = [undo];
    args.pendingLiveNonStyleRedoStackRef.current = [undo];
    const before = {
      pending: args.pendingLiveNonStyleEditsRef.current,
      undo: args.pendingLiveNonStyleUndoStackRef.current,
      redo: args.pendingLiveNonStyleRedoStackRef.current,
    };

    expect([prepare(args, "#first"), undefined].every(Boolean)).toBe(false);
    expect(args.pendingLiveNonStyleEditsRef.current).toBe(before.pending);
    expect(args.pendingLiveNonStyleUndoStackRef.current).toBe(before.undo);
    expect(args.pendingLiveNonStyleRedoStackRef.current).toBe(before.redo);

    const throwing = state();
    throwing.pendingLiveNonStyleEditsRef.current = [prior];
    throwing.overviewScreens[0]!.connectionId = "connection";
    const paths = throwing.localhostConnectionRootPathByIdRef.current as Map<
      string,
      string
    > & { get(key: string): string | undefined };
    paths.get = () => {
      throw new Error("later prepare failed");
    };
    expect(() => prepare(throwing, "#later")).toThrow("later prepare failed");
    expect(throwing.pendingLiveNonStyleEditsRef.current).toEqual([prior]);
  });

  it("commits a prepared group as one undo entry and one pending Apply handoff", () => {
    const args = state();
    const edits = [prepare(args, "#first"), prepare(args, "#second")];
    if (!edits.every((edit): edit is NonNullable<typeof edit> => !!edit)) {
      throw new Error("test setup did not prepare both group members");
    }
    commitPendingLiveStructureEdits(args, edits);

    expect(args.pendingLiveNonStyleUndoStackRef.current).toHaveLength(1);
    expect(args.pendingLiveNonStyleUndoStackRef.current[0]).toMatchObject({
      kind: "structure",
      groupedEdits: [{ selector: "#first" }, { selector: "#second" }],
    });
    expect(args.pendingLiveNonStyleEditsRef.current).toMatchObject([
      {
        kind: "structure",
        groupedEdits: [{ selector: "#first" }, { selector: "#second" }],
      },
    ]);
  });

  it("waits for every bridge callback before restoring a grouped redo", () => {
    const args = state();
    const first = prepare(args, "#first")!;
    const second = prepare(args, "#second")!;
    const replay = {
      kind: "structure" as const,
      edit: second,
      groupedEdits: [first, second],
    };
    args.pendingLiveNonStyleRedoStackRef.current = [replay];
    args.pendingStructureRedoReplayRef.current = replay;

    for (const edit of [first, second]) {
      runRecordPendingLiveStructureEdit(
        args,
        edit.screenId,
        edit.selector,
        edit.anchorSelector,
        edit.placement,
        undefined,
        {
          sourceId: edit.sourceId ?? undefined,
          transactionId: edit.transactionId,
        },
      );
      if (edit === first) {
        expect(args.pendingLiveNonStyleUndoStackRef.current).toEqual([]);
        expect(args.pendingLiveNonStyleRedoStackRef.current).toEqual([replay]);
        expect(args.pendingStructureRedoReplayRef.current).toBe(replay);
      }
    }

    expect(args.pendingLiveNonStyleRedoStackRef.current).toEqual([]);
    expect(args.pendingLiveNonStyleUndoStackRef.current).toMatchObject([
      {
        kind: "structure",
        groupedEdits: [{ selector: "#first" }, { selector: "#second" }],
      },
    ]);
    expect(args.pendingLiveNonStyleEditsRef.current).toMatchObject([
      {
        kind: "structure",
        groupedEdits: [{ selector: "#first" }, { selector: "#second" }],
      },
    ]);
  });
});
