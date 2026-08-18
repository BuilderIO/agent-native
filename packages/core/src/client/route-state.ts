import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useLocation,
  useNavigate,
  type Location,
  type NavigateOptions,
} from "react-router";

import { isWorkspaceAppPath } from "./api-path.js";
import {
  deleteClientAppState,
  readClientAppState,
  setClientAppState,
} from "./application-state.js";
import {
  navigateWithAgentChatViewTransition,
  type AgentChatViewTransitionOptions,
} from "./chat-view-transition.js";

const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

export interface SemanticNavigationCommandEnvelope<NavigateCommand> {
  key: string;
  command: NavigateCommand;
}

export interface UseSemanticNavigationStateOptions<
  NavigationState,
  NavigateCommand = NavigationState,
> {
  /**
   * Compact, semantic screen state to expose to the agent: view names, record
   * IDs, active tabs, and useful aliases. Keep URL query params in the URL
   * unless the app needs a human-readable semantic alias.
   */
  state: NavigationState | null | undefined;
  /** Application-state keys the UI should write. Defaults to [`navigation`]. */
  navigationKeys?: readonly string[];
  /** Application-state keys to read for one-shot agent commands. Defaults to [`navigate`]. */
  commandKeys?: readonly string[];
  /** React Query key used for command polling/cache. Defaults to [`navigate-command`]. */
  commandQueryKey?: QueryKey;
  /** Request source tag for `useDbSync({ ignoreSource })` jitter prevention. */
  requestSource?: string;
  /**
   * Poll interval for command reads.
   * Defaults to 15 000 ms — a safety-net fallback for agents that bypass the
   * useDbSync event path. useDbSync already invalidates `navigate-command` on
   * app-state writes in real time, so the fallback only fires when the SSE/poll
   * connection is unavailable. Pass false to disable polling entirely.
   */
  commandRefetchInterval?: number | false;
  /** Disable both navigation writes and command reads. */
  enabled?: boolean;
  /** Navigation writes use keepalive by default because they often fire during unload. */
  keepalive?: boolean;
  /** Debounce navigation writes. Defaults to 0ms. */
  writeDebounceMs?: number;
  /** Custom duplicate-command key. Defaults to `_writeId` or JSON content. */
  getCommandDedupKey?: (command: NavigateCommand) => string;
  /** Called once for each non-duplicate command after the command is consumed. */
  onCommand: (command: NavigateCommand) => void | Promise<void>;
  /** Optional sink for best-effort navigation write/read/delete/command errors. */
  onError?: (error: unknown) => void;
}

export interface UseSemanticNavigationStateResult<
  NavigationState,
  NavigateCommand = NavigationState,
> {
  navigationState: NavigationState | null;
  command:
    | SemanticNavigationCommandEnvelope<NavigateCommand>
    | null
    | undefined;
  commandQueryKey: QueryKey;
  clearCommand: () => Promise<void>;
}

export interface AgentRouteLocation {
  pathname: string;
  search: string;
  hash: string;
  searchParams: URLSearchParams;
  location: Location;
}

export interface UseAgentRouteStateOptions<
  NavigationState,
  NavigateCommand = NavigationState,
> {
  /**
   * Derive compact, semantic screen state from the current React Router URL.
   * The framework separately exposes raw `pathname`, `search`, and parsed
   * `searchParams` through `<current-url>`.
   */
  getNavigationState: (
    location: AgentRouteLocation,
  ) => NavigationState | null | undefined;
  /**
   * Convert an agent-authored one-shot command into an app-local React Router
   * path. Return null to consume and ignore malformed or unsupported commands.
   */
  getCommandPath: (command: NavigateCommand) => string | null | undefined;
  /** Application-state key the UI writes. Defaults to `navigation`. */
  navigationKey?: string;
  /** Application-state key the agent writes for one-shot navigation. */
  commandKey?: string;
  /** Current browser tab id. Enables tab-scoped reads/writes. */
  browserTabId?: string;
  /** Request source tag for `useDbSync({ ignoreSource })` jitter prevention. */
  requestSource?: string;
  /**
   * Also write the unscoped navigation key when browserTabId is present.
   * Defaults to true so CLI/external agents still have a useful fallback.
   */
  writeGlobalNavigation?: boolean;
  /**
   * Fall back to the unscoped command key when no tab-scoped command exists.
   * Defaults to true for backwards compatibility with existing navigate tools.
   */
  readGlobalCommandFallback?: boolean;
  /** React Query key used for command polling/cache. */
  commandQueryKey?: QueryKey;
  /**
   * Poll interval for command reads.
   * Defaults to 15 000 ms — a safety-net fallback; useDbSync real-time events
   * cover the common case. Pass false to disable polling.
   */
  refetchInterval?: number | false;
  /** Disable both navigation writes and command reads. */
  enabled?: boolean;
  /** Navigation writes use keepalive by default because they often fire during unload. */
  keepalive?: boolean;
  /** Debounce navigation writes. Defaults to 0ms. */
  writeDebounceMs?: number;
  /** Custom duplicate-command key. Defaults to `_writeId` or JSON content. */
  getCommandDedupKey?: (command: NavigateCommand) => string;
  /** React Router navigate options, or a function of the consumed command. */
  navigateOptions?:
    | NavigateOptions
    | ((command: NavigateCommand) => NavigateOptions | undefined);
  /**
   * Wrap agent-authored route commands in the shared chat view transition.
   * Use this when a page-level chat surface should morph into AgentSidebar.
   */
  agentChatViewTransition?:
    | boolean
    | AgentChatViewTransitionOptions
    | ((
        command: NavigateCommand,
        path: string,
      ) => boolean | AgentChatViewTransitionOptions | undefined);
  /** Called after a command is consumed and before React Router navigation. */
  onNavigate?: (command: NavigateCommand, path: string) => void;
  /** Optional sink for best-effort navigation write/read/delete errors. */
  onError?: (error: unknown) => void;
}

export interface UseAgentRouteStateResult<
  NavigationState,
  NavigateCommand = NavigationState,
> extends UseSemanticNavigationStateResult<NavigationState, NavigateCommand> {}

function normalizeBrowserTabId(browserTabId?: string): string | undefined {
  if (typeof browserTabId !== "string") return undefined;
  const trimmed = browserTabId.trim();
  return SAFE_BROWSER_TAB_ID_RE.test(trimmed) ? trimmed : undefined;
}

function appStateKeyForBrowserTab(key: string, browserTabId?: string): string {
  return browserTabId ? `${key}:${browserTabId}` : key;
}

function routeLocationFromReactRouter(location: Location): AgentRouteLocation {
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    searchParams: new URLSearchParams(location.search),
    location,
  };
}

function uniqueKeys(keys: readonly string[]): string[] {
  return Array.from(new Set(keys));
}

function defaultCommandDedupKey(command: unknown): string {
  if (command && typeof command === "object" && "_writeId" in command) {
    const writeId = (command as { _writeId?: unknown })._writeId;
    if (typeof writeId === "string" && writeId) return writeId;
  }
  return JSON.stringify(command);
}

function currentRouterPath(location: Location): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

function shallowEqualNavigationState(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  for (const key of leftKeys) {
    if (
      !Object.prototype.hasOwnProperty.call(right, key) ||
      !Object.is(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      )
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Dedup token for the navigation write. Unserializable state falls back to the
 * state's own identity, never a fresh symbol: the caller's `navigationKeys` is
 * usually a new array each render, so a symbol recomputed here would never
 * match the last one and every re-render would issue another failing write.
 * Identity still lets a genuinely different state reach the write path.
 */
function navigationWriteDedupToken(
  keys: readonly string[],
  state: unknown,
): unknown {
  try {
    const serialized = JSON.stringify({ keys, state });
    if (typeof serialized === "string") return serialized;
  } catch {
    // coercion-ok: deferred, not dropped — the write below still rejects with
    // this error and reports it through `onError`.
  }
  return state;
}

function resolveAgentChatViewTransitionOption<NavigateCommand>(
  option: UseAgentRouteStateOptions<
    unknown,
    NavigateCommand
  >["agentChatViewTransition"],
  command: NavigateCommand,
  path: string,
): false | AgentChatViewTransitionOptions {
  const resolved =
    typeof option === "function" ? option(command, path) : option;
  if (!resolved) return false;
  if (resolved === true) return {};
  return resolved;
}

/**
 * Keeps semantic UI state agent-visible and consumes agent-authored one-shot
 * commands. This is the framework primitive behind route/navigation sync; it
 * intentionally knows nothing about app-specific route shapes.
 */
export function useSemanticNavigationState<
  NavigationState,
  NavigateCommand = NavigationState,
>(
  options: UseSemanticNavigationStateOptions<NavigationState, NavigateCommand>,
): UseSemanticNavigationStateResult<NavigationState, NavigateCommand> {
  const {
    requestSource,
    commandRefetchInterval = 15_000,
    enabled = true,
    keepalive = true,
    writeDebounceMs = 0,
  } = options;

  const queryClient = useQueryClient();
  const navigationKeys = useMemo(
    () => uniqueKeys(options.navigationKeys ?? ["navigation"]),
    [options.navigationKeys],
  );
  const commandKeys = useMemo(
    () => uniqueKeys(options.commandKeys ?? ["navigate"]),
    [options.commandKeys],
  );
  const commandQueryKey = useMemo<QueryKey>(
    () => options.commandQueryKey ?? ["navigate-command"],
    [options.commandQueryKey],
  );
  const navigationState = options.state ?? null;
  const navigationWriteDedup = useMemo(
    () => navigationWriteDedupToken(navigationKeys, navigationState),
    [navigationKeys, navigationState],
  );

  const getCommandDedupKeyRef = useRef(options.getCommandDedupKey);
  const onCommandRef = useRef(options.onCommand);
  const onErrorRef = useRef(options.onError);
  getCommandDedupKeyRef.current = options.getCommandDedupKey;
  onCommandRef.current = options.onCommand;
  onErrorRef.current = options.onError;

  // `null` is safe as "never written": a null state serializes to a string, so
  // the token itself is never null.
  const lastNavigationWriteRef = useRef<unknown>(null);

  useEffect(() => {
    if (!enabled) return;
    if (lastNavigationWriteRef.current === navigationWriteDedup) return;
    lastNavigationWriteRef.current = navigationWriteDedup;

    const write = () => {
      for (const key of navigationKeys) {
        setClientAppState(key, navigationState, {
          keepalive,
          requestSource,
        }).catch((error) => onErrorRef.current?.(error));
      }
    };

    if (writeDebounceMs > 0) {
      const timer = setTimeout(write, writeDebounceMs);
      return () => clearTimeout(timer);
    }
    write();
  }, [
    enabled,
    keepalive,
    navigationKeys,
    navigationState,
    navigationWriteDedup,
    requestSource,
    writeDebounceMs,
  ]);

  const commandQuery =
    useQuery<SemanticNavigationCommandEnvelope<NavigateCommand> | null>({
      queryKey: commandQueryKey,
      enabled,
      retry: false,
      refetchInterval: commandRefetchInterval,
      queryFn: async () => {
        for (const key of commandKeys) {
          const command = await readClientAppState<NavigateCommand>(key);
          if (command !== null && command !== undefined) {
            return { key, command };
          }
        }
        return null;
      },
    });

  const clearCommand = useCallback(async () => {
    await Promise.all(
      commandKeys.map((key) =>
        deleteClientAppState(key, { requestSource }).catch((error) => {
          onErrorRef.current?.(error);
        }),
      ),
    );
    queryClient.setQueryData(commandQueryKey, null);
  }, [commandKeys, commandQueryKey, queryClient, requestSource]);

  const lastProcessedDedupKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const envelope = commandQuery.data;
    if (!enabled || !envelope) return;

    const dedupKey =
      getCommandDedupKeyRef.current?.(envelope.command) ??
      defaultCommandDedupKey(envelope.command);
    const consume = () => {
      deleteClientAppState(envelope.key, { requestSource }).catch((error) =>
        onErrorRef.current?.(error),
      );
      queryClient.setQueryData(commandQueryKey, null);
    };

    if (lastProcessedDedupKeyRef.current === dedupKey) {
      consume();
      return;
    }
    lastProcessedDedupKeyRef.current = dedupKey;
    consume();

    Promise.resolve(onCommandRef.current(envelope.command)).catch((error) =>
      onErrorRef.current?.(error),
    );
  }, [commandQuery.data, commandQueryKey, enabled, queryClient, requestSource]);

  return {
    navigationState,
    command: commandQuery.data,
    commandQueryKey,
    clearCommand,
  };
}

/**
 * React Router convenience wrapper around `useSemanticNavigationState`.
 *
 * Use URL query params as the source of truth for shareable filters. This hook
 * writes semantic aliases and stable IDs to `navigation`; the framework's
 * built-in URL sync separately exposes raw `pathname`, `search`, and
 * `searchParams` through `<current-url>` and the `set-search-params` tool.
 */
export function useAgentRouteState<
  NavigationState,
  NavigateCommand = NavigationState,
>(
  options: UseAgentRouteStateOptions<NavigationState, NavigateCommand>,
): UseAgentRouteStateResult<NavigationState, NavigateCommand> {
  const {
    navigationKey = "navigation",
    commandKey = "navigate",
    writeGlobalNavigation = true,
    readGlobalCommandFallback = true,
  } = options;

  const location = useLocation();
  const navigate = useNavigate();
  const browserTabId = useMemo(
    () => normalizeBrowserTabId(options.browserTabId),
    [options.browserTabId],
  );
  const navigationKeys = useMemo(() => {
    const scopedKey = appStateKeyForBrowserTab(navigationKey, browserTabId);
    const keys = [scopedKey];
    if (browserTabId && writeGlobalNavigation) keys.push(navigationKey);
    return uniqueKeys(keys);
  }, [browserTabId, navigationKey, writeGlobalNavigation]);
  const commandKeys = useMemo(() => {
    const scopedKey = appStateKeyForBrowserTab(commandKey, browserTabId);
    const keys = [scopedKey];
    if (browserTabId && readGlobalCommandFallback) keys.push(commandKey);
    return uniqueKeys(keys);
  }, [browserTabId, commandKey, readGlobalCommandFallback]);
  const commandQueryKey = useMemo<QueryKey>(
    () =>
      options.commandQueryKey ?? [
        "navigate-command",
        commandKey,
        browserTabId ?? "global",
      ],
    [browserTabId, commandKey, options.commandQueryKey],
  );

  const routeLocation = useMemo(
    () => routeLocationFromReactRouter(location),
    [location],
  );
  // Callers may include app-local state in this callback in addition to the
  // router location. Derive on every render so those values are not frozen at
  // the last route change, then retain the previous object when its shallow
  // values are unchanged. This keeps the write-dedup serialization off the
  // unrelated-render path without hiding captured state updates.
  const derivedNavigationState =
    options.getNavigationState(routeLocation) ?? null;
  const navigationStateRef = useRef<NavigationState | null>(
    derivedNavigationState,
  );
  if (
    !shallowEqualNavigationState(
      navigationStateRef.current,
      derivedNavigationState,
    )
  ) {
    navigationStateRef.current = derivedNavigationState;
  }
  const navigationState = navigationStateRef.current;

  return useSemanticNavigationState<NavigationState, NavigateCommand>({
    state: navigationState,
    navigationKeys,
    commandKeys,
    commandQueryKey,
    requestSource: options.requestSource,
    commandRefetchInterval: options.refetchInterval,
    enabled: options.enabled,
    keepalive: options.keepalive,
    writeDebounceMs: options.writeDebounceMs,
    getCommandDedupKey: options.getCommandDedupKey,
    onError: options.onError,
    onCommand: (command) => {
      const path = options.getCommandPath(command);
      if (!path) return;
      options.onNavigate?.(command, path);
      if (path === currentRouterPath(location)) return;

      const navigateOptions = options.navigateOptions;
      const resolvedOptions =
        typeof navigateOptions === "function"
          ? navigateOptions(command)
          : navigateOptions;
      if (isWorkspaceAppPath(path)) {
        if (resolvedOptions?.replace) {
          window.location.replace(path);
        } else {
          window.location.assign(path);
        }
        return;
      }
      const transitionOptions = resolveAgentChatViewTransitionOption(
        options.agentChatViewTransition,
        command,
        path,
      );
      const runNavigate = () => navigate(path, resolvedOptions);
      if (transitionOptions) {
        navigateWithAgentChatViewTransition(navigate, path, resolvedOptions);
        return;
      }
      runNavigate();
    },
  });
}
