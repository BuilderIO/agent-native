import {
  metadataBoolean,
  metadataNumber,
  metadataString,
  parseTriageMetadata,
  type TriageMetadata,
} from "./metadata.js";
import { deferBabysitQuietWindowExpired } from "./pr-babysit.js";

export type BabysitQueueTier = 0 | 1 | 2 | 3;

export type BabysitQueueCursor = {
  lastCheckedAt: string;
  lastId: string;
};

export type BabysitQueueRow = {
  id: string;
  updatedAt: string;
  metadataJson: string;
};

export function parseBabysitQueueCursor(
  value: string | null | undefined,
): BabysitQueueCursor | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const lastCheckedAt = record.lastCheckedAt;
    const lastId = record.lastId;
    if (typeof lastCheckedAt !== "string" || typeof lastId !== "string") {
      return null;
    }
    if (!lastCheckedAt.trim() || !lastId.trim()) return null;
    return { lastCheckedAt, lastId };
    // coercion-ok: corrupt persisted cursor reads as absent queue position
  } catch {
    return null;
  }
}

export function serializeBabysitQueueCursor(
  cursor: BabysitQueueCursor,
): string {
  return JSON.stringify({
    lastCheckedAt: cursor.lastCheckedAt,
    lastId: cursor.lastId,
  });
}

function babysitWorkSignals(metadata: TriageMetadata): boolean {
  if (metadataBoolean(metadata, "prBabysitChangesRequested") === true) {
    return true;
  }
  if (metadataBoolean(metadata, "prBabysitMergeConflict") === true) {
    return true;
  }
  const humanComments = metadataNumber(
    metadata,
    "prBabysitHumanReviewCommentCount",
  );
  if (typeof humanComments === "number" && humanComments > 0) return true;
  const humanBodies = metadataNumber(metadata, "prBabysitHumanReviewBodyCount");
  if (typeof humanBodies === "number" && humanBodies > 0) return true;
  const botKeys = metadata["prBabysitBotReviewBodyKeys"];
  if (Array.isArray(botKeys) && botKeys.length > 0) return true;
  return false;
}

export function babysitQueueTier(
  metadataJson: string,
  nowMs: number = Date.now(),
): BabysitQueueTier {
  const metadata = parseTriageMetadata(metadataJson);
  const state = metadataString(metadata, "prBabysitState");
  const pendingReopen = metadataBoolean(metadata, "prBabysitPendingReopen");
  if (state === "queued" || pendingReopen === true) return 0;

  const lastCommentAt = metadataString(metadata, "prBabysitLastCommentAt");
  const neverPinged = !lastCommentAt?.trim();
  if (neverPinged && babysitWorkSignals(metadata)) return 1;

  if (lastCommentAt?.trim()) {
    const deferExpired = deferBabysitQuietWindowExpired(metadata, nowMs);
    const quietLegacy = state === "quiet";
    if ((deferExpired || quietLegacy) && babysitWorkSignals(metadata)) {
      return 2;
    }
    if (state === "queued" && babysitWorkSignals(metadata)) return 2;
  }

  return 3;
}

export function compareBabysitQueueRows(
  left: BabysitQueueRow,
  right: BabysitQueueRow,
  nowMs: number = Date.now(),
): number {
  const leftTier = babysitQueueTier(left.metadataJson, nowMs);
  const rightTier = babysitQueueTier(right.metadataJson, nowMs);
  if (leftTier !== rightTier) return leftTier - rightTier;
  const updatedAtCompare = left.updatedAt.localeCompare(right.updatedAt);
  if (updatedAtCompare !== 0) return updatedAtCompare;
  return left.id.localeCompare(right.id);
}

function lastCheckedAtKey(metadataJson: string): string {
  return (
    metadataString(
      parseTriageMetadata(metadataJson),
      "prBabysitLastCheckedAt",
    ) ?? ""
  );
}

export function compareBabysitRoundRobinRows(
  left: BabysitQueueRow,
  right: BabysitQueueRow,
  cursor: BabysitQueueCursor | null,
): number {
  const leftChecked = lastCheckedAtKey(left.metadataJson);
  const rightChecked = lastCheckedAtKey(right.metadataJson);
  const leftAfterCursor = isAfterRoundRobinCursor(left, cursor);
  const rightAfterCursor = isAfterRoundRobinCursor(right, cursor);
  if (leftAfterCursor !== rightAfterCursor) {
    return leftAfterCursor ? -1 : 1;
  }
  const checkedCompare = leftChecked.localeCompare(rightChecked);
  if (checkedCompare !== 0) return checkedCompare;
  return left.id.localeCompare(right.id);
}

function isAfterRoundRobinCursor(
  row: BabysitQueueRow,
  cursor: BabysitQueueCursor | null,
): boolean {
  if (!cursor) return true;
  const checked = lastCheckedAtKey(row.metadataJson);
  const checkedCompare = checked.localeCompare(cursor.lastCheckedAt);
  if (checkedCompare !== 0) return checkedCompare > 0;
  return row.id.localeCompare(cursor.lastId) > 0;
}

function isAfterTier0Cursor(
  row: BabysitQueueRow,
  cursor: BabysitQueueCursor | null,
): boolean {
  if (!cursor) return true;
  const updatedCompare = row.updatedAt.localeCompare(cursor.lastCheckedAt);
  if (updatedCompare !== 0) return updatedCompare > 0;
  return row.id.localeCompare(cursor.lastId) > 0;
}

function compareBabysitTier0RoundRobinRows(
  left: BabysitQueueRow,
  right: BabysitQueueRow,
  cursor: BabysitQueueCursor | null,
): number {
  const leftAfterCursor = isAfterTier0Cursor(left, cursor);
  const rightAfterCursor = isAfterTier0Cursor(right, cursor);
  if (leftAfterCursor !== rightAfterCursor) {
    return leftAfterCursor ? -1 : 1;
  }
  return compareBabysitQueueRows(left, right);
}

export function sortBabysitQueueRows<T extends BabysitQueueRow>(
  rows: readonly T[],
  cursor: BabysitQueueCursor | null,
  nowMs: number = Date.now(),
): T[] {
  return [...rows].sort((left, right) => {
    const leftTier = babysitQueueTier(left.metadataJson, nowMs);
    const rightTier = babysitQueueTier(right.metadataJson, nowMs);
    if (leftTier !== rightTier) return leftTier - rightTier;
    if (leftTier === 0) {
      return compareBabysitTier0RoundRobinRows(left, right, cursor);
    }
    if (leftTier === 3) {
      return compareBabysitRoundRobinRows(left, right, cursor);
    }
    return compareBabysitQueueRows(left, right, nowMs);
  });
}

export function lastRoundRobinCursorCandidate(
  rows: readonly BabysitQueueRow[],
): BabysitQueueRow | null {
  let last: BabysitQueueRow | null = null;
  for (const row of rows) {
    if (babysitQueueTier(row.metadataJson) !== 3) continue;
    last = row;
  }
  return last;
}

function lastTier0CursorCandidate(
  rows: readonly BabysitQueueRow[],
): BabysitQueueRow | null {
  let last: BabysitQueueRow | null = null;
  for (const row of rows) {
    if (babysitQueueTier(row.metadataJson) !== 0) continue;
    last = row;
  }
  return last;
}

export function nextBabysitQueueCursor(
  listedRows: readonly BabysitQueueRow[],
): BabysitQueueCursor | null {
  const lastTier0 = lastTier0CursorCandidate(listedRows);
  if (lastTier0) {
    return {
      lastCheckedAt: lastTier0.updatedAt,
      lastId: lastTier0.id,
    };
  }
  const lastTier3 = lastRoundRobinCursorCandidate(listedRows);
  if (!lastTier3) return null;
  return {
    lastCheckedAt:
      lastCheckedAtKey(lastTier3.metadataJson) || lastTier3.updatedAt,
    lastId: lastTier3.id,
  };
}
