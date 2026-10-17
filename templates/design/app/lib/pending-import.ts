import { toast } from "sonner";

import type { PreparedFigImport } from "./fig-client-import";

export type PendingDesignImport = { kind: "file"; file: File };

// Shared by the home picker and the editor's import panel so one loading toast
// spans creating the design, opening the editor, and the import itself.
export const FIG_IMPORT_TOAST_ID = "design-fig-import-progress";

export interface FigImportToastOwner {
  handoff: boolean;
}

// Only the most recent import may update or dismiss the shared toast, so an
// older import finishing in the background cannot clobber a newer one.
let toastOwner: FigImportToastOwner | null = null;

export function claimFigImportToast(handoff = false): FigImportToastOwner {
  toastOwner = { handoff };
  return toastOwner;
}

export function updateFigImportToast(
  owner: FigImportToastOwner,
  message: string,
  description: string,
) {
  if (toastOwner !== owner) return;
  toast.loading(message, { id: FIG_IMPORT_TOAST_ID, description });
}

export function releaseFigImportToast(owner: FigImportToastOwner): boolean {
  if (toastOwner !== owner) return false;
  toastOwner = null;
  return true;
}

export function dismissFigImportToast(owner: FigImportToastOwner) {
  if (releaseFigImportToast(owner)) toast.dismiss(FIG_IMPORT_TOAST_ID);
}

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

// The editor can remount the import panel while a large file is still being
// analyzed. The decoded file is parked briefly so the new panel resumes it
// instead of losing minutes of work; unclaimed files are freed after the TTL.
const PARKED_FIG_IMPORT_TTL_MS = 10_000;
const parkedFigImports = new Map<
  string,
  { prepared: PreparedFigImport; timer: ReturnType<typeof setTimeout> }
>();
const parkedFigImportListeners = new Set<(designId: string) => void>();

export function parkPreparedFigImport(
  designId: string,
  prepared: PreparedFigImport,
) {
  takeParkedFigImport(designId)?.dispose();
  const timer = setTimeout(() => {
    parkedFigImports.delete(designId);
    prepared.dispose();
  }, PARKED_FIG_IMPORT_TTL_MS);
  parkedFigImports.set(designId, { prepared, timer });
  for (const listener of parkedFigImportListeners) listener(designId);
}

export function takeParkedFigImport(
  designId: string,
): PreparedFigImport | undefined {
  const entry = parkedFigImports.get(designId);
  if (!entry) return undefined;
  clearTimeout(entry.timer);
  parkedFigImports.delete(designId);
  return entry.prepared;
}

export function onFigImportParked(listener: (designId: string) => void) {
  parkedFigImportListeners.add(listener);
  return () => {
    parkedFigImportListeners.delete(listener);
  };
}

// Returning home abandons every handoff (including failed ones kept for the
// editor's retry card). A handoff toast nothing took over is stale; a running
// import owns its own toast and keeps it.
export function discardPendingDesignImports() {
  pendingImports.clear();
  for (const designId of [...parkedFigImports.keys()]) {
    takeParkedFigImport(designId)?.dispose();
  }
  if (toastOwner?.handoff) dismissFigImportToast(toastOwner);
}
