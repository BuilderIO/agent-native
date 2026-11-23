import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Cell, CellContents } from "@/lib/model/contracts";

import { createEditSaveController } from "./edit-save-controller";
import type { NotebookActionError } from "./types";
import {
  cellContentsWithText,
  editableCellText,
  toNotebookError,
} from "./utils";

export interface CellDraftState {
  value: string;
  base: string;
  baseUpdatedAt?: string;
  saving: boolean;
  error: NotebookActionError | null;
}

export type CellDraftMap = Readonly<Record<string, CellDraftState>>;

export interface CellDrafts {
  drafts: CellDraftMap;
  savingAny: boolean;
  textFor: (cell: Cell) => string;
  isDirty: (cell: Cell) => boolean;
  isStale: (cell: Cell) => boolean;
  isSaving: (cellId: string) => boolean;
  update: (cell: Cell, text: string, autosave?: number | false) => void;
  discard: (cell: Cell) => void;
  rebase: (cell: Cell) => void;
  clearError: (cellId: string) => void;
  waitForSave: (cellId: string) => Promise<string | void>;
  flushInputs: (
    isCurrent: () => boolean,
    suppressReactiveRun?: boolean,
    onlyCellIds?: ReadonlySet<string>,
  ) => Promise<boolean>;
  save: (
    cell: Cell,
    valueOverride?: string,
    throwOnError?: boolean,
    allowStale?: boolean,
    inputOptionsResultId?: string,
    suppressReactiveRun?: boolean,
  ) => Promise<boolean>;
}

export function useCellDrafts({
  cells,
  onSaveCell,
}: {
  cells: readonly Cell[];
  onSaveCell: (
    cellId: string,
    contents: CellContents,
    expectedUpdatedAt?: string,
    inputOptionsResultId?: string,
    suppressReactiveRun?: boolean,
  ) => Promise<string | void>;
}): CellDrafts {
  const savePromises = useRef(
    new Map<string, { value: string; promise: Promise<string | void> }>(),
  );
  const acknowledgements = useRef(
    new Map<
      string,
      Array<{
        value: string;
        revision?: string;
        previous: string;
        previousRevision?: string;
      }>
    >(),
  );
  const acknowledgedByUs = (
    cellId: string,
    base: string,
    persisted: string,
    revision: string | undefined,
  ) => {
    const history = acknowledgements.current.get(cellId) ?? [];
    return (
      history.some((entry) => entry.value === base) &&
      history.some(
        (entry) =>
          (entry.value === persisted && entry.revision === revision) ||
          (entry.previous === persisted && entry.previousRevision === revision),
      )
    );
  };
  const [drafts, setDrafts] = useState<CellDraftMap>({});
  // Autosave timing lives in the headless controller (edit-save-controller.ts);
  // this hook only supplies the save callback and follows the persisted text.
  const autosaveRef = useRef<
    ReturnType<typeof createEditSaveController> | undefined
  >(undefined);
  if (autosaveRef.current == null) {
    autosaveRef.current = createEditSaveController();
  }
  // A save callback captured before the last keystroke must still write the text
  // the person can see: the newest drafts live here, not only in the closure.
  const draftsRef = useRef<CellDraftMap>(drafts);
  draftsRef.current = drafts;
  const updateDrafts = useCallback(
    (update: (previous: CellDraftMap) => CellDraftMap) => {
      const next = update(draftsRef.current);
      draftsRef.current = next;
      setDrafts(next);
    },
    [],
  );
  const saveLatestRef = useRef<(cellId: string) => Promise<boolean>>(
    async () => true,
  );
  const cellsRef = useRef<readonly Cell[]>(cells);
  cellsRef.current = cells;

  // A page that is being hidden or closed still owes its last keystrokes to the
  // server: the debounce has not elapsed yet, so flush it here instead of waiting.
  // `visibilitychange` fires before `pagehide` in every browser we ship to, which
  // is what makes a close-right-after-typing keep the edit.
  useEffect(() => {
    const autosave = autosaveRef.current;
    const flushPending = () => {
      void autosave?.flushAll();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushPending();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushPending);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushPending);
      // A same-document route change unmounts this hook without hiding the
      // document, so neither listener above runs: send what is queued instead of
      // cancelling it, or returning to the notebook loses the last keystrokes.
      void autosave?.flushAll();
    };
  }, []);

  // Follow persisted text when there is no draft, and drop drafts the parent
  // has caught up with. A dirty draft or a just-saved optimistic value is kept.
  useEffect(() => {
    updateDrafts((previous) => {
      let changed = false;
      const next: Record<string, CellDraftState> = {};
      for (const [cellId, draft] of Object.entries(previous)) {
        const cell = cells.find((candidate) => candidate.id === cellId);
        if (cell == null) {
          changed = true;
          continue;
        }
        const persisted = editableCellText(cell.contents);
        if (persisted == null) {
          next[cellId] = draft;
          continue;
        }
        if (
          !draft.saving &&
          draft.error === null &&
          persisted === draft.value
        ) {
          changed = true;
          continue;
        }
        next[cellId] = draft;
      }
      return changed ? next : previous;
    });
  }, [cells]);

  const textFor = useCallback(
    (cell: Cell): string => {
      const draft = drafts[cell.id];
      if (draft != null) return draft.value;
      return editableCellText(cell.contents) ?? "";
    },
    [drafts],
  );

  const isDirty = useCallback(
    (cell: Cell): boolean => {
      const draft = drafts[cell.id];
      return draft != null && draft.value !== draft.base;
    },
    [drafts],
  );

  const isStale = useCallback(
    (cell: Cell): boolean => {
      const draft = drafts[cell.id];
      const persisted = editableCellText(cell.contents);
      return (
        draft != null &&
        persisted != null &&
        draft.value !== draft.base &&
        persisted !== draft.base &&
        !acknowledgedByUs(cell.id, draft.base, persisted, cell.updatedAt)
      );
    },
    [drafts],
  );

  const update = useCallback(
    (cell: Cell, text: string, autosave?: number | false) => {
      const persisted = editableCellText(cell.contents);
      if (persisted == null) return;
      if (autosave !== false)
        autosaveRef.current?.edit(
          cell.id,
          () => saveLatestRef.current(cell.id),
          autosave,
        );
      updateDrafts((previous) => {
        const draft = previous[cell.id];
        const base = draft?.base ?? persisted;
        if (text === base && draft?.saving !== true && draft?.error == null) {
          if (draft == null) return previous;
          const next = { ...previous };
          delete next[cell.id];
          return next;
        }
        return {
          ...previous,
          [cell.id]: {
            value: text,
            base,
            baseUpdatedAt: draft?.baseUpdatedAt ?? cell.updatedAt,
            saving: draft?.saving ?? false,
            error: draft?.error ?? null,
          },
        };
      });
    },
    [],
  );

  const discard = useCallback((cell: Cell) => {
    autosaveRef.current?.cancel(cell.id);
    updateDrafts((previous) => {
      if (previous[cell.id] == null) return previous;
      const next = { ...previous };
      delete next[cell.id];
      return next;
    });
  }, []);

  const rebase = useCallback((cell: Cell) => {
    const persisted = editableCellText(cell.contents);
    if (persisted == null) return;
    updateDrafts((previous) => {
      const draft = previous[cell.id];
      if (draft == null) return previous;
      if (draft.value === persisted) {
        const next = { ...previous };
        delete next[cell.id];
        return next;
      }
      return {
        ...previous,
        [cell.id]: { ...draft, base: persisted, error: null },
      };
    });
  }, []);

  const clearError = useCallback((cellId: string) => {
    updateDrafts((previous) => {
      const draft = previous[cellId];
      if (draft == null || draft.error == null) return previous;
      return {
        ...previous,
        [cellId]: { ...draft, error: null },
      };
    });
  }, []);

  const save = useCallback(
    async (
      cell: Cell,
      valueOverride?: string,
      throwOnError = false,
      allowStale = false,
      inputOptionsResultId?: string,
      suppressReactiveRun = false,
    ): Promise<boolean> => {
      // Run and Publish save through this path too: drop the queued autosave.
      autosaveRef.current?.cancel(cell.id);
      const persisted = editableCellText(cell.contents);
      if (persisted == null) return true;
      const current = draftsRef.current[cell.id];
      const value = valueOverride ?? current?.value ?? persisted;
      let base = current?.base ?? persisted;
      let expectedUpdatedAt = allowStale
        ? cell.updatedAt
        : (current?.baseUpdatedAt ?? cell.updatedAt);
      if (
        !allowStale &&
        current != null &&
        current.value !== current.base &&
        persisted !== current.base &&
        !acknowledgedByUs(cell.id, current.base, persisted, cell.updatedAt)
      ) {
        return false;
      }
      let previousSave = savePromises.current.get(cell.id);
      while (previousSave) {
        try {
          const revision = await previousSave.promise;
          if (previousSave.value === value) return true;
          base = previousSave.value;
          if (revision !== undefined) expectedUpdatedAt = revision;
          const nextSave = savePromises.current.get(cell.id);
          previousSave = nextSave === previousSave ? undefined : nextSave;
        } catch (error) {
          if (throwOnError) throw error;
          return false;
        }
      }
      if (value === base && current?.error == null) return true;

      updateDrafts((previous) => ({
        ...previous,
        [cell.id]: {
          ...previous[cell.id],
          value: previous[cell.id]?.value ?? value,
          base,
          baseUpdatedAt: expectedUpdatedAt,
          saving: true,
          error: null,
        },
      }));

      try {
        const args = [
          cell.id,
          cellContentsWithText(cell.contents, value),
          expectedUpdatedAt,
        ] as const;
        const saving = suppressReactiveRun
          ? onSaveCell(...args, inputOptionsResultId, true)
          : inputOptionsResultId !== undefined
            ? onSaveCell(...args, inputOptionsResultId)
            : onSaveCell(...args);
        savePromises.current.set(cell.id, { value, promise: saving });
        let savedUpdatedAt: string | void;
        try {
          savedUpdatedAt = await saving;
        } finally {
          if (savePromises.current.get(cell.id)?.promise === saving)
            savePromises.current.delete(cell.id);
        }
        acknowledgements.current.set(cell.id, [
          ...(acknowledgements.current.get(cell.id) ?? []).slice(-15),
          {
            value,
            ...(savedUpdatedAt === undefined
              ? {}
              : { revision: savedUpdatedAt }),
            previous: persisted,
            previousRevision: cell.updatedAt,
          },
        ]);
        updateDrafts((previous) => {
          const draft = previous[cell.id];
          if (draft == null) return previous;
          return {
            ...previous,
            [cell.id]: {
              ...draft,
              base: value,
              ...(savedUpdatedAt === undefined
                ? {}
                : { baseUpdatedAt: savedUpdatedAt }),
              saving: false,
              error: null,
            },
          };
        });
        return true;
      } catch (error) {
        updateDrafts((previous) => {
          const draft = previous[cell.id];
          const latest = draft?.value ?? value;
          return {
            ...previous,
            [cell.id]: {
              ...draft,
              value:
                cell.contents.kind === "input" && latest === value
                  ? base
                  : latest,
              base: draft?.base ?? base,
              baseUpdatedAt: draft?.baseUpdatedAt ?? expectedUpdatedAt,
              saving: false,
              error: toNotebookError(error),
            },
          };
        });
        if (throwOnError) throw error;
        return false;
      }
    },
    [drafts, onSaveCell],
  );

  // The autosave controller calls this: resolve the cell by id at save time so a
  // queued save always uses the newest text and the newest save callback.
  useEffect(() => {
    saveLatestRef.current = async (cellId: string): Promise<boolean> => {
      const cell = cellsRef.current.find(
        (candidate) => candidate.id === cellId,
      );
      if (cell == null) return true;
      return save(cell);
    };
  }, [save]);

  const savingAny = useMemo(
    () => Object.values(drafts).some((draft) => draft.saving),
    [drafts],
  );

  const isSaving = useCallback(
    (cellId: string): boolean => drafts[cellId]?.saving === true,
    [drafts],
  );

  const flushInputs = useCallback(
    async (
      isCurrent: () => boolean,
      suppressReactiveRun = false,
      onlyCellIds?: ReadonlySet<string>,
    ): Promise<boolean> => {
      const inputIds = cellsRef.current
        .filter(
          (cell) =>
            cell.contents.kind === "input" &&
            (onlyCellIds === undefined || onlyCellIds.has(cell.id)),
        )
        .map((cell) => cell.id);
      for (const cellId of inputIds) {
        for (;;) {
          if (!isCurrent()) return false;
          const cell = cellsRef.current.find(
            (candidate) => candidate.id === cellId,
          );
          if (cell == null || cell.contents.kind !== "input") return false;
          if (
            cell.contents.inputType !== "NUMERIC_INPUT" &&
            cell.contents.inputType !== "TEXT_INPUT" &&
            cell.contents.inputType !== "SLIDER"
          ) {
            const pending = savePromises.current.get(cellId);
            if (pending === undefined) break;
            try {
              await pending.promise;
            } catch (error) {
              if (draftsRef.current[cellId]?.error) return false;
              throw error;
            }
            continue;
          }
          const value = draftsRef.current[cellId]?.value;
          if (
            !(await save(
              cell,
              undefined,
              false,
              false,
              undefined,
              suppressReactiveRun,
            ))
          )
            return false;
          if (!isCurrent()) return false;
          if (draftsRef.current[cellId]?.value === value) break;
        }
      }
      return true;
    },
    [save],
  );

  return {
    drafts,
    savingAny,
    textFor,
    isDirty,
    isStale,
    isSaving,
    update,
    discard,
    rebase,
    clearError,
    waitForSave: async (cellId) =>
      await savePromises.current.get(cellId)?.promise,
    flushInputs,
    save,
  };
}
