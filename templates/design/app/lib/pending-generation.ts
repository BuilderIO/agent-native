import type { UploadedFile } from "@/components/editor/PromptDialog";

export const PENDING_GENERATION_STALE_MS = 120_000;

export interface PendingGeneration {
  prompt?: string;
  files?: UploadedFile[];
  title?: string;
  source?: string;
  createdAt?: number;
  startedAt?: number;
  runTabId?: string;
}

export const pendingGenerationKey = (id: string) =>
  `design.pending-generation.${id}`;

export function readPendingGeneration(
  id: string | undefined,
): PendingGeneration | null {
  if (typeof window === "undefined" || !id) return null;
  try {
    const raw = window.sessionStorage.getItem(pendingGenerationKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as PendingGeneration)
      : null;
  } catch {
    return null;
  }
}

export function writePendingGeneration(
  id: string,
  pending: PendingGeneration,
) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      pendingGenerationKey(id),
      JSON.stringify({
        ...pending,
        createdAt: pending.createdAt ?? Date.now(),
      }),
    );
  } catch {
    // Storage may be unavailable; generation can still continue via chat.
  }
}

export function patchPendingGeneration(
  id: string,
  patch: Partial<PendingGeneration>,
) {
  const current = readPendingGeneration(id);
  writePendingGeneration(id, { ...(current ?? {}), ...patch });
}

export function clearPendingGeneration(id: string | undefined) {
  if (typeof window === "undefined" || !id) return;
  try {
    window.sessionStorage.removeItem(pendingGenerationKey(id));
  } catch {
    // Storage may be unavailable.
  }
}

export function isPendingGenerationStale(
  pending: PendingGeneration | null,
  now = Date.now(),
) {
  const timestamp =
    typeof pending?.startedAt === "number"
      ? pending.startedAt
      : pending?.createdAt;
  return typeof timestamp === "number"
    ? now - timestamp > PENDING_GENERATION_STALE_MS
    : false;
}

export function hasFreshPendingGeneration(id: string | undefined) {
  const pending = readPendingGeneration(id);
  if (!pending) return false;
  if (isPendingGenerationStale(pending)) {
    clearPendingGeneration(id);
    return false;
  }
  return true;
}
