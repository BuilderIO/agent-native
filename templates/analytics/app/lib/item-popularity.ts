import { useEffect, useState } from "react";
import { useSession } from "@agent-native/core/client";
import { useOrg } from "@agent-native/core/client/org";

/**
 * Per-user view counts for sidebar items, stored in localStorage. Used to
 * sort dashboards and analyses by how often the signed-in user actually
 * opens them. Kept local (not synced cross-device) so the sidebar stays
 * snappy and doesn't need a server round-trip on every navigation.
 *
 * Storage is namespaced by `${email}:${orgId}` so signed-in users sharing
 * the same browser (or the same user switching between orgs) don't see each
 * other's counts. Writes before the session has loaded land under
 * `anonymous:none` and are migrated on sign-in.
 */

const KEY_PREFIX = "item-popularity:v1:";
const CHANGE_EVENT = "item-popularity-change";
const ANONYMOUS_SCOPE = "anonymous:none";

export type ItemType = "dashboard" | "analysis";
export type Popularity = Record<string, number>;

let currentScope = ANONYMOUS_SCOPE;

function scopeKey(scope: string): string {
  return `${KEY_PREFIX}${scope}`;
}

/**
 * Update the module-level scope used by imperative read/write helpers.
 * Called from `usePopularity` as soon as the session + active org resolve.
 * The first real scope absorbs any anonymous writes that happened before
 * sign-in so the user doesn't lose counts accumulated during page load.
 */
function setScope(next: string): void {
  if (next === currentScope) return;
  const previous = currentScope;
  currentScope = next;
  if (
    typeof window !== "undefined" &&
    previous === ANONYMOUS_SCOPE &&
    next !== ANONYMOUS_SCOPE
  ) {
    try {
      const pending = window.localStorage.getItem(scopeKey(ANONYMOUS_SCOPE));
      if (pending) {
        const parsed = JSON.parse(pending);
        if (parsed && typeof parsed === "object") {
          const existing = read();
          window.localStorage.setItem(
            scopeKey(next),
            JSON.stringify({ ...existing, ...parsed }),
          );
        }
        window.localStorage.removeItem(scopeKey(ANONYMOUS_SCOPE));
      }
    } catch {
      // ignore migration failures — scope switch still succeeds
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

function read(): Popularity {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(scopeKey(currentScope));
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
    window.localStorage.setItem(scopeKey(currentScope), JSON.stringify(p));
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
  const { session } = useSession();
  const { data: org } = useOrg();
  const email = session?.email?.trim() || "anonymous";
  const orgId = org?.orgId ?? "none";
  const nextScope = `${email}:${orgId}`;

  const [snapshot, setSnapshot] = useState<Popularity>(() => read());

  useEffect(() => {
    setScope(nextScope);
    setSnapshot(read());
  }, [nextScope]);

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
