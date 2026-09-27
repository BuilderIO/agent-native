import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { runDeleteFiles } from "@/pages/design-editor/commands/delete-files";
import type { UndoArgs } from "@/pages/design-editor/commands/undo";
import { runUndo } from "@/pages/design-editor/commands/undo";
import { runWriteFrameGeometrySnapshot } from "@/pages/design-editor/commands/write-frame-geometry-snapshot";
import { applyDesignDataOperations } from "@/pages/design-editor/data-operations";
import type {
  ContentHistoryChange,
  FileDeletionHistoryEntry,
  FileDeletionHistorySnapshot,
} from "@/pages/design-editor/history";
import { prepareDeletedFileRestore } from "@/pages/design-editor/history-identity";
import type { DesignFile } from "@/pages/design-editor/types";

const ref = <T>(current: T) => ({ current });

describe("screen deletion metadata history", () => {
  it("restores source metadata and variant memberships while preserving surviving edits", async () => {
    const deletedId = "deleted-screen";
    const restoredId = "restored-screen";
    const frame = { x: 620, y: 340, width: 390, height: 844, z: 7 };
    const sourceMetadata = {
      sourceType: "localhost",
      connectionId: "conn_1",
      routeId: "route-settings",
      path: "/settings",
      url: "http://localhost:5173/settings?tab=profile",
      bridgeUrl: "http://127.0.0.1:7331",
      stateRef: "state-selected-tab",
      routeMetadata: { stateName: "selected-tab" },
      heightMode: "fixed",
      heightPinned: true,
      width: 390,
      height: 844,
    };
    const variantMember = {
      id: deletedId,
      variantId: "settings-desktop",
      label: "Settings desktop",
    };
    const mobileMember = {
      id: "mobile-screen",
      variantId: "settings-mobile",
    };
    const tabletMember = {
      id: "tablet-screen",
      variantId: "settings-tablet",
    };
    const updatedTabletMember = {
      ...tabletMember,
      label: "Tablet renamed while the screen was absent",
    };
    const compactMember = {
      id: deletedId,
      variantId: "settings-compact-desktop",
    };
    const compactSurvivor = {
      id: "compact-mobile-screen",
      variantId: "settings-compact-mobile",
    };
    const file: DesignFile = {
      id: deletedId,
      filename: "settings.html",
      content: "<main>Settings</main>",
      fileType: "html",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    };
    const deletionUndoStackRef = ref([] as FileDeletionHistoryEntry[]);
    const noop = vi.fn();
    const queryClient = {
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    } as unknown as QueryClient;
    const designDataJsonRef = ref<Record<string, unknown>>({
      canvasFrames: { [deletedId]: frame },
      screenMetadata: {
        [deletedId]: sourceMetadata,
        "tablet-screen": { title: "Before deletion" },
      },
      localhostScreens: {
        [deletedId]: sourceMetadata,
        "tablet-screen": { sourceType: "localhost", path: "/before" },
      },
      designVariantSets: {
        settings: {
          id: "settings",
          screenCount: 3,
          screens: [mobileMember, variantMember, tabletMember],
        },
        compact: {
          id: "compact",
          screenCount: 2,
          screens: [compactMember, compactSurvivor],
        },
      },
    });
    const writeFrameGeometrySnapshot = (
      geometry: Parameters<typeof runWriteFrameGeometrySnapshot>[1],
      options?: Parameters<typeof runWriteFrameGeometrySnapshot>[2],
    ) =>
      runWriteFrameGeometrySnapshot(
        {
          boardFileId: undefined,
          canEditDesignRef: ref(true),
          designDataJsonRef,
          enqueueFrameGeometryDataSave: vi.fn(() => true),
          frameGeometrySaveTimerRef: ref(null),
          id: "design",
          pendingFrameGeometrySaveRef: ref(null),
          queryClient,
        },
        geometry,
        options,
      );

    runDeleteFiles(
      {
        activeFile: file,
        canvasFrameGeometryById: { [deletedId]: frame },
        clearRedoStacks: noop,
        clipboardPasteRedoStackRef: ref([]),
        clipboardPasteUndoStackRef: ref([]),
        contentRedoSelectionStackRef: ref([]),
        contentRedoStackRef: ref([]),
        contentUndoSelectionStackRef: ref([]),
        contentUndoStackRef: ref([]),
        deleteFileMutation: {
          mutateAsync: vi.fn(async () => {
            const deletedFileSnapshot: FileDeletionHistorySnapshot = {
              ...file,
              content:
                "<main>Server version captured under the delete lock</main>",
              geometry: frame,
              screenMetadata: sourceMetadata,
              localhostScreen: sourceMetadata,
              variantMemberships: [
                {
                  setId: "settings",
                  set: {
                    id: "settings",
                    screenCount: 3,
                    screens: [mobileMember, variantMember, tabletMember],
                  },
                  screen: variantMember,
                  index: 1,
                  originalScreenIds: [
                    "mobile-screen",
                    deletedId,
                    "tablet-screen",
                  ],
                },
                {
                  setId: "compact",
                  set: {
                    id: "compact",
                    screenCount: 2,
                    screens: [compactMember, compactSurvivor],
                  },
                  screen: compactMember,
                  index: 0,
                  originalScreenIds: [deletedId, "compact-mobile-screen"],
                },
              ],
            };
            designDataJsonRef.current = {
              ...designDataJsonRef.current,
              screenMetadata: {
                [deletedId]: sourceMetadata,
                "tablet-screen": {
                  title: "B edited while the screen was absent",
                  sourceType: "inline",
                },
              },
              localhostScreens: {
                [deletedId]: sourceMetadata,
                "tablet-screen": {
                  sourceType: "localhost",
                  path: "/updated-while-absent",
                },
              },
              designVariantSets: {
                settings: {
                  id: "settings",
                  screenCount: 3,
                  screens: [mobileMember, variantMember, updatedTabletMember],
                },
                // delete-file prunes the entire two-member set, while the
                // action-query refresh that removes A from this reference is
                // still pending.
              },
            };
            return {
              deleted: true,
              id: deletedId,
              deletedFiles: [deletedFileSnapshot],
            };
          }),
        } as any,
        fileCreationRedoStackRef: ref([]),
        fileCreationUndoStackRef: ref([]),
        fileDeletionUndoStackRef: deletionUndoStackRef,
        fileHistoryMutationPendingRef: ref(false),
        files: [file],
        geometryRedoStackRef: ref([]),
        geometryUndoStackRef: ref([]),
        historyOrderRef: ref([]),
        id: "design",
        latestClipboardMutationContentRef: ref(new Map()),
        localContentRedoStackRef: ref([]),
        localContentUndoStackRef: ref([]),
        queryClient,
        redoOrderRef: ref([]),
        setActiveFileId: noop,
        setSelectedElement: noop,
        setSelectedLayerIdsState: noop,
        syncUndoRedoState: noop,
        t: (key: string) => key,
        writeFrameGeometrySnapshot,
        designDataJsonRef,
      } as any,
      [file],
      { recordDeletionHistory: true },
    );

    await vi.waitFor(() =>
      expect(deletionUndoStackRef.current).toHaveLength(1),
    );

    const fileDeletionRedoStackRef = ref([] as FileDeletionHistoryEntry[]);
    const historyOrderRef = ref(["file-deleted"]);
    const redoOrderRef = ref([]);

    const restoredContent = vi.fn();
    runUndo({
      activeEditorDragRef: ref(false),
      activeFile: { ...file, id: "tablet-screen" },
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
      createFileMutation: {
        mutateAsync: vi.fn(async ({ content }: { content: string }) => {
          restoredContent(content);
          return { id: restoredId };
        }),
      } as any,
      deleteFileMutation: { mutateAsync: vi.fn() } as any,
      designDataJsonRef,
      fileCreationRedoStackRef: ref([]),
      fileCreationUndoStackRef: ref([]),
      fileDeletionRedoStackRef,
      fileDeletionUndoStackRef: deletionUndoStackRef,
      fileHistoryMutationPendingRef: ref(false),
      files: [{ ...file, id: "tablet-screen" }],
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
      setActiveFileId: noop,
      setOverviewSelectedScreenIds: noop,
      setSelectedLayerIdsState: noop,
      syncUndoRedoState: noop,
      t: (key: string) => key,
      undoManagerRef: ref(null),
      viewModeRef: ref("overview"),
      writeFrameGeometrySnapshot,
    } as unknown as UndoArgs);

    await vi.waitFor(() =>
      expect(fileDeletionRedoStackRef.current).toHaveLength(1),
    );
    expect(restoredContent).toHaveBeenCalledWith(
      expect.stringContaining("Server version captured under the delete lock"),
    );

    expect(designDataJsonRef.current).toMatchObject({
      canvasFrames: { [restoredId]: frame },
      screenMetadata: {
        [restoredId]: sourceMetadata,
        "tablet-screen": {
          title: "B edited while the screen was absent",
          sourceType: "inline",
        },
      },
      localhostScreens: {
        [restoredId]: sourceMetadata,
        "tablet-screen": {
          sourceType: "localhost",
          path: "/updated-while-absent",
        },
      },
      designVariantSets: {
        settings: {
          screens: [
            mobileMember,
            { ...variantMember, id: restoredId },
            updatedTabletMember,
          ],
        },
        compact: {
          id: "compact",
          screenCount: 2,
          screens: [{ ...compactMember, id: restoredId }, compactSurvivor],
        },
      },
    });
    expect(designDataJsonRef.current.screenMetadata).not.toHaveProperty(
      deletedId,
    );
    expect(designDataJsonRef.current.localhostScreens).not.toHaveProperty(
      deletedId,
    );
    expect(
      fileDeletionRedoStackRef.current[0]?.files[0]?.variantMemberships?.find(
        (membership) => membership.setId === "compact",
      ),
    ).toMatchObject({
      originalScreenIds: [restoredId, compactSurvivor.id],
      screen: { id: restoredId },
      set: {
        screens: [{ id: restoredId }, compactSurvivor],
      },
    });
  });

  it.each([
    { rejectFirstRecovery: false, recreateAAgain: false },
    { rejectFirstRecovery: true, recreateAAgain: false },
    { rejectFirstRecovery: false, recreateAAgain: true },
  ])(
    "keeps a cleanup-failed recreation as a carrier and restores both sole variant members on retry (reject first recovery: $rejectFirstRecovery; recreate A again: $recreateAAgain)",
    async ({ rejectFirstRecovery, recreateAAgain }) => {
      const fileA: DesignFile = {
        id: "screen-a",
        filename: "a.html",
        content: "<main>A</main>",
        fileType: "html",
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      };
      const fileB: DesignFile = {
        ...fileA,
        id: "screen-b",
        filename: "b.html",
        content: "<main>B</main>",
      };
      const metadataA = { sourceType: "localhost", path: "/a" };
      const metadataB = { sourceType: "localhost", path: "/b" };
      const localhostA = { sourceType: "localhost", path: "/local/a" };
      const localhostB = { sourceType: "localhost", path: "/local/b" };
      const geometryA = { x: 10, y: 20, width: 300, height: 600, z: 0 };
      const geometryB = { x: 30, y: 40, width: 300, height: 600, z: 1 };
      const memberA = { id: fileA.id, label: "A" };
      const memberB = { id: fileB.id, label: "B" };
      const originalVariantSet = {
        id: "variant-set",
        label: "Pair",
        screens: [memberA, memberB],
      };
      const originalScreenIds = [fileA.id, fileB.id];
      const entry: FileDeletionHistoryEntry = {
        files: [
          {
            ...fileA,
            geometry: geometryA,
            screenMetadata: metadataA,
            localhostScreen: localhostA,
            variantMemberships: [
              {
                setId: "variant-set",
                set: originalVariantSet,
                screen: memberA,
                index: 0,
                originalScreenIds,
              },
            ],
          },
          {
            ...fileB,
            geometry: geometryB,
            screenMetadata: metadataB,
            localhostScreen: localhostB,
            variantMemberships: [
              {
                setId: "variant-set",
                set: originalVariantSet,
                screen: memberB,
                index: 1,
                originalScreenIds,
              },
            ],
          },
        ],
      };
      const fileDeletionUndoStackRef = ref([entry]);
      const fileDeletionRedoStackRef = ref([] as FileDeletionHistoryEntry[]);
      const fileHistoryMutationPendingRef = ref(false);
      const createNames: string[] = [];
      const createCounts = new Map<string, number>();
      const fileCreationMutation = {
        mutateAsync: vi.fn(async ({ filename }: { filename: string }) => {
          createNames.push(filename);
          const count = (createCounts.get(filename) ?? 0) + 1;
          createCounts.set(filename, count);
          if (filename === fileA.filename) {
            return { id: count === 1 ? "recreated-a" : "recreated-a2" };
          }
          if (count === 1) throw new Error("create B failed");
          return { id: "recreated-b" };
        }),
      };
      const queryClient = {
        invalidateQueries: vi.fn(),
        setQueryData: vi.fn(),
      } as unknown as QueryClient;
      const designDataJsonRef = ref<Record<string, unknown>>({
        canvasFrames: {},
        screenMetadata: {},
        localhostScreens: {},
        designVariantSets: {},
      });
      const pruneDesignDataFile = (fileId: string) => {
        const next = { ...designDataJsonRef.current };
        for (const key of [
          "canvasFrames",
          "screenMetadata",
          "localhostScreens",
        ]) {
          const records = { ...((next[key] as Record<string, unknown>) ?? {}) };
          delete records[fileId];
          next[key] = records;
        }
        const variantSets = {
          ...((next.designVariantSets as Record<string, any>) ?? {}),
        };
        for (const [setId, value] of Object.entries(variantSets)) {
          if (!Array.isArray(value?.screens)) continue;
          const screens = value.screens.filter(
            (screen: { id?: string } | string) =>
              (typeof screen === "string" ? screen : screen.id) !== fileId,
          );
          if (screens.length < 2) delete variantSets[setId];
          else variantSets[setId] = { ...value, screens };
        }
        next.designVariantSets = variantSets;
        designDataJsonRef.current = next;
      };
      const deleteFileMutation = {
        mutateAsync: vi.fn(async ({ id }: { id: string }) => {
          pruneDesignDataFile(id);
          throw new Error("cleanup failed");
        }),
      };
      let metadataApplyCount = 0;
      const applyDesignDataHistoryChanges = vi.fn(
        (
          changes: readonly ContentHistoryChange[],
          direction: "undo" | "redo",
        ) => {
          if (rejectFirstRecovery && metadataApplyCount++ === 0) return false;
          const operations = changes.flatMap(
            (change) => change.designDataChange?.[direction] ?? [],
          );
          designDataJsonRef.current = applyDesignDataOperations(
            designDataJsonRef.current,
            operations,
          );
          return true;
        },
      );
      const writeFrameGeometrySnapshot = (
        geometry: Parameters<typeof runWriteFrameGeometrySnapshot>[1],
        options?: Parameters<typeof runWriteFrameGeometrySnapshot>[2],
      ) =>
        runWriteFrameGeometrySnapshot(
          {
            boardFileId: undefined,
            canEditDesignRef: ref(true),
            designDataJsonRef,
            enqueueFrameGeometryDataSave: vi.fn(() => true),
            frameGeometrySaveTimerRef: ref(null),
            id: "design",
            pendingFrameGeometrySaveRef: ref(null),
            queryClient,
          },
          geometry,
          options,
        );

      const historyOrderRef = ref(["file-deleted"]);
      const redoOrderRef = ref([]);
      const latestClipboardMutationContentRef = ref(new Map());
      const runDeletionUndo = () =>
        runUndo({
          activeEditorDragRef: ref(false),
          activeFile: { ...fileA, id: "surviving-screen" },
          applyDesignDataHistoryChanges,
          canEditDesign: true,
          clipboardPasteRedoStackRef: ref([]),
          clipboardPasteUndoStackRef: ref([]),
          contentHistorySelectionAfterRef: ref(new WeakMap()),
          contentRedoSelectionStackRef: ref([]),
          contentRedoStackRef: ref([]),
          contentUndoSelectionStackRef: ref([]),
          contentUndoStackRef: ref([]),
          createFileMutation: fileCreationMutation as any,
          deleteFileMutation: deleteFileMutation as any,
          designDataJsonRef,
          fileCreationRedoStackRef: ref([]),
          fileCreationUndoStackRef: ref([]),
          fileDeletionRedoStackRef,
          fileDeletionUndoStackRef,
          fileHistoryMutationPendingRef,
          files: [{ ...fileA, id: "surviving-screen" }],
          geometryRedoStackRef: ref([]),
          geometryUndoStackRef: ref([]),
          historyOrderRef,
          id: "design",
          latestClipboardMutationContentRef,
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
          writeFrameGeometrySnapshot,
        } as unknown as UndoArgs);

      runDeletionUndo();

      await vi.waitFor(() => {
        expect(fileHistoryMutationPendingRef.current).toBe(false);
        expect(
          fileDeletionUndoStackRef.current[0]?.files.map((file) => file.id),
        ).toEqual(["screen-b"]);
      });

      const pendingEntry = fileDeletionUndoStackRef.current[0] as
        | (FileDeletionHistoryEntry & {
            restoredFiles?: FileDeletionHistorySnapshot[];
          })
        | undefined;
      expect(pendingEntry?.files.map((file) => file.id)).toEqual(["screen-b"]);
      expect(pendingEntry?.restoredFiles).toMatchObject([
        {
          id: "recreated-a",
          screenMetadata: metadataA,
          localhostScreen: localhostA,
          geometry: geometryA,
        },
      ]);
      if (!rejectFirstRecovery) {
        expect(designDataJsonRef.current.screenMetadata).toMatchObject({
          "recreated-a": metadataA,
        });
        expect(designDataJsonRef.current.localhostScreens).toMatchObject({
          "recreated-a": localhostA,
        });
        expect(designDataJsonRef.current.canvasFrames).toMatchObject({
          "recreated-a": geometryA,
        });
      }

      expect(deleteFileMutation.mutateAsync).toHaveBeenCalledWith({
        id: "recreated-a",
        allowLockedLayers: true,
      });
      expect(fileCreationMutation.mutateAsync).toHaveBeenCalledTimes(2);
      expect(applyDesignDataHistoryChanges).toHaveBeenCalled();
      expect(fileDeletionRedoStackRef.current).toEqual([]);

      let finalAId = "recreated-a";
      let finalMetadataA = metadataA;
      let finalGeometryA = geometryA;
      if (recreateAAgain) {
        const editedMetadataA = { ...metadataA, path: "/a-edited" };
        const editedGeometryA = {
          ...geometryA,
          x: 125,
          y: 235,
        };
        const editedAContent =
          "<main><section><p>Edited A while restored</p></section></main>";
        designDataJsonRef.current = applyDesignDataOperations(
          designDataJsonRef.current,
          [
            {
              op: "set",
              path: ["screenMetadata", "recreated-a"],
              value: editedMetadataA,
            },
          ],
        );
        writeFrameGeometrySnapshot({
          ...((designDataJsonRef.current.canvasFrames as Record<string, any>) ??
            {}),
          "recreated-a": editedGeometryA,
        } as any);
        expect(
          (designDataJsonRef.current.screenMetadata as Record<string, unknown>)[
            "recreated-a"
          ],
        ).toEqual(editedMetadataA);
        expect(
          (designDataJsonRef.current.canvasFrames as Record<string, unknown>)[
            "recreated-a"
          ],
        ).toEqual(editedGeometryA);
        finalMetadataA = editedMetadataA;
        finalGeometryA = editedGeometryA;

        const a1File: DesignFile = {
          ...fileA,
          id: "recreated-a",
          content: editedAContent,
        };
        let settleDeleteA!: () => void;
        const deletedA = new Promise<void>((resolve) => {
          settleDeleteA = resolve;
        });
        runDeleteFiles(
          {
            activeFile: a1File,
            canvasFrameGeometryById: designDataJsonRef.current
              .canvasFrames as Record<string, any>,
            clearRedoStacks: vi.fn(),
            designDataJsonRef,
            clipboardPasteRedoStackRef: ref([]),
            clipboardPasteUndoStackRef: ref([]),
            contentRedoSelectionStackRef: ref([]),
            contentRedoStackRef: ref([]),
            contentUndoSelectionStackRef: ref([]),
            contentUndoStackRef: ref([]),
            deleteFileMutation: {
              mutateAsync: vi.fn(async ({ id }: { id: string }) => {
                const deletedFileSnapshot: FileDeletionHistorySnapshot = {
                  ...a1File,
                  geometry: editedGeometryA,
                  screenMetadata: editedMetadataA,
                  localhostScreen: localhostA,
                  variantMemberships: [
                    {
                      setId: "variant-set",
                      set: {
                        ...originalVariantSet,
                        screens: [{ ...memberA, id: a1File.id }, memberB],
                      },
                      screen: { ...memberA, id: a1File.id },
                      index: 0,
                      originalScreenIds: [a1File.id, fileB.id],
                    },
                  ],
                };
                pruneDesignDataFile(id);
                return {
                  deleted: true,
                  id,
                  deletedFiles: [deletedFileSnapshot],
                };
              }),
            } as any,
            fileCreationRedoStackRef: ref([]),
            fileCreationUndoStackRef: ref([]),
            fileDeletionUndoStackRef,
            fileHistoryMutationPendingRef,
            files: [a1File],
            geometryRedoStackRef: ref([]),
            geometryUndoStackRef: ref([]),
            historyOrderRef,
            id: "design",
            latestClipboardMutationContentRef,
            localContentRedoStackRef: ref([]),
            localContentUndoStackRef: ref([]),
            queryClient,
            redoOrderRef,
            setActiveFileId: vi.fn(),
            setSelectedElement: vi.fn(),
            setSelectedLayerIdsState: vi.fn(),
            syncUndoRedoState: vi.fn(),
            t: (key: string) => key,
            writeFrameGeometrySnapshot,
          } as any,
          [a1File],
          {
            recordDeletionHistory: true,
            onMutationSettled: () => settleDeleteA(),
          },
        );
        await deletedA;
        expect(fileDeletionUndoStackRef.current).toHaveLength(2);

        runDeletionUndo();
        await vi.waitFor(() => {
          expect(fileHistoryMutationPendingRef.current).toBe(false);
          expect(fileDeletionUndoStackRef.current).toHaveLength(1);
        });
        finalAId = "recreated-a2";
        const expectedNormalizedA = prepareDeletedFileRestore({
          id: "recreated-a",
          fileType: "html",
          content: editedAContent,
        }).content;
        const retryCarrier = fileDeletionUndoStackRef.current[0] as
          | (FileDeletionHistoryEntry & {
              restoredFiles?: FileDeletionHistorySnapshot[];
            })
          | undefined;
        expect(retryCarrier?.files.map((file) => file.id)).toEqual([
          "screen-b",
        ]);
        expect(retryCarrier?.restoredFiles).toMatchObject([
          {
            id: finalAId,
            content: expectedNormalizedA,
            screenMetadata: editedMetadataA,
            geometry: editedGeometryA,
          },
        ]);
        expect(expectedNormalizedA).not.toBe(editedAContent);
      }

      runDeletionUndo();
      await vi.waitFor(() => {
        expect(fileHistoryMutationPendingRef.current).toBe(false);
        expect(fileDeletionUndoStackRef.current).toEqual([]);
      });

      expect(createNames).toEqual(
        recreateAAgain
          ? ["a.html", "b.html", "a.html", "b.html"]
          : ["a.html", "b.html", "b.html"],
      );
      expect(designDataJsonRef.current.screenMetadata).toMatchObject({
        [finalAId]: finalMetadataA,
        "recreated-b": metadataB,
      });
      expect(designDataJsonRef.current.localhostScreens).toMatchObject({
        [finalAId]: localhostA,
        "recreated-b": localhostB,
      });
      expect(designDataJsonRef.current.canvasFrames).toMatchObject({
        [finalAId]: finalGeometryA,
        "recreated-b": geometryB,
      });
      expect(
        (designDataJsonRef.current.designVariantSets as Record<string, any>)[
          "variant-set"
        ].screens.map((screen: { id: string }) => screen.id),
      ).toEqual([finalAId, "recreated-b"]);
      const restoredIds = new Set([finalAId, "recreated-b"]);
      expect(
        Object.values(
          designDataJsonRef.current.designVariantSets as Record<string, any>,
        ).flatMap((set: any) =>
          set.screens.map((screen: { id: string }) => screen.id),
        ),
      ).toEqual(expect.arrayContaining([...restoredIds]));
      const finalRedoEntry = fileDeletionRedoStackRef.current[
        fileDeletionRedoStackRef.current.length - 1
      ] as
        | (FileDeletionHistoryEntry & {
            restoredFiles?: FileDeletionHistorySnapshot[];
          })
        | undefined;
      expect(finalRedoEntry?.files.map((file) => file.id)).toEqual(
        expect.arrayContaining([finalAId, "recreated-b"]),
      );
      expect(finalRedoEntry?.files).toHaveLength(2);
      expect(
        finalRedoEntry?.files.find((file) => file.id === finalAId),
      ).toMatchObject({
        screenMetadata: finalMetadataA,
        localhostScreen: localhostA,
        geometry: finalGeometryA,
      });
      expect(finalRedoEntry?.restoredFiles).toBeUndefined();
      for (const oldId of [fileA.id, fileB.id]) {
        expect(designDataJsonRef.current.screenMetadata).not.toHaveProperty(
          oldId,
        );
        expect(designDataJsonRef.current.localhostScreens).not.toHaveProperty(
          oldId,
        );
        expect(designDataJsonRef.current.canvasFrames).not.toHaveProperty(
          oldId,
        );
        expect(
          JSON.stringify(designDataJsonRef.current.designVariantSets),
        ).not.toContain(oldId);
      }
      if (recreateAAgain) {
        expect(designDataJsonRef.current.screenMetadata).not.toHaveProperty(
          "recreated-a",
        );
        expect(designDataJsonRef.current.localhostScreens).not.toHaveProperty(
          "recreated-a",
        );
        expect(designDataJsonRef.current.canvasFrames).not.toHaveProperty(
          "recreated-a",
        );
      }
    },
  );
});
