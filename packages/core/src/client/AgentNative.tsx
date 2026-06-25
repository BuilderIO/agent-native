import { useCallback, useMemo } from "react";

import {
  AgentNativeFrame,
  type AgentNativeFrameProps,
} from "./AgentNativeFrame.js";
import {
  readAgentNativeScreenContext,
  type AgentNativeClientActions,
  type AgentNativeHostCommandHandler,
  type AgentNativeHostCommandHandlers,
  type AgentNativeHostCommandRequest,
  type AgentNativeHostContext,
  type AgentNativeHostContextGetter,
  type AgentNativeScreenSnapshotOptions,
} from "./host-bridge.js";

export interface AgentNativeCommandCallbackInfo {
  command: string;
  requestId?: string;
  origin: string;
}

export type AgentNativeCommandCallback = (
  payload: unknown,
  info: AgentNativeCommandCallbackInfo,
) => unknown | Promise<unknown>;

export interface AgentNativeProps extends Omit<
  AgentNativeFrameProps,
  "actions" | "commands" | "getContext"
> {
  /**
   * Live browser-session tools. These can change as page state changes and are
   * only callable while this tab is connected.
   */
  actions?: AgentNativeClientActions;
  /** Semantic app/page context layered over the built-in screen snapshot. */
  getContext?: AgentNativeHostContextGetter;
  /**
   * Built-in screen context. Defaults to visible text + route + selection.
   * Pass false to disable, or { includeDomHtml: true } for a DOM fallback.
   */
  screen?: boolean | AgentNativeScreenSnapshotOptions;
  /** Extra/advanced host commands. */
  commands?: AgentNativeHostCommandHandlers;
  onRefresh?: AgentNativeCommandCallback;
  onNavigate?: AgentNativeCommandCallback;
  onRemount?: AgentNativeCommandCallback;
  onOpenResource?: AgentNativeCommandCallback;
  onRequestApproval?: AgentNativeCommandCallback;
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
  callback: AgentNativeCommandCallback | undefined,
): AgentNativeHostCommandHandler | undefined {
  if (!callback) return undefined;
  return (request: AgentNativeHostCommandRequest) =>
    callback(request.payload, {
      command: request.command,
      requestId: request.requestId,
      origin: request.origin,
    });
}

export function useAgentNativeScreenContext(
  options?: AgentNativeScreenSnapshotOptions,
): AgentNativeHostContextGetter {
  return useCallback(() => readAgentNativeScreenContext(options), [options]);
}

export function AgentNative({
  actions,
  getContext,
  screen = true,
  commands,
  onRefresh,
  onNavigate,
  onRemount,
  onOpenResource,
  onRequestApproval,
  ...frameProps
}: AgentNativeProps) {
  const getMergedContext = useCallback(async () => {
    const screenContext =
      screen === false
        ? {}
        : readAgentNativeScreenContext(screen === true ? {} : screen);
    const customContext = getContext ? await getContext() : undefined;
    return mergeHostContext(screenContext, customContext);
  }, [getContext, screen]);

  const mergedCommands = useMemo(() => {
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

  return (
    <AgentNativeFrame
      {...frameProps}
      actions={actions}
      commands={mergedCommands}
      getContext={getMergedContext}
    />
  );
}
