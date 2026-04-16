import { useEffect, useState } from "react";

/**
 * Per-user view counts for sidebar items, stored in localStorage. Used to
 * sort dashboards and analyses by how often the signed-in user actually
 * opens them. Kept local (not synced cross-device) so the sidebar stays
 * snappy and doesn't need a server round-trip on every navigation.
 */

const KEY = "item-popularity:v1";
const CHANGE_EVENT = "item-popularity-change";

export type ItemType = "dashboard" | "analysis";
export type Popularity = Record<string, number>;

function read(): Popularity {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(p: Popularity): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // quota or private-mode — ignore, popularity is best-effort
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function incrementItemView(type: ItemType, id: string): void {
  if (!id) return;
  const p = read();
  const k = `${type}:${id}`;
  p[k] = (p[k] ?? 0) + 1;
  write(p);
}

export function usePopularity(): Popularity {
  const [snapshot, setSnapshot] = useState<Popularity>(() => read());
  useEffect(() => {
    const refresh = () => setSnapshot(read());
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return snapshot;
}

export function popularityOf(
  p: Popularity,
  type: ItemType,
  id: string,
): number {
  return p[`${type}:${id}`] ?? 0;
}
