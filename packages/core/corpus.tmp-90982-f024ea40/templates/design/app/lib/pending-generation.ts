import type { PromptComposerSubmitOptions } from "@agent-native/core/client";
import { sourceContentHash } from "@shared/source-workspace";

import type { UploadedFile } from "@/components/editor/PromptDialog";

// Pending generation state is a UI recovery aid, not a generation deadline.
// Keep it long enough for thorough designs while still clearing abandoned runs.
export const PENDING_GENERATION_STALE_MS = 30 * 60_000;

export interface PendingGeneration {
  prompt?: string;
  files?: UploadedFile[];
  title?: string;
  source?: string;
  templateId?: string;
  designSystemId?: string | null;
  model?: PromptComposerSubmitOptions["model"];
  engine?: PromptComposerSubmitOptions["engine"];
  effort?: PromptComposerSubmitOptions["effort"];
  autoGenerate?: boolean;
  skipQuestions?: boolean;
  attempt?: number;
  createdAt?: number;
  startedAt?: number;
  runTabId?: string;
  templateBaselineFiles?: Array<{ id: string; contentHash: string }>;
}

export function hasPendingGenerationOutput(
  pending: PendingGeneration | null,
  files: readonly {
    id: string;
    content: string;
    createdAt?: string | null;
    updatedAt?: string | null;
  }[],
): boolean {
  if (!pending?.templateId) return files.length > 0;

  if (pending.templateBaselineFiles?.length) {
    const baseline = new Map(
      pending.templateBaselineFiles.map((file) => [file.id, file.contentHash]),
    );
    return files.some(
      (file) =>
        !baseline.has(file.id) ||
        baseline.get(file.id) !== sourceContentHash(file.content),
    );
  }

  // Recovery for template refinements started before baseline hashes were
  // recorded. Freshly copied files have matching creation/update revisions;
  // only a later write is evidence that refinement produced output.
  return files.some(
    (file) =>
      Boolean(file.createdAt && file.updatedAt) &&
      file.createdAt !== file.updatedAt,
  );
}

export function pendingGenerationKey(id: string): string {
  return `design.pending-generation.${id}`;
}

export function writePendingGeneration(
  id: string,
  pending: PendingGeneration,
): void {
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
  id: string | undefined,
  patch: Partial<PendingGeneration>,
): void {
  if (typeof window === "undefined" || !id) return;
  const current = readPendingGeneration(id, { allowUntimestamped: true });
  writePendingGeneration(id, { ...(current ?? {}), ...patch });
}

export function clearPendingGeneration(id: string | undefined): void {
  if (typeof window === "undefined" || !id) return;
  try {
    window.sessionStorage.removeItem(pendingGenerationKey(id));
  } catch {
    // Storage may be unavailable.
  }
}

export function readPendingGeneration(
  id: string | undefined,
  options: { consume?: boolean; allowUntimestamped?: boolean } = {},
): PendingGeneration | null {
  if (typeof window === "undefined" || !id) return null;
  const key = pendingGenerationKey(id);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingGeneration;
    if (!parsed || typeof parsed !== "object") {
      window.sessionStorage.removeItem(key);
      return null;
    }
    const hasTimestamp =
      typeof parsed.createdAt === "number" ||
      typeof parsed.startedAt === "number";
    if (!hasTimestamp && !options.allowUntimestamped) return null;
    if (options.consume) {
      window.sessionStorage.removeItem(key);
    }
    return parsed;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

export function isPendingGenerationStale(
  pending: PendingGeneration | null,
  now = Date.now(),
): boolean {
  if (!pending) return false;
  const timestamp = pending.startedAt ?? pending.createdAt;
  return (
    typeof timestamp === "number" &&
    now - timestamp > PENDING_GENERATION_STALE_MS
  );
}

export function hasFreshPendingGeneration(id: string | undefined): boolean {
  const pending = readPendingGeneration(id);
  if (!pending) return false;
  if (isPendingGenerationStale(pending)) {
    clearPendingGeneration(id);
    return false;
  }
  return true;
}
