import { useCallback, useEffect, useMemo } from "react";

import {
  createAgentNativeBrowserSessionBridge,
  type AgentNativeBrowserSessionBridge,
} from "./browser-session-bridge.js";
import {
  readAgentNativeScreenContext,
  type AgentNativeClientActions,
  type AgentNativeHostCommandHandler,
  type AgentNativeHostCommandHandlers,
  type AgentNativeHostCommandRequest,
  type AgentNativeHostContext,
  type AgentNativeHostContextGetter,
  type AgentNativeHostSession,
  type AgentNativeScreenSnapshotOptions,
} from "./host-bridge.js";
import type { AgentNativeWebMcpClient } from "./webmcp.js";

export interface AgentNativeEmbeddedCommandCallbackInfo {
  command: string;
  requestId?: string;
  origin: string;
}

export type AgentNativeEmbeddedCommandCallback = (
  payload: unknown,
  info: AgentNativeEmbeddedCommandCallbackInfo,
) => unknown;

export interface AgentNativeEmbeddedBrowserSessionOptions {
  endpoint?: string;
  sessionId?: string;
  label?: string;
  heartbeatMs?: number;
  pollMs?: number;
  ttlMs?: number;
  fetch?: typeof fetch;
  onReady?: (bridge: AgentNativeBrowserSessionBridge) => void;
}

export interface UseAgentNativeEmbeddedBrowserSessionOptions {
  enabled?: boolean;
  actions?: AgentNativeClientActions;
  getContext?: AgentNativeHostContextGetter;
  screen?: boolean | AgentNativeScreenSnapshotOptions;
  commands?: AgentNativeHostCommandHandlers;
  webmcp?: AgentNativeWebMcpClient;
  session?: string | Partial<AgentNativeHostSession>;
  browserSession?: AgentNativeEmbeddedBrowserSessionOptions;
  onRefresh?: AgentNativeEmbeddedCommandCallback;
  onNavigate?: AgentNativeEmbeddedCommandCallback;
  onRemount?: AgentNativeEmbeddedCommandCallback;
  onOpenResource?: AgentNativeEmbeddedCommandCallback;
  onRequestApproval?: AgentNativeEmbeddedCommandCallback;
}

function mergeObject<T extends object>(
  base: T | undefined,
  override: T | undefined,
): T | undefined {
  if (!base && !override) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) } as T;
}

function mergeHostContext(
  base: AgentNativeHostContext,
  override: AgentNativeHostContext | undefined,
): AgentNativeHostContext {
  if (!override) return base;
  return {
    ...base,
    ...override,
    route: mergeObject(base.route, override.route),
    selection: mergeObject(base.selection, override.selection),
    screen: mergeObject(base.screen, override.screen),
  };
}

function toCommandHandler(
  callback: AgentNativeEmbeddedCommandCallback | undefined,
): AgentNativeHostCommandHandler | undefined {
  if (!callback) return undefined;
  return (request: AgentNativeHostCommandRequest) =>
    callback(request.payload, {
      command: request.command,
      requestId: request.requestId,
      origin: request.origin,
    });
}

function useMergedEmbeddedCommands({
  commands,
  onNavigate,
  onOpenResource,
  onRefresh,
  onRemount,
  onRequestApproval,
}: Pick<
  UseAgentNativeEmbeddedBrowserSessionOptions,
  | "commands"
  | "onNavigate"
  | "onOpenResource"
  | "onRefresh"
  | "onRemount"
  | "onRequestApproval"
>) {
  return useMemo(() => {
    const refreshHandler = toCommandHandler(onRefresh);
    const navigateHandler = toCommandHandler(onNavigate);
    const remountHandler = toCommandHandler(onRemount);
    const openResourceHandler = toCommandHandler(onOpenResource);
    const requestApprovalHandler = toCommandHandler(onRequestApproval);

    return {
      ...commands,
      ...(refreshHandler
        ? { refreshData: refreshHandler, "refresh-data": refreshHandler }
        : {}),
      ...(navigateHandler ? { navigate: navigateHandler } : {}),
      ...(remountHandler
        ? { remountView: remountHandler, "remount-view": remountHandler }
        : {}),
      ...(openResourceHandler
        ? {
            openResource: openResourceHandler,
            "open-resource": openResourceHandler,
          }
        : {}),
      ...(requestApprovalHandler
        ? {
            requestApproval: requestApprovalHandler,
            "request-approval": requestApprovalHandler,
          }
        : {}),
    };
  }, [
    commands,
    onNavigate,
    onOpenResource,
    onRefresh,
    onRemount,
    onRequestApproval,
  ]);
}

export function useAgentNativeEmbeddedBrowserSession({
  enabled = true,
  actions,
  getContext,
  screen = true,
  commands,
  webmcp,
  session,
  browserSession,
  onNavigate,
  onOpenResource,
  onRefresh,
  onRemount,
  onRequestApproval,
}: UseAgentNativeEmbeddedBrowserSessionOptions) {
  const mergedCommands = useMergedEmbeddedCommands({
    commands,
    onNavigate,
    onOpenResource,
    onRefresh,
    onRemount,
    onRequestApproval,
  });

  const getMergedContext = useCallback(async () => {
    const screenContext =
      screen === false
        ? {}
        : readAgentNativeScreenContext(screen === true ? {} : screen);
    const customContext = getContext ? await getContext() : undefined;
    return mergeHostContext(screenContext, customContext);
  }, [getContext, screen]);

  useEffect(() => {
    if (!enabled) return;

    const bridge = createAgentNativeBrowserSessionBridge({
      endpoint: browserSession?.endpoint,
      sessionId: browserSession?.sessionId,
      label: browserSession?.label,
      heartbeatMs: browserSession?.heartbeatMs,
      pollMs: browserSession?.pollMs,
      ttlMs: browserSession?.ttlMs,
      fetch: browserSession?.fetch,
      session,
      getContext: getMergedContext,
      actions,
      webmcp,
      commands: mergedCommands,
    }).start();

    browserSession?.onReady?.(bridge);
    return () => bridge.stop();
  }, [
    actions,
    browserSession?.endpoint,
    browserSession?.fetch,
    browserSession?.heartbeatMs,
    browserSession?.label,
    browserSession?.onReady,
    browserSession?.pollMs,
    browserSession?.sessionId,
    browserSession?.ttlMs,
    enabled,
    getMergedContext,
    mergedCommands,
    session,
    webmcp,
  ]);
}
