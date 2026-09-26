import { useSession } from "@agent-native/core/client/hooks";
import { useOrg } from "@agent-native/core/client/org";
import { useEffect, useState } from "react";


const KEY_PREFIX = "item-popularity:v1:";
const CHANGE_EVENT = "item-popularity-change";
const ANONYMOUS_SCOPE = "anonymous:none";

export type ItemType = "dashboard" | "analysis" | "extension";
export type Popularity = Record<string, number>;
export type PopularityState = {
  data: Popularity;
  isReady: boolean;
};

let currentScope = ANONYMOUS_SCOPE;

function scopeKey(scope: string): string {
  return `${KEY_PREFIX}${scope}`;
}

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

export function usePopularity(): PopularityState {
  const { session, isLoading: sessionLoading } = useSession();
  const { data: org, isLoading: orgLoading } = useOrg();
  const email = session?.email?.trim() || "anonymous";
  const orgId = org?.orgId ?? "none";
  const nextScope = `${email}:${orgId}`;

  const [snapshot, setSnapshot] = useState<Popularity>(() => read());
  const [readyScope, setReadyScope] = useState<string | null>(null);

  useEffect(() => {
    setScope(nextScope);
    setSnapshot(read());
    setReadyScope(nextScope);
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
  return {
    data: snapshot,
    isReady: !sessionLoading && !orgLoading && readyScope === nextScope,
  };
}

export function popularityOf(
  p: Popularity,
  type: ItemType,
  id: string,
): number {
  return p[`${type}:${id}`] ?? 0;
}
