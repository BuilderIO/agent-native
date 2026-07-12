import { useCallback, useMemo, useState } from "react";

import type {
  DbAdminTableSchema,
  DbAdminMutation,
} from "../../db-admin/types.js";

/**
 * The staged-changeset model — the production-grade core of the table editor.
 *
 * Edits are NOT committed on blur. Instead every cell edit, new row, and
 * deletion accumulates here until the user explicitly commits (Cmd/Ctrl+S or
 * the Commit button), at which point {@link buildMutation} maps the staged
 * state into a single {@link DbAdminMutation}. Until then the grid renders the
 * staged values overlaid on the fetched rows, and the user can discard
 * everything.
 *
 * Rows are keyed by a stable primary-key string (the table's PK column values
 * joined). If a table has no primary key, edits target a full-row `where`
 * match instead, and the consumer should warn / disable editing.
 */

/** New rows get a temporary client id so the grid can track them pre-insert. */
export interface NewRow {
  /** Stable client-only id, e.g. `new:0`. Never sent to the server. */
  _localId: string;
  values: Record<string, unknown>;
}

export interface Changeset {
  /** rowPkString → { column → newValue }. */
  edits: Map<string, Record<string, unknown>>;
  /** Staged inserts. */
  newRows: NewRow[];
  /** rowPkString of rows staged for deletion. */
  deletedKeys: Set<string>;
}

export interface UseChangesetResult {
  edits: Map<string, Record<string, unknown>>;
  newRows: NewRow[];
  deletedKeys: Set<string>;

  /** Whether editing is possible (requires a primary key on the table). */
  canEdit: boolean;

  /** Stage a single cell edit on an existing row. */
  setCell: (pk: string, col: string, value: unknown) => void;
  /** Stage many cell edits on one existing row at once. */
  setCells: (pk: string, values: Record<string, unknown>) => void;
  /** Append a blank new row (optionally seeded) and return its local id. */
  addRow: (seed?: Record<string, unknown>) => string;
  /** Patch a staged new row's values. */
  setNewRowCell: (localId: string, col: string, value: unknown) => void;
  /** Remove a staged new row entirely. */
  removeNewRow: (localId: string) => void;
  /** Stage existing rows for deletion (by pk string). Toggles off if re-staged. */
  deleteRows: (pks: string[]) => void;
  /** Un-stage a deletion. */
  undeleteRows: (pks: string[]) => void;
  /** Clear a single staged cell edit (revert to original). */
  revertCell: (pk: string, col: string) => void;
  /** Drop everything. */
  discardAll: () => void;

  /** Whether a given existing-row cell is dirty. */
  isCellDirty: (pk: string, col: string) => boolean;
  /** The staged value for a cell, if any. */
  getStagedCell: (pk: string, col: string) => { value: unknown } | undefined;
  /** Whether an existing row is staged for deletion. */
  isDeleted: (pk: string) => boolean;

  isDirty: boolean;
  /** Total count of pending changes (edited rows + new rows + deletions). */
  pendingCount: number;

  /**
   * Build the mutation payload. `originalRows` maps pk string → the original
   * fetched row, used to construct the `where` clause for updates/deletes.
   */
  buildMutation: (
    originalRows: Map<string, Record<string, unknown>>,
    dryRun?: boolean,
  ) => DbAdminMutation;
}

/** Compute the stable pk string for a row given the schema's primary key. */
export function pkStringFor(
  schema: DbAdminTableSchema | undefined,
  row: Record<string, unknown>,
): string {
  const cols =
    schema && schema.primaryKey.length > 0
      ? schema.primaryKey
      : // No PK: fall back to a full-row signature so each row is distinct.
        Object.keys(row).sort();
  return JSON.stringify(cols.map((c) => row[c] ?? null));
}

/** Build the `where` object that uniquely identifies an existing row. */
function whereFor(
  schema: DbAdminTableSchema | undefined,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (schema && schema.primaryKey.length > 0) {
    const where: Record<string, unknown> = {};
    for (const col of schema.primaryKey) where[col] = row[col] ?? null;
    return where;
  }
  // No PK — match the full original row.
  return { ...row };
}

export function useChangeset(
  schema: DbAdminTableSchema | undefined,
): UseChangesetResult {
  const [edits, setEdits] = useState<Map<string, Record<string, unknown>>>(
    () => new Map(),
  );
  const [newRows, setNewRows] = useState<NewRow[]>([]);
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(() => new Set());

  const canEdit = !!schema && schema.primaryKey.length > 0;

  const setCell = useCallback((pk: string, col: string, value: unknown) => {
    setEdits((prev) => {
      const next = new Map(prev);
      const row = { ...(next.get(pk) ?? {}) };
      row[col] = value;
      next.set(pk, row);
      return next;
    });
  }, []);

  const setCells = useCallback(
    (pk: string, values: Record<string, unknown>) => {
      setEdits((prev) => {
        const next = new Map(prev);
        const row = { ...(next.get(pk) ?? {}), ...values };
        next.set(pk, row);
        return next;
      });
    },
    [],
  );

  const revertCell = useCallback((pk: string, col: string) => {
    setEdits((prev) => {
      if (!prev.has(pk)) return prev;
      const next = new Map(prev);
      const row = { ...next.get(pk)! };
      delete row[col];
      if (Object.keys(row).length === 0) next.delete(pk);
      else next.set(pk, row);
      return next;
    });
  }, []);

  const addRow = useCallback((seed?: Record<string, unknown>) => {
    const localId = `new:${Math.random().toString(36).slice(2)}`;
    setNewRows((prev) => [...prev, { _localId: localId, values: seed ?? {} }]);
    return localId;
  }, []);

  const setNewRowCell = useCallback(
    (localId: string, col: string, value: unknown) => {
      setNewRows((prev) =>
        prev.map((r) =>
          r._localId === localId
            ? { ...r, values: { ...r.values, [col]: value } }
            : r,
        ),
      );
    },
    [],
  );

  const removeNewRow = useCallback((localId: string) => {
    setNewRows((prev) => prev.filter((r) => r._localId !== localId));
  }, []);

  const deleteRows = useCallback((pks: string[]) => {
    setDeletedKeys((prev) => {
      const next = new Set(prev);
      for (const pk of pks) {
        if (next.has(pk)) next.delete(pk);
        else next.add(pk);
      }
      return next;
    });
  }, []);

  const undeleteRows = useCallback((pks: string[]) => {
    setDeletedKeys((prev) => {
      const next = new Set(prev);
      for (const pk of pks) next.delete(pk);
      return next;
    });
  }, []);

  const discardAll = useCallback(() => {
    setEdits(new Map());
    setNewRows([]);
    setDeletedKeys(new Set());
  }, []);

  const isCellDirty = useCallback(
    (pk: string, col: string) =>
      edits.has(pk) && Object.prototype.hasOwnProperty.call(edits.get(pk), col),
    [edits],
  );

  const getStagedCell = useCallback(
    (pk: string, col: string) => {
      const row = edits.get(pk);
      if (row && Object.prototype.hasOwnProperty.call(row, col)) {
        return { value: row[col] };
      }
      return undefined;
    },
    [edits],
  );

  const isDeleted = useCallback(
    (pk: string) => deletedKeys.has(pk),
    [deletedKeys],
  );

  const pendingCount = useMemo(() => {
    // An edited row that is also deleted only counts once (as a deletion).
    let editedNotDeleted = 0;
    for (const pk of edits.keys()) {
      if (!deletedKeys.has(pk)) editedNotDeleted += 1;
    }
    return editedNotDeleted + newRows.length + deletedKeys.size;
  }, [edits, newRows, deletedKeys]);

  const isDirty = pendingCount > 0;

  const buildMutation = useCallback(
    (
      originalRows: Map<string, Record<string, unknown>>,
      dryRun?: boolean,
    ): DbAdminMutation => {
      const inserts: Record<string, unknown>[] = newRows
        .map((r) => r.values)
        .filter((v) => Object.keys(v).length > 0);

      const updates: DbAdminMutation["updates"] = [];
      for (const [pk, set] of edits.entries()) {
        if (deletedKeys.has(pk)) continue; // deletion supersedes edit
        const original = originalRows.get(pk);
        if (!original) continue;
        if (Object.keys(set).length === 0) continue;
        updates.push({ where: whereFor(schema, original), set });
      }

      const deletes: Record<string, unknown>[] = [];
      for (const pk of deletedKeys) {
        const original = originalRows.get(pk);
        if (!original) continue;
        deletes.push(whereFor(schema, original));
      }

      const mutation: DbAdminMutation = {};
      if (inserts.length) mutation.inserts = inserts;
      if (updates.length) mutation.updates = updates;
      if (deletes.length) mutation.deletes = deletes;
      if (dryRun) mutation.dryRun = true;
      return mutation;
    },
    [edits, newRows, deletedKeys, schema],
  );

  return {
    edits,
    newRows,
    deletedKeys,
    canEdit,
    setCell,
    setCells,
    addRow,
    setNewRowCell,
    removeNewRow,
    deleteRows,
    undeleteRows,
    revertCell,
    discardAll,
    isCellDirty,
    getStagedCell,
    isDeleted,
    isDirty,
    pendingCount,
    buildMutation,
  };
}
