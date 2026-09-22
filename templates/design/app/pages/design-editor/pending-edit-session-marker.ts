export interface PendingEditSessionMarker {
  count: number;
  updatedAt: number;
}

export type PendingEditSessionMarkerResult =
  | { status: "absent" }
  | { status: "present"; marker: PendingEditSessionMarker }
  | { status: "unavailable"; reason: string };

const STORAGE_KEY_PREFIX = "agent-native:visual-edit-pending:";

function storageKey(designId: string): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(designId)}`;
}

function isMarker(value: unknown): value is PendingEditSessionMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as Partial<PendingEditSessionMarker>;
  return (
    Number.isSafeInteger(marker.count) &&
    (marker.count ?? 0) > 0 &&
    Number.isSafeInteger(marker.updatedAt) &&
    (marker.updatedAt ?? 0) > 0
  );
}

export function readPendingEditSessionMarker(
  designId: string | null | undefined,
): PendingEditSessionMarkerResult {
  if (!designId) return { status: "absent" };
  if (typeof window === "undefined") {
    return { status: "unavailable", reason: "browser storage is unavailable" };
  }
  try {
    const raw = window.localStorage.getItem(storageKey(designId));
    if (raw === null) return { status: "absent" };
    const parsed: unknown = JSON.parse(raw);
    return isMarker(parsed)
      ? { status: "present", marker: parsed }
      : { status: "unavailable", reason: "stored marker is invalid" };
  } catch {
    return {
      status: "unavailable",
      reason: "browser storage could not be read",
    };
  }
}

export function writePendingEditSessionMarker(
  designId: string | null | undefined,
  count: number,
): { status: "stored" } | { status: "unavailable"; reason: string } {
  if (!designId || !Number.isSafeInteger(count) || count <= 0) {
    return { status: "unavailable", reason: "pending marker input is invalid" };
  }
  if (typeof window === "undefined") {
    return { status: "unavailable", reason: "browser storage is unavailable" };
  }
  try {
    window.localStorage.setItem(
      storageKey(designId),
      JSON.stringify({ count, updatedAt: Date.now() }),
    );
    return { status: "stored" };
  } catch {
    return {
      status: "unavailable",
      reason: "browser storage could not be written",
    };
  }
}

export function clearPendingEditSessionMarker(
  designId: string | null | undefined,
): { status: "cleared" } | { status: "unavailable"; reason: string } {
  if (!designId) return { status: "cleared" };
  if (typeof window === "undefined") {
    return { status: "unavailable", reason: "browser storage is unavailable" };
  }
  try {
    window.localStorage.removeItem(storageKey(designId));
    return { status: "cleared" };
  } catch {
    return {
      status: "unavailable",
      reason: "browser storage could not be cleared",
    };
  }
}
