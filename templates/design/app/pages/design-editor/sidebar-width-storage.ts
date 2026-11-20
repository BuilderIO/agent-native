export const LEFT_SIDEBAR_WIDTH_STORAGE_KEY = "design.editor.leftSidebarWidth";
export const INSPECTOR_WIDTH_STORAGE_KEY = "design.editor.inspectorWidth";

export type StoredSidebarWidth =
  | { kind: "stored"; width: number }
  | { kind: "absent" }
  | { kind: "unavailable"; error: unknown };

export function readStoredSidebarWidth(key: string): StoredSidebarWidth {
  if (typeof window === "undefined") return { kind: "absent" };
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return { kind: "absent" };
    const width = Number(raw);
    return Number.isFinite(width)
      ? { kind: "stored", width }
      : { kind: "absent" };
  } catch (error) {
    return { kind: "unavailable", error };
  }
}

export function storedSidebarWidthOr(
  stored: StoredSidebarWidth,
  fallback: number,
): number {
  return stored.kind === "stored" ? stored.width : fallback;
}

export function writeStoredSidebarWidth(
  key: string,
  width: number,
): { ok: true } | { ok: false; error: unknown } {
  if (typeof window === "undefined") return { ok: false, error: null };
  try {
    window.localStorage.setItem(key, String(width));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
