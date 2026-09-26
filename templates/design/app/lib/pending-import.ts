export type PendingDesignImport = { kind: "file"; file: File };

// Files stay in memory across the SPA handoff, never in SQL or browser storage.
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
