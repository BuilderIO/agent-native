import { describe, expect, it, vi } from "vitest";

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
