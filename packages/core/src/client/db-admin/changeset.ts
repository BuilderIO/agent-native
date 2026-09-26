import { useCallback, useMemo, useState } from "react";

import type {
  DbAdminTableSchema,
  DbAdminMutation,
} from "../../db-admin/types.js";

export interface NewRow {
  _localId: string;
  values: Record<string, unknown>;
}

export interface Changeset {
  edits: Map<string, Record<string, unknown>>;
  newRows: NewRow[];
  deletedKeys: Set<string>;
}

export interface UseChangesetResult {
  edits: Map<string, Record<string, unknown>>;
  newRows: NewRow[];
  deletedKeys: Set<string>;

  canEdit: boolean;

  setCell: (pk: string, col: string, value: unknown) => void;
  setCells: (pk: string, values: Record<string, unknown>) => void;
  addRow: (seed?: Record<string, unknown>) => string;
  setNewRowCell: (localId: string, col: string, value: unknown) => void;
  removeNewRow: (localId: string) => void;
  deleteRows: (pks: string[]) => void;
  undeleteRows: (pks: string[]) => void;
  revertCell: (pk: string, col: string) => void;
  discardAll: () => void;

  isCellDirty: (pk: string, col: string) => boolean;
  getStagedCell: (pk: string, col: string) => { value: unknown } | undefined;
  isDeleted: (pk: string) => boolean;

  isDirty: boolean;
  pendingCount: number;

  buildMutation: (
    originalRows: Map<string, Record<string, unknown>>,
    dryRun?: boolean,
  ) => DbAdminMutation;
}

export function pkStringFor(
  schema: DbAdminTableSchema | undefined,
  row: Record<string, unknown>,
): string {
  const cols =
    schema && schema.primaryKey.length > 0
      ? schema.primaryKey
      : Object.keys(row).sort();
  return JSON.stringify(cols.map((c) => row[c] ?? null));
}

function whereFor(
  schema: DbAdminTableSchema | undefined,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (schema && schema.primaryKey.length > 0) {
    const where: Record<string, unknown> = {};
    for (const col of schema.primaryKey) where[col] = row[col] ?? null;
    return where;
  }
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
        if (deletedKeys.has(pk)) continue;
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
