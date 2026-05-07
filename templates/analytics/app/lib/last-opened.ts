type LastOpenedItemType = "dashboard" | "analysis" | "extension";

type LastOpenedItem = {
  type: LastOpenedItemType;
  id: string;
  path: string;
  updatedAt: number;
};

const LAST_OPENED_KEY = "analytics-last-opened:v1";

function isLastOpenedItem(value: unknown): value is LastOpenedItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    (item.type === "dashboard" ||
      item.type === "analysis" ||
      item.type === "extension") &&
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.path === "string" &&
    (item.path.startsWith("/adhoc/") ||
      item.path.startsWith("/analyses/") ||
      item.path.startsWith("/extensions/")) &&
    typeof item.updatedAt === "number"
  );
}

export function rememberLastOpened(
  type: LastOpenedItemType,
  id: string,
  path: string,
): void {
  if (typeof window === "undefined" || !id || !path) return;
  try {
    window.localStorage.setItem(
      LAST_OPENED_KEY,
      JSON.stringify({ type, id, path, updatedAt: Date.now() }),
    );
  } catch {
    // localStorage unavailable — fall back to the static landing default.
  }
}

export function getLastOpenedPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_OPENED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isLastOpenedItem(parsed) ? parsed.path : null;
  } catch {
    return null;
  }
}
