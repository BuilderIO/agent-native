/**
 * Two-way navigation sync between the database admin UI and the agent.
 *
 * (a) `useDbAdminAgentSync` writes the current view into application state
 *     under the `navigation` key, so the agent's `<current-screen>` context
 *     knows which table/mode is open. Mirrors the template
 *     `use-navigation-state` write mechanism (PUT to the app-state route with a
 *     request-source header), but talks to the route directly since core has no
 *     template `TAB_ID`.
 *
 * (b) `useNavigateConsumer` short-polls the one-shot `navigate` app-state key.
 *     When the agent sets `{ view: "database", table }`, the consumer invokes
 *     `onNavigate(table)` then DELETEs the key so it fires exactly once.
 */
import { useEffect, useRef } from "react";

import { agentNativePath } from "../api-path.js";

const NAVIGATION_PATH = agentNativePath(
  "/_agent-native/application-state/navigation",
);
const NAVIGATE_PATH = agentNativePath(
  "/_agent-native/application-state/navigate",
);

const POLL_INTERVAL_MS = 1500;

let cachedSource: string | null = null;

function requestSource(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedSource) return cachedSource;
  try {
    const existing = window.sessionStorage.getItem("agentnative.tabId");
    if (existing) {
      cachedSource = existing;
      return existing;
    }
    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tab-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem("agentnative.tabId", generated);
    cachedSource = generated;
    return generated;
  } catch {
    return undefined;
  }
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  const source = requestSource();
  if (source) h["X-Request-Source"] = source;
  return h;
}

export interface DbAdminNavigationState {
  view: "database";
  table: string | null;
  mode: "table" | "sql";
}

export interface UseDbAdminAgentSyncArgs {
  table: string | null;
  mode: "table" | "sql";
}

/**
 * Write the current database-admin view to application state whenever the
 * selected table or mode changes, so the agent always knows what the user is
 * looking at.
 */
export function useDbAdminAgentSync({
  table,
  mode,
}: UseDbAdminAgentSyncArgs): void {
  useEffect(() => {
    const state: DbAdminNavigationState = { view: "database", table, mode };
    fetch(NAVIGATION_PATH, {
      method: "PUT",
      keepalive: true,
      credentials: "include",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [table, mode]);
}

interface NavigateCommand {
  view?: string;
  table?: string | null;
}

/**
 * Poll the one-shot `navigate` app-state key. When the agent requests a jump to
 * a database table, invoke `onNavigate(table)` then clear the key so it does
 * not replay on the next poll.
 */
export function useNavigateConsumer(onNavigate: (table: string) => void): void {
  const handlerRef = useRef(onNavigate);
  handlerRef.current = onNavigate;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (!active) return;
      try {
        const res = await fetch(NAVIGATE_PATH, {
          method: "GET",
          credentials: "include",
          headers: headers(),
        });
        if (active && res.ok) {
          const data = (await res.json()) as NavigateCommand | null;
          if (
            data &&
            data.view === "database" &&
            typeof data.table === "string" &&
            data.table
          ) {
            const target = data.table;
            // Clear the one-shot command before acting so it fires once.
            fetch(NAVIGATE_PATH, {
              method: "DELETE",
              credentials: "include",
              headers: headers({ "X-Agent-Native-CSRF": "1" }),
            }).catch(() => {});
            handlerRef.current(target);
          }
        }
      } catch {
        // Ignore transient errors; the next tick retries.
      } finally {
        if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
}
