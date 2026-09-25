export type PendingDesignImport = { kind: "file"; file: File };

// Files stay in memory across the SPA handoff, never in SQL or browser storage.
const pendingImports = new Map<string, PendingDesignImport>();

export function setPendingDesignImport(id: string, value: PendingDesignImport) {
  pendingImports.set(id, value);
}

export function readPendingDesignImport(id: string) {
  return pendingImports.get(id);
}

export function clearPendingDesignImport(id: string) {
  pendingImports.delete(id);
}
