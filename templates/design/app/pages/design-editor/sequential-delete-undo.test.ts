import { expect, it, vi } from "vitest";

import type { UndoArgs } from "@/pages/design-editor/commands/undo";
import { runUndo } from "@/pages/design-editor/commands/undo";
import { applyDesignDataOperations } from "@/pages/design-editor/data-operations";
import type {
  ContentHistoryChange,
  FileDeletionHistoryEntry,
  FileDeletionHistorySnapshot,
} from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

const ref = <T>(current: T) => ({ current });

it("restores both deleted screens into the surviving variant set", async () => {
  const screens = [
    { id: "a", variantId: "desktop", label: "A" },
    { id: "b", variantId: "tablet", label: "B" },
    { id: "c", variantId: "mobile", label: "C" },
  ];
  const file = (id: string): DesignFile => ({
    id,
    filename: `${id}.html`,
    content: `<main>${id}</main>`,
    fileType: "html",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  const snapshot = (
    id: string,
    membershipScreens: typeof screens,
  ): FileDeletionHistorySnapshot => {
    const screen = screens.find((member) => member.id === id)!;
    return {
      ...file(id),
      screenMetadata: { title: `Screen ${id}` },
      variantMemberships: [
        {
          setId: "set",
          set: {
            id: "set",
            screenCount: membershipScreens.length,
            screens: membershipScreens,
          },
          screen,
          index: membershipScreens.findIndex((member) => member.id === id),
          originalScreenIds: membershipScreens.map((member) => member.id),
        },
      ],
    };
  };
  const deletionUndoStackRef = ref<FileDeletionHistoryEntry[]>([
    { files: [snapshot("a", screens)] },
    { files: [snapshot("c", screens.slice(1))] },
  ]);
  const deletionRedoStackRef = ref<FileDeletionHistoryEntry[]>([]);
  const fileHistoryMutationPendingRef = ref(false);
  const designDataJsonRef = ref<Record<string, unknown>>({
    canvasFrames: { b: { x: 400, y: 0, width: 800, height: 600 } },
    screenMetadata: { b: { title: "Surviving B" } },
    localhostScreens: {},
    designVariantSets: {},
  });
  const createFileMutation = {
    mutateAsync: vi
      .fn()
      .mockResolvedValueOnce({ id: "restored-c" })
      .mockResolvedValueOnce({ id: "restored-a" }),
  };
  const queryClient = {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  };
  const historyOrderRef = ref(["file-deleted", "file-deleted"]);
  const redoOrderRef = ref<string[]>([]);
  const args = {
    activeEditorDragRef: ref(false),
    activeFile: file("b"),
    applyDesignDataHistoryChanges: (
      changes: readonly ContentHistoryChange[],
      direction: "undo" | "redo",
    ) => {
      const operations = changes.flatMap(
        (change) => change.designDataChange?.[direction] ?? [],
      );
      designDataJsonRef.current = applyDesignDataOperations(
        designDataJsonRef.current,
        operations,
      );
      return true;
    },
    canEditDesign: true,
    clipboardPasteRedoStackRef: ref([]),
    clipboardPasteUndoStackRef: ref([]),
    contentHistorySelectionAfterRef: ref(new WeakMap()),
    contentRedoSelectionStackRef: ref([]),
    contentRedoStackRef: ref([]),
    contentUndoSelectionStackRef: ref([]),
    contentUndoStackRef: ref([]),
    createFileMutation,
    deleteFileMutation: { mutateAsync: vi.fn() },
    designDataJsonRef,
    fileCreationRedoStackRef: ref([]),
    fileCreationUndoStackRef: ref([]),
    fileDeletionRedoStackRef: deletionRedoStackRef,
    fileDeletionUndoStackRef: deletionUndoStackRef,
    fileHistoryMutationPendingRef,
    files: [file("b")],
    geometryRedoStackRef: ref([]),
    geometryUndoStackRef: ref([]),
    historyOrderRef,
    id: "design",
    localContentRedoStackRef: ref([]),
    localContentUndoStackRef: ref([]),
    pendingLiveNonStyleUndoStackRef: ref([]),
    pendingVisualStyleUndoStackRef: ref([]),
    queryClient,
    redoOrderRef,
    selectionRedoStackRef: ref([]),
    selectionUndoStackRef: ref([]),
    setActiveFileId: vi.fn(),
    setOverviewSelectedScreenIds: vi.fn(),
    setSelectedLayerIdsState: vi.fn(),
    syncUndoRedoState: vi.fn(),
    t: (key: string) => key,
    undoManagerRef: ref(null),
    viewModeRef: ref("overview"),
    writeFrameGeometrySnapshot: (geometryById: Record<string, unknown>) => {
      designDataJsonRef.current = {
        ...designDataJsonRef.current,
        canvasFrames: geometryById,
      };
    },
  } as unknown as UndoArgs;

  const variantMemberIds = () =>
    (
      designDataJsonRef.current as {
        designVariantSets: Record<string, { screens: { id: string }[] }>;
      }
    ).designVariantSets.set?.screens.map((screen) => screen.id);

  runUndo(args);
  await vi.waitFor(() => expect(deletionRedoStackRef.current).toHaveLength(1));
  expect(variantMemberIds()).toEqual(["b", "restored-c"]);

  runUndo(args);
  await vi.waitFor(() => expect(deletionRedoStackRef.current).toHaveLength(2));

  const data = designDataJsonRef.current as {
    screenMetadata: Record<string, unknown>;
  };
  expect(data.screenMetadata).toMatchObject({
    b: { title: "Surviving B" },
    "restored-a": { title: "Screen a" },
    "restored-c": { title: "Screen c" },
  });
  expect(variantMemberIds()).toEqual(["restored-a", "b", "restored-c"]);
});
