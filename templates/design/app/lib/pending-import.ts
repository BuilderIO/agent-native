import { toast } from "sonner";

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

// Returning home abandons every handoff (including failed ones kept for the
// editor's retry card). A handoff toast nothing took over is stale; a running
// import owns its own toast and keeps it.
export function discardPendingDesignImports() {
  pendingImports.clear();
  if (toastOwner?.handoff) dismissFigImportToast(toastOwner);
}
