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

import {
  removeAgentChatContextItem,
  setAgentChatContextItem,
} from "../agent-chat.js";
import { agentNativePath } from "../api-path.js";
import {
  deleteClientAppState,
  readClientAppState,
  setClientAppState,
} from "../application-state.js";

const NAVIGATION_PATH = agentNativePath(
  "/_agent-native/application-state/navigation",
);
const NAVIGATE_PATH = agentNativePath(
  "/_agent-native/application-state/navigate",
);

const POLL_INTERVAL_MS = 1500;
const TABLE_CONTEXT_KEY = "database-selected-table";
const SELECTED_OBJECT_STATE_KEY = "selected-object";
const SELECTED_OBJECT_SOURCE_FIELD = "__agentNativeSelectedObjectSource";

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

async function deleteSelectedObjectIfOwned(source: string | undefined) {
  if (!source) return;
  try {
    const current = await readClientAppState<Record<string, unknown>>(
      SELECTED_OBJECT_STATE_KEY,
    );
    if (current?.[SELECTED_OBJECT_SOURCE_FIELD] !== source) return;
    await deleteClientAppState(SELECTED_OBJECT_STATE_KEY, {
      keepalive: true,
      requestSource: source,
    });
  } catch {
    // Best effort only; stale selected-object context is less harmful than
    // clearing a selection owned by another tab.
  }
}

export interface DbAdminNavigationState {
  view: "database";
  table: string | null;
  mode: "table" | "sql";
}

export interface UseDbAdminAgentSyncArgs {
  table: string | null;
  mode: "table" | "sql";
  enabled?: boolean;
}

/**
 * Write the current database-admin view to application state whenever the
 * selected table or mode changes, so the agent always knows what the user is
 * looking at.
 */
export function useDbAdminAgentSync({
  table,
  mode,
  enabled = true,
}: UseDbAdminAgentSyncArgs): void {
  useEffect(() => {
    if (!enabled) return;
    const state: DbAdminNavigationState = { view: "database", table, mode };
    fetch(NAVIGATION_PATH, {
      method: "PUT",
      keepalive: true,
      credentials: "include",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [enabled, table, mode]);

  useEffect(() => {
    if (!enabled) return;
    const source = requestSource();
    if (!table) {
      removeAgentChatContextItem({
        key: TABLE_CONTEXT_KEY,
        openSidebar: false,
      });
      deleteSelectedObjectIfOwned(source);
      return;
    }

    const selection = {
      type: "database-table",
      table,
      mode,
      [SELECTED_OBJECT_SOURCE_FIELD]: source,
    };
    setAgentChatContextItem({
      key: TABLE_CONTEXT_KEY,
      title: `Table: ${table}`,
      context: [
        `The user currently has this database table selected: ${table}.`,
        `Database admin mode: ${mode}`,
        "Use the database admin actions and current-screen context to inspect rows, schema, or run SQL against this table.",
      ].join("\n"),
      openSidebar: false,
      focus: false,
    });
    setClientAppState(SELECTED_OBJECT_STATE_KEY, selection, {
      keepalive: true,
      requestSource: source,
    }).catch(() => {});

    return () => {
      removeAgentChatContextItem({
        key: TABLE_CONTEXT_KEY,
        openSidebar: false,
      });
      deleteSelectedObjectIfOwned(source);
    };
  }, [enabled, table, mode]);
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
export function useNavigateConsumer(
  onNavigate: (table: string) => void,
  enabled = true,
): void {
  const handlerRef = useRef(onNavigate);
  handlerRef.current = onNavigate;

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);
}
