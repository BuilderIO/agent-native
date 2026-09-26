import { useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { useLocation, useNavigate } from "react-router";

import { agentNativePath, isWorkspaceAppPath } from "./api-path.js";
import { readClientAppState } from "./application-state.js";
import { rememberSettingsReturnPath } from "./settings/shell/return-path.js";
import { useScreenRefreshKey } from "./use-db-sync.js";
const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

export function URLSync({ browserTabId }: { browserTabId?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const normalizedBrowserTabId = React.useMemo(() => {
    if (typeof browserTabId !== "string") return undefined;
    const trimmed = browserTabId.trim();
    return SAFE_BROWSER_TAB_ID_RE.test(trimmed) ? trimmed : undefined;
  }, [browserTabId]);
  const appStateKey = React.useCallback(
    (key: string) =>
      normalizedBrowserTabId ? `${key}:${normalizedBrowserTabId}` : key,
    [normalizedBrowserTabId],
  );
  const setUrlQueryKey = React.useMemo(
    () => ["__set_url__", normalizedBrowserTabId ?? "global"],
    [normalizedBrowserTabId],
  );

  React.useEffect(() => {
    rememberSettingsReturnPath(location.pathname, location.search);
  }, [location.pathname, location.search]);

  // Outbound: write the current URL to app-state whenever it changes.
  React.useEffect(() => {
    const searchParams: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(location.search).entries()) {
      searchParams[k] = v;
    }
    const body = {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      searchParams,
    };
    const write = (key: string) =>
      fetch(agentNativePath(`/_agent-native/application-state/${key}`), {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    void write(appStateKey("__url__"));
    if (normalizedBrowserTabId) void write("__url__");
  }, [
    appStateKey,
    location.pathname,
    location.search,
    location.hash,
    normalizedBrowserTabId,
  ]);

  // Inbound: poll for URL-update commands from the agent. `useDbSync`
  // invalidates this key on every relevant app-state event, so default
  // `structuralSharing: true` is critical — without it, repeated reads of the
  // same stale command (when the consume-DELETE below races against the next
  // invalidation) churned the useEffect and re-applied the navigation in a
  // tight loop. With structural sharing on, the previous reference is reused
  // when the JSON is unchanged so the useEffect only fires when the command
  // actually changes; the `lastProcessedDedupKeyRef` below covers the residual
  // race window after the cache is cleared to `null`.
  const { data: command } = useQuery<{
    key: string;
    command: {
      pathname?: string;
      searchParams?: Record<string, string | null>;
      mergeSearchParams?: boolean;
      hash?: string;
      _writeId?: string;
    };
  } | null>({
    queryKey: setUrlQueryKey,
    queryFn: async () => {
      const read = async (key: string) => {
        const data = await readClientAppState<Record<string, unknown>>(key);
        return data ? { key, command: data } : null;
      };
      try {
        return (
          (normalizedBrowserTabId
            ? await read(appStateKey("__set_url__"))
            : null) ?? (await read("__set_url__"))
        );
      } catch {
        // coercion-ok: no readable command means there is no pending URL command to apply.
        return null;
      }
    },
    retry: false,
  });

  const lastProcessedDedupKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!command) return;
    const cmd = command.command;
    const dedupKey =
      cmd._writeId ??
      JSON.stringify({
        pathname: cmd.pathname,
        searchParams: cmd.searchParams,
        mergeSearchParams: cmd.mergeSearchParams,
        hash: cmd.hash,
      });
    if (lastProcessedDedupKeyRef.current === dedupKey) {
      // Same command we already handled — the DELETE below races against the
      // next polling refetch, so when it loses the same command can show up
      // again on the next tick. Re-fire DELETE and bail rather than navigate
      // again.
      fetch(
        agentNativePath(`/_agent-native/application-state/${command.key}`),
        {
          method: "DELETE",
          headers: { "X-Agent-Native-CSRF": "1" },
        },
      ).catch(() => {});
      queryClient.setQueryData(setUrlQueryKey, null);
      return;
    }
    lastProcessedDedupKeyRef.current = dedupKey;

    // Delete the one-shot command before applying so duplicate events
    // don't cause repeated navigation.
    fetch(agentNativePath(`/_agent-native/application-state/${command.key}`), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});
    try {
      const current = new URL(window.location.href);
      const nextPath = cmd.pathname ?? current.pathname;
      const nextSearch =
        cmd.mergeSearchParams !== false
          ? new URLSearchParams(current.search)
          : new URLSearchParams();
      if (cmd.searchParams) {
        for (const [k, v] of Object.entries(cmd.searchParams)) {
          if (v === null || v === "") nextSearch.delete(k);
          else nextSearch.set(k, v);
        }
      }
      const nextHash = cmd.hash ?? current.hash;
      const qs = nextSearch.toString();
      const url = nextPath + (qs ? `?${qs}` : "") + (nextHash || "");
      // Skip the navigation if the URL is already at the target state —
      // avoids needless react-router work and any revalidation side-effects
      // that come with it.
      // Mark that the agent just wrote the URL so consumers (e.g. a
      // dashboard restoring saved filter defaults) can skip any auto-
      // restore that would clobber the agent's change. Set this BEFORE
      // the same-URL short-circuit — a no-op nav is still an explicit
      // "agent authored this state" signal that consumers depend on.
      try {
        sessionStorage.setItem("__agentUrlAppliedAt__", String(Date.now()));
      } catch {
        // coercion-ok: sessionStorage is only a persistence hint; navigation remains valid.
      }
      const currentUrl =
        current.pathname + (current.search || "") + (current.hash || "");
      if (url === currentUrl) {
        queryClient.setQueryData(setUrlQueryKey, null);
        return;
      }
      // Replace rather than push so repeated agent URL updates don't
      // clutter the history stack and can't trigger extra remounts from
      // router navigation lifecycle.
      if (isWorkspaceAppPath(url)) {
        window.location.replace(url);
      } else {
        window.setTimeout(() => navigate(url, { replace: true }), 0);
      }
    } catch {
      // coercion-ok: malformed agent URL commands are intentionally ignored after cleanup.
    }
    queryClient.setQueryData(setUrlQueryKey, null);
  }, [command, navigate, queryClient, setUrlQueryKey]);

  return null;
}
/**
 * Remounts its children whenever the framework's `refresh-screen` tool is
 * invoked. Used inside AgentSidebar so the main content area re-fetches
 * without disturbing the chat sidebar's in-flight state.
 *
 * Two mechanisms work together here:
 *
 *  1. Before the remount, every react-query cache entry is marked stale
 *     via `invalidateQueries({ refetchType: "none" })`. This does NOT
 *     trigger a refetch on its own, so active queries elsewhere (chat
 *     sidebar, left nav) keep their current data — they'll refetch only
 *     on their next natural trigger.
 *  2. The React `key` then bumps, unmounting and remounting the subtree.
 *     On remount, child components re-subscribe to their queries, see
 *     the data is stale, and refetch — regardless of configured
 *     `staleTime`. This is what makes the dashboard pick up the agent's
 *     edits even when the query uses `staleTime: 30_000` or similar.
 */

export function ScreenRefreshBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  const key = useScreenRefreshKey();
  const queryClient = useQueryClient();
  const lastKeyRef = React.useRef(key);
  if (key !== lastKeyRef.current) {
    lastKeyRef.current = key;
    // Mark every cached query stale without kicking off a refetch. The
    // subtree-level refetches happen naturally when the new tree mounts
    // below and child components re-subscribe.
    void queryClient.invalidateQueries({ refetchType: "none" });
  }
  return <React.Fragment key={key}>{children}</React.Fragment>;
}
