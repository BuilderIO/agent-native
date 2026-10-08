export type PendingDesignImport = { kind: "file"; file: File };

// Shared by the home picker and the editor's import panel so one loading toast
// spans creating the design, opening the editor, and the import itself.
export const FIG_IMPORT_TOAST_ID = "design-fig-import-progress";

const pendingImports = new Map<
  string,
  { value: PendingDesignImport; started: boolean }
>();

export function setPendingDesignImport(id: string, value: PendingDesignImport) {
  pendingImports.set(id, { value, started: false });
}

export function readPendingDesignImport(id: string) {
  return pendingImports.get(id)?.value;
}

export function claimPendingDesignImport(id: string) {
  const entry = pendingImports.get(id);
  if (!entry || entry.started) return undefined;
  entry.started = true;
  return entry.value;
}

export function clearPendingDesignImport(id: string) {
  pendingImports.delete(id);
}

// Drops imports whose editor never claimed them; returns whether any import
// is still running so callers know if the shared loading toast is stale.
export function discardUnclaimedPendingDesignImports(): boolean {
  let running = false;
  for (const [id, entry] of pendingImports) {
    if (entry.started) running = true;
    else pendingImports.delete(id);
  }
  return running;
}
