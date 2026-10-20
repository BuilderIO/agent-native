import type { TextCommitStatus } from "@/pages/design-editor/command-types";

export type QueuePendingTextHostCommit = (
  owner: string,
  nodeId: string,
  text: string,
  onSettled?: (outcome: "accepted" | "failed") => void,
) => boolean;

export type CancelPendingTextHostCommit = (
  owner: string,
  nodeId: string,
) => void;

type PendingTextCreation = {
  owner: string;
  nodeId: string;
  active: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
};

export type PendingTextCreationOwners = Map<string, PendingTextCreation>;

const MAX_PENDING_TEXT_CREATIONS = 64;
const PENDING_TEXT_CREATION_TTL_MS = 30_000;
const PENDING_TEXT_CREATION_CLEANUP_GRACE_MS = 5_000;

function pendingTextCreationKey(owner: string, nodeId: string): string {
  return JSON.stringify([owner, nodeId]);
}

function clearPendingTextCreationTimer(entry: PendingTextCreation): void {
  if (entry.cleanupTimer !== null) {
    clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = null;
  }
}

function schedulePendingTextCreationRemoval(
  pendingOwners: PendingTextCreationOwners,
  entry: PendingTextCreation,
  delayMs: number,
): void {
  clearPendingTextCreationTimer(entry);
  entry.cleanupTimer = setTimeout(() => {
    const key = pendingTextCreationKey(entry.owner, entry.nodeId);
    if (pendingOwners.get(key) !== entry) return;
    pendingOwners.delete(key);
    entry.cleanupTimer = null;
  }, delayMs);
}

export function registerPendingTextCreation(
  pendingOwners: PendingTextCreationOwners,
  owner: string,
  nodeId: string,
  isActiveEdit = false,
): void {
  if (!owner || !nodeId) return;
  const key = pendingTextCreationKey(owner, nodeId);
  const existing = pendingOwners.get(key);
  if (existing) {
    clearPendingTextCreationTimer(existing);
    pendingOwners.delete(key);
    pendingOwners.set(key, existing);
    if (isActiveEdit) existing.active = true;
    if (!existing.active) {
      schedulePendingTextCreationRemoval(
        pendingOwners,
        existing,
        PENDING_TEXT_CREATION_TTL_MS,
      );
    }
    return;
  }

  const entry: PendingTextCreation = {
    owner,
    nodeId,
    active: isActiveEdit,
    cleanupTimer: null,
  };
  pendingOwners.set(key, entry);
  while (pendingOwners.size > MAX_PENDING_TEXT_CREATIONS) {
    const oldestInactive = [...pendingOwners.entries()].find(
      ([, entry]) => !entry.active,
    );
    if (!oldestInactive) break;
    clearPendingTextCreationTimer(oldestInactive[1]);
    pendingOwners.delete(oldestInactive[0]);
  }
  if (!entry.active) {
    schedulePendingTextCreationRemoval(
      pendingOwners,
      entry,
      PENDING_TEXT_CREATION_TTL_MS,
    );
  }
}

export function retainPendingTextCreationForActiveEdit(
  pendingOwners: PendingTextCreationOwners,
  owner: string,
  nodeId: string,
): boolean {
  if (!owner || !nodeId) return false;
  const entry = pendingOwners.get(pendingTextCreationKey(owner, nodeId));
  for (const pendingEntry of pendingOwners.values()) {
    if (
      !pendingEntry.active ||
      (pendingEntry.owner === owner && pendingEntry.nodeId === nodeId)
    ) {
      continue;
    }
    pendingEntry.active = false;
    schedulePendingTextCreationRemoval(
      pendingOwners,
      pendingEntry,
      PENDING_TEXT_CREATION_CLEANUP_GRACE_MS,
    );
  }
  if (!entry) return false;
  entry.active = true;
  clearPendingTextCreationTimer(entry);
  return true;
}

export function deferPendingTextCreationCleanup(
  pendingOwners: PendingTextCreationOwners,
  owner?: string | null,
  nodeId?: string | null,
): void {
  for (const entry of pendingOwners.values()) {
    if (owner && entry.owner !== owner) continue;
    if (nodeId && entry.nodeId !== nodeId) continue;
    entry.active = false;
    schedulePendingTextCreationRemoval(
      pendingOwners,
      entry,
      PENDING_TEXT_CREATION_CLEANUP_GRACE_MS,
    );
  }
}

export function consumePendingTextCreation(
  pendingOwners: PendingTextCreationOwners,
  owner: string | null,
  sourceId: string | null,
): boolean {
  if (!owner || !sourceId) return false;
  const key = pendingTextCreationKey(owner, sourceId);
  const entry = pendingOwners.get(key);
  if (!entry) return false;
  clearPendingTextCreationTimer(entry);
  pendingOwners.delete(key);
  return true;
}

export function commitTextContentChange({
  owner,
  nodeId,
  value,
  isPendingTextCreation,
  commit,
  queueHostCommit,
  cancelHostCommit,
  requestSnapshot,
}: {
  owner: string | null;
  nodeId: string | null;
  value: string;
  isPendingTextCreation: boolean;
  commit: () => TextCommitStatus | void;
  queueHostCommit: QueuePendingTextHostCommit;
  cancelHostCommit: CancelPendingTextHostCommit;
  requestSnapshot: () => void;
}): "published" | "fallback-queued" {
  const canFallback = Boolean(
    isPendingTextCreation && owner && nodeId && value.length > 0,
  );
  const queueFallback = () => {
    if (!canFallback || !owner || !nodeId || value.length === 0) return false;
    return queueHostCommit(owner, nodeId, value, (outcome) => {
      if (outcome === "accepted") requestSnapshot();
    });
  };

  let status: TextCommitStatus | void;
  try {
    status = commit();
  } catch (error) {
    if (queueFallback()) return "fallback-queued";
    if (owner && nodeId) cancelHostCommit(owner, nodeId);
    throw error;
  }

  if (status === "refused" && canFallback) {
    if (queueFallback()) return "fallback-queued";
  }

  // Any later direct result supersedes an older retry. A retry must never
  // overwrite text that a newer source edit already accepted.
  if (owner && nodeId) cancelHostCommit(owner, nodeId);
  requestSnapshot();
  return "published";
}
