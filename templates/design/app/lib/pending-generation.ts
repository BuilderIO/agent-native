import type { UploadedFile } from "@/components/editor/PromptDialog";

export const PENDING_GENERATION_TTL_MS = 10 * 60 * 1000;

export interface PendingGeneration {
  prompt?: string;
  files?: UploadedFile[];
  title?: string;
  source?: string;
  createdAt?: number;
}

export function pendingGenerationKey(id: string): string {
  return `design.pending-generation.${id}`;
}

export function writePendingGeneration(
  id: string,
  pending: Omit<PendingGeneration, "createdAt">,
): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    pendingGenerationKey(id),
    JSON.stringify({ ...pending, createdAt: Date.now() }),
  );
}

export function clearPendingGeneration(id: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(pendingGenerationKey(id));
}

export function readPendingGeneration(
  id: string,
  options: { consume?: boolean; allowUntimestamped?: boolean } = {},
): PendingGeneration | null {
  if (typeof window === "undefined") return null;
  const key = pendingGenerationKey(id);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingGeneration;
    const createdAt =
      typeof parsed.createdAt === "number" ? parsed.createdAt : null;
    const stale =
      createdAt != null && Date.now() - createdAt > PENDING_GENERATION_TTL_MS;
    if (stale || (createdAt == null && !options.allowUntimestamped)) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    if (options.consume) {
      window.sessionStorage.removeItem(key);
    }
    return parsed;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

export function hasFreshPendingGeneration(id: string): boolean {
  return !!readPendingGeneration(id);
}
