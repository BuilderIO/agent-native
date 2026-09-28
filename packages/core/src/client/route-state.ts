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
import { getBrowserTabId } from "./browser-tab-id.js";
import {
  navigateWithAgentChatViewTransition,
  type AgentChatViewTransitionOptions,
} from "./chat-view-transition.js";
import { postAgentNativeWorkspaceAppRoute } from "./workspace-app-navigation.js";

const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

export interface SemanticNavigationCommandEnvelope<NavigateCommand> {
  key: string;
  command: NavigateCommand;
}

export interface UseSemanticNavigationStateOptions<
  NavigationState,
  NavigateCommand = NavigationState,
> {
  state: NavigationState | null | undefined;
  navigationKeys?: readonly string[];
  commandKeys?: readonly string[];
  browserTabId?: string;
  commandQueryKey?: QueryKey;
  requestSource?: string;
  commandRefetchInterval?: number | false;
  enabled?: boolean;
  keepalive?: boolean;
  writeDebounceMs?: number;
  getCommandDedupKey?: (command: NavigateCommand) => string;
  onCommand: (command: NavigateCommand) => void | Promise<void>;
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
  getNavigationState: (
    location: AgentRouteLocation,
  ) => NavigationState | null | undefined;
  getCommandPath: (command: NavigateCommand) => string | null | undefined;
  navigationKey?: string;
  commandKey?: string;
  browserTabId?: string;
  requestSource?: string;
  writeGlobalNavigation?: boolean;
  readGlobalCommandFallback?: boolean;
  commandQueryKey?: QueryKey;
  refetchInterval?: number | false;
  enabled?: boolean;
  keepalive?: boolean;
  writeDebounceMs?: number;
  getCommandDedupKey?: (command: NavigateCommand) => string;
  navigateOptions?:
    | NavigateOptions
    | ((command: NavigateCommand) => NavigateOptions | undefined);
  agentChatViewTransition?:
    | boolean
    | AgentChatViewTransitionOptions
    | ((
        command: NavigateCommand,
        path: string,
      ) => boolean | AgentChatViewTransitionOptions | undefined);
  onNavigate?: (command: NavigateCommand, path: string) => void;
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

function defaultBrowserTabId(): string | undefined {
  return typeof window === "undefined"
    ? undefined
    : normalizeBrowserTabId(getBrowserTabId());
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

export function useSemanticNavigationState<
  NavigationState,
  NavigateCommand = NavigationState,
>(
  options: UseSemanticNavigationStateOptions<NavigationState, NavigateCommand>,
): UseSemanticNavigationStateResult<NavigationState, NavigateCommand> {
  const {
    commandRefetchInterval = 15_000,
    enabled = true,
    keepalive = true,
    writeDebounceMs = 0,
  } = options;

  const browserTabId = useMemo(
    () =>
      normalizeBrowserTabId(options.browserTabId) ??
      (options.browserTabId === undefined ? defaultBrowserTabId() : undefined),
    [options.browserTabId],
  );
  const requestSource = options.requestSource ?? browserTabId;

  const queryClient = useQueryClient();
  const navigationKeys = useMemo(
    () =>
      uniqueKeys(
        options.navigationKeys ?? [
          appStateKeyForBrowserTab("navigation", browserTabId),
        ],
      ),
    [browserTabId, options.navigationKeys],
  );
  const commandKeys = useMemo(
    () =>
      uniqueKeys(
        options.commandKeys ?? [
          appStateKeyForBrowserTab("navigate", browserTabId),
        ],
      ),
    [browserTabId, options.commandKeys],
  );
  const commandQueryKey = useMemo<QueryKey>(
    () =>
      options.commandQueryKey ?? ["navigate-command", browserTabId ?? "global"],
    [browserTabId, options.commandQueryKey],
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

export function useAgentRouteState<
  NavigationState,
  NavigateCommand = NavigationState,
>(
  options: UseAgentRouteStateOptions<NavigationState, NavigateCommand>,
): UseAgentRouteStateResult<NavigationState, NavigateCommand> {
  const { navigationKey = "navigation", commandKey = "navigate" } = options;

  const location = useLocation();
  const navigate = useNavigate();
  const browserTabId = useMemo(
    () =>
      normalizeBrowserTabId(options.browserTabId) ??
      (options.browserTabId === undefined ? defaultBrowserTabId() : undefined),
    [options.browserTabId],
  );
  const writeGlobalNavigation = options.writeGlobalNavigation ?? false;
  const readGlobalCommandFallback = options.readGlobalCommandFallback ?? false;

  useEffect(() => {
    if (options.enabled === false) return;
    postAgentNativeWorkspaceAppRoute(
      `${location.pathname}${location.search}${location.hash}`,
    );
  }, [location.hash, location.pathname, location.search, options.enabled]);

  const navigationKeys = useMemo(() => {
    const scopedKey = appStateKeyForBrowserTab(navigationKey, browserTabId);
    const keys = [scopedKey];
    if (browserTabId && writeGlobalNavigation) keys.push(navigationKey);
    return uniqueKeys(keys);
  }, [browserTabId, navigationKey, writeGlobalNavigation]);
  const commandKeys = useMemo(() => {
    const scopedKey = appStateKeyForBrowserTab(commandKey, browserTabId);
    const keys = [scopedKey];
    if (
      (!browserTabId || readGlobalCommandFallback) &&
      commandKey !== scopedKey
    )
      keys.push(commandKey);
    return uniqueKeys(keys);
  }, [browserTabId, commandKey, readGlobalCommandFallback]);
  const commandQueryKey = useMemo<QueryKey>(
    () =>
      options.commandQueryKey ?? [
        "navigate-command",
        browserTabId ?? "global",
        commandKey,
      ],
    [browserTabId, commandKey, options.commandQueryKey],
  );

  const routeLocation = useMemo(
    () => routeLocationFromReactRouter(location),
    [location],
  );
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
    browserTabId,
    requestSource: options.requestSource ?? browserTabId,
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
      void runNavigate();
    },
  });
}
