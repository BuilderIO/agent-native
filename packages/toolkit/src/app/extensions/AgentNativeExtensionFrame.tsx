import { SESSION_REPLAY_IFRAME_ATTRIBUTE } from "@agent-native/core/client/host";
import {
  createAgentNativeHostBridge,
  type AgentNativeClientAction,
  type AgentNativeClientActions,
  type AgentNativeHostAuth,
  type AgentNativeHostBridge,
  type AgentNativeHostBridgeEvent,
  type AgentNativeHostCommandHandler,
  type AgentNativeHostCommandHandlers,
  type AgentNativeHostContext,
  type AgentNativeHostContextGetter,
  type AgentNativeHostSession,
} from "@agent-native/core/client/host";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type IframeHTMLAttributes,
} from "react";

import { useExternalExtensionLinks } from "./extension-links.js";
import {
  AGENT_NATIVE_EXTENSION_MESSAGE_TYPES,
  buildAgentNativeExtensionHtml,
  createLocalStorageAgentNativeExtensionStorage,
  getAgentNativeExtensionManifest,
  isAgentNativeExtensionAllowedInSlot,
  normalizeAgentNativeExtensionSandbox,
  type AgentNativeExtensionDefinition,
  type AgentNativeExtensionStorage,
  type AgentNativeExtensionStorageContext,
  type AgentNativeExtensionStorageOptions,
  type AgentNativeExtensionStorageScope,
} from "./portable-extension.js";

export type AgentNativeExtensionPermissionList =
  | readonly string[]
  | ((
      extension: AgentNativeExtensionDefinition,
    ) => readonly string[] | undefined)
  | undefined;

export type AgentNativeExtensionStorageScopeList =
  | readonly AgentNativeExtensionStorageScope[]
  | ((
      extension: AgentNativeExtensionDefinition,
    ) => readonly AgentNativeExtensionStorageScope[] | undefined)
  | undefined;

export interface AgentNativeExtensionFrameProps extends Omit<
  IframeHTMLAttributes<HTMLIFrameElement>,
  "src" | "srcDoc"
> {
  extension: AgentNativeExtensionDefinition;
  slotId?: string;
  context?: Record<string, unknown> | null;
  actions?: AgentNativeClientActions;
  getContext?: AgentNativeHostContextGetter;
  commands?: AgentNativeHostCommandHandlers;
  allowedActions?: AgentNativeExtensionPermissionList;
  allowedCommands?: AgentNativeExtensionPermissionList;
  auth?: AgentNativeHostAuth;
  session?: string | Partial<AgentNativeHostSession>;
  storage?: AgentNativeExtensionStorage | false;
  allowedStorageScopes?: AgentNativeExtensionStorageScopeList;
  storageNamespace?: string;
  storageContext?: Omit<
    AgentNativeExtensionStorageContext,
    "extensionId" | "slotId"
  >;
  themeCss?: string;
  isDark?: boolean;
  autoHeight?: boolean;
  initialHeight?: number;
  onBridgeEvent?: (event: AgentNativeHostBridgeEvent) => void;
  onBridgeReady?: (bridge: AgentNativeHostBridge) => void;
  onStorageError?: (
    error: Error,
    request: AgentNativeExtensionStorageRequest,
  ) => void;
}

export interface AgentNativeExtensionSlotProps extends Omit<
  AgentNativeExtensionFrameProps,
  "extension" | "className" | "style" | "children"
> {
  id: string;
  extensions: AgentNativeExtensionDefinition[];
  className?: string;
  extensionClassName?: string;
  extensionStyle?: CSSProperties;
  empty?: React.ReactNode;
  showEmptyAffordance?: boolean;
}

interface AgentNativeExtensionStorageRequest {
  requestId: string;
  op: "list" | "get" | "set" | "remove";
  collection: string;
  id?: string;
  data?: unknown;
  options?: AgentNativeExtensionStorageOptions;
}

const defaultFrameStyle: CSSProperties = {
  border: 0,
  display: "block",
  width: "100%",
};

const BUILT_IN_COMMAND_NAMES = [
  "navigate",
  "refreshData",
  "refresh-data",
  "remountView",
  "remount-view",
  "hardReload",
  "hard-reload",
  "openResource",
  "open-resource",
  "requestApproval",
  "request-approval",
];

const COMMAND_ALIASES: Record<string, readonly string[]> = {
  refreshData: ["refreshData", "refresh-data"],
  "refresh-data": ["refreshData", "refresh-data"],
  remountView: ["remountView", "remount-view"],
  "remount-view": ["remountView", "remount-view"],
  hardReload: ["hardReload", "hard-reload"],
  "hard-reload": ["hardReload", "hard-reload"],
  openResource: ["openResource", "open-resource"],
  "open-resource": ["openResource", "open-resource"],
  requestApproval: ["requestApproval", "request-approval"],
  "request-approval": ["requestApproval", "request-approval"],
};

function setForwardedRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function resolvePermissionList(
  value: AgentNativeExtensionPermissionList,
  extension: AgentNativeExtensionDefinition,
  fallback: readonly string[] | undefined,
): readonly string[] | undefined {
  if (typeof value === "function") return value(extension);
  if (Array.isArray(value)) return value;
  return fallback;
}

function resolveStorageScopeList(
  value: AgentNativeExtensionStorageScopeList,
  extension: AgentNativeExtensionDefinition,
  fallback: readonly AgentNativeExtensionStorageScope[] | undefined,
): readonly AgentNativeExtensionStorageScope[] | undefined {
  if (typeof value === "function") return value(extension);
  if (Array.isArray(value)) return value;
  return fallback;
}

function toPermissionSet(
  value: readonly string[] | undefined,
): Set<string> | null {
  return value ? new Set(value) : null;
}

function commandPermissionSet(
  value: readonly string[] | undefined,
): Set<string> | null {
  if (!value) return null;
  const expanded = new Set<string>();
  for (const command of value) {
    expanded.add(command);
    for (const alias of COMMAND_ALIASES[command] ?? []) expanded.add(alias);
  }
  return expanded;
}

async function resolveActions(
  actions: AgentNativeClientActions | undefined,
): Promise<AgentNativeClientAction[]> {
  const resolved = typeof actions === "function" ? await actions() : actions;
  return Array.isArray(resolved) ? resolved : [];
}

function scopeExtensionActions(
  actions: AgentNativeClientActions | undefined,
  allowedNames: Set<string> | null,
): AgentNativeClientActions | undefined {
  if (!actions || !allowedNames) return actions;
  return async () =>
    (await resolveActions(actions)).filter((action) =>
      allowedNames.has(action.name),
    );
}

function blockedCommand(command: string): AgentNativeHostCommandHandler {
  return () => {
    throw new Error(
      `Extension is not allowed to call host command "${command}"`,
    );
  };
}

function scopeExtensionCommands(
  commands: AgentNativeHostCommandHandlers | undefined,
  allowedNames: Set<string> | null,
): AgentNativeHostCommandHandlers | undefined {
  if (!allowedNames) return commands;

  const scoped: AgentNativeHostCommandHandlers = {};
  for (const command of BUILT_IN_COMMAND_NAMES) {
    if (!allowedNames.has(command)) scoped[command] = blockedCommand(command);
  }

  for (const [command, handler] of Object.entries(commands ?? {})) {
    scoped[command] = allowedNames.has(command)
      ? handler
      : blockedCommand(command);
  }

  return scoped;
}

function normalizeStorageRequest(
  value: unknown,
): AgentNativeExtensionStorageRequest | null {
  if (!isRecord(value)) return null;
  const requestId = typeof value.requestId === "string" ? value.requestId : "";
  const op =
    value.op === "list" ||
    value.op === "get" ||
    value.op === "set" ||
    value.op === "remove"
      ? value.op
      : null;
  const collection =
    typeof value.collection === "string" ? value.collection.trim() : "";
  const id = typeof value.id === "string" ? value.id : undefined;
  const options = isRecord(value.options)
    ? (value.options as AgentNativeExtensionStorageOptions)
    : undefined;

  if (!requestId || !op || !collection) return null;
  if ((op === "get" || op === "set" || op === "remove") && !id) {
    return null;
  }

  return {
    requestId,
    op,
    collection,
    id,
    data: value.data,
    options,
  };
}

function mergeExtensionContext(
  base: AgentNativeHostContext | undefined,
  extension: AgentNativeExtensionDefinition,
  slotId: string | undefined,
  slotContext: Record<string, unknown> | null | undefined,
): AgentNativeHostContext {
  return {
    ...(base ?? {}),
    extension: {
      id: extension.id,
      name: extension.name,
      description: extension.description,
    },
    slot: slotId
      ? {
          id: slotId,
          context: slotContext ?? {},
        }
      : undefined,
    data: {
      ...(base?.data ?? {}),
      extension: {
        id: extension.id,
        name: extension.name,
      },
      slotContext: slotContext ?? {},
    },
  };
}

export const AgentNativeExtensionFrame = forwardRef<
  HTMLIFrameElement,
  AgentNativeExtensionFrameProps
>(function AgentNativeExtensionFrame(
  {
    extension,
    slotId,
    context,
    actions,
    getContext,
    commands,
    allowedActions,
    allowedCommands,
    auth,
    session,
    storage,
    allowedStorageScopes,
    storageNamespace = "default",
    storageContext,
    themeCss,
    isDark,
    autoHeight = true,
    initialHeight = 120,
    onBridgeEvent,
    onBridgeReady,
    onStorageError,
    title,
    sandbox,
    allow = "clipboard-read; clipboard-write",
    referrerPolicy = "no-referrer",
    style,
    onLoad,
    ...iframeProps
  },
  forwardedRef,
) {
  const extensionFrameKey = `${extension.id}:${extension.updatedAt ?? ""}`;
  const initialContextKey = `${extensionFrameKey}:${slotId ?? ""}`;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<AgentNativeHostBridge | null>(null);
  const framePortRef = useRef<MessagePort | null>(null);
  const initialContextRef = useRef({ key: initialContextKey, context });
  if (initialContextRef.current.key !== initialContextKey) {
    initialContextRef.current = { key: initialContextKey, context };
  } else {
    initialContextRef.current.context = context;
  }
  const storageMessageHandlerRef = useRef<
    ((message: unknown, port: MessagePort) => void) | null
  >(null);
  const pendingFrameMessagesRef = useRef<
    Array<{ message: unknown; port: MessagePort }>
  >([]);
  const [height, setHeight] = useState(initialHeight);
  const contextJson = safeStringify(context);
  const contextRef = useRef(context);
  contextRef.current = context;
  const onFramePortMessage = useCallback((event: MessageEvent) => {
    const port = event.currentTarget as MessagePort | null;
    if (!port) return;
    const handler = storageMessageHandlerRef.current;
    if (handler) handler(event.data, port);
    else pendingFrameMessagesRef.current.push({ message: event.data, port });
  }, []);
  const onLinkChannelReady = useCallback(() => {
    iframeRef.current?.setAttribute("data-link-channel-ready", "true");
  }, []);
  const onLinkPortReady = useCallback(
    (port: MessagePort) => {
      if (framePortRef.current !== port) {
        framePortRef.current?.removeEventListener(
          "message",
          onFramePortMessage,
        );
        framePortRef.current?.close();
        port.addEventListener("message", onFramePortMessage);
        port.start();
      }
      framePortRef.current = port;
      bridgeRef.current?.setTargetPort(port);
      bridgeRef.current?.post({
        type: AGENT_NATIVE_EXTENSION_MESSAGE_TYPES.SLOT_CONTEXT,
        extensionId: extension.id,
        slotId,
        context: contextRef.current ?? {},
      });
    },
    [extension.id, onFramePortMessage, slotId],
  );
  const extensionDocumentIdentity = useMemo(
    () => ({
      extensionFrameKey,
      content: extension.content,
      name: extension.name,
      title,
      slotId,
      themeCss,
      isDark,
    }),
    [
      extension.content,
      extension.name,
      extensionFrameKey,
      isDark,
      slotId,
      themeCss,
      title,
    ],
  );
  const linkNonce = useExternalExtensionLinks(
    iframeRef,
    extensionDocumentIdentity,
    {
      onReady: onLinkChannelReady,
      onHostPortReady: onLinkPortReady,
    },
  );
  const localStorageAdapter = useMemo(
    () => createLocalStorageAgentNativeExtensionStorage(storageNamespace),
    [storageNamespace],
  );
  const storageAdapter = storage === undefined ? localStorageAdapter : storage;
  const sandboxValue = useMemo(
    () => normalizeAgentNativeExtensionSandbox(sandbox, { mode: "nonce" }),
    [sandbox],
  );
  const sessionValue =
    session ?? `extension:${extension.id}:${slotId ?? "standalone"}`;
  const manifest = useMemo(
    () => getAgentNativeExtensionManifest(extension),
    [extension],
  );
  const actionAllowlist = useMemo(
    () =>
      toPermissionSet(
        resolvePermissionList(
          allowedActions,
          extension,
          manifest.requestedActions,
        ),
      ),
    [allowedActions, extension, manifest.requestedActions],
  );
  const commandAllowlist = useMemo(
    () =>
      commandPermissionSet(
        resolvePermissionList(
          allowedCommands,
          extension,
          manifest.requestedCommands,
        ),
      ),
    [allowedCommands, extension, manifest.requestedCommands],
  );
  const storageScopeAllowlist = useMemo(() => {
    const scopes = resolveStorageScopeList(
      allowedStorageScopes,
      extension,
      manifest.storageScopes,
    );
    return scopes ? new Set(scopes) : null;
  }, [allowedStorageScopes, extension, manifest.storageScopes]);
  const scopedActions = useMemo(
    () => scopeExtensionActions(actions, actionAllowlist),
    [actions, actionAllowlist],
  );
  const scopedCommands = useMemo(
    () => scopeExtensionCommands(commands, commandAllowlist),
    [commands, commandAllowlist],
  );

  const getMergedContext = useCallback(async () => {
    const base = getContext ? await getContext() : {};
    return mergeExtensionContext(base, extension, slotId, context);
  }, [contextJson, extension, getContext, slotId]);

  const srcDoc = useMemo(() => {
    if (!linkNonce) return "";
    return buildAgentNativeExtensionHtml({
      extensionId: extension.id,
      title: title ?? extension.name,
      content: extension.content,
      linkNonce,
      slotId,
      slotContext: initialContextRef.current.context,
      themeCss,
      isDark,
    });
  }, [
    extension.content,
    extension.id,
    linkNonce,
    extension.name,
    isDark,
    slotId,
    themeCss,
    title,
  ]);

  const postSlotContext = useCallback(() => {
    bridgeRef.current?.post({
      type: AGENT_NATIVE_EXTENSION_MESSAGE_TYPES.SLOT_CONTEXT,
      extensionId: extension.id,
      slotId,
      context: context ?? {},
    });
  }, [contextJson, extension.id, slotId]);

  useEffect(() => {
    const bridge = createAgentNativeHostBridge({
      allowWindowMessages: false,
      targetPort: framePortRef.current,
      session: sessionValue,
      getContext: getMergedContext,
      commands: scopedCommands,
      actions: scopedActions,
      auth,
      onEvent: onBridgeEvent,
      targetWindow: iframeRef.current?.contentWindow ?? null,
    }).start();
    bridgeRef.current = bridge;
    onBridgeReady?.(bridge);
    return () => {
      bridge.stop();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
    };
  }, [
    actions,
    auth,
    getMergedContext,
    onBridgeEvent,
    onBridgeReady,
    sessionValue,
    scopedActions,
    scopedCommands,
  ]);

  useEffect(() => {
    postSlotContext();
    void bridgeRef.current?.refreshContext();
  }, [postSlotContext]);

  useEffect(
    () => () => {
      framePortRef.current?.removeEventListener("message", onFramePortMessage);
      framePortRef.current?.close();
      framePortRef.current = null;
    },
    [onFramePortMessage],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const respond = (
      port: MessagePort,
      requestId: string,
      payload: Record<string, unknown>,
    ): boolean => {
      if (framePortRef.current !== port) return false;
      try {
        port.postMessage({
          type: AGENT_NATIVE_EXTENSION_MESSAGE_TYPES.STORAGE_RESPONSE,
          requestId,
          ...payload,
        });
        return true;
      } catch {
        // coercion-ok: false reports that the requesting document's port cannot receive a response.
        return false;
      }
    };

    const handleStorageRequest = async (
      request: AgentNativeExtensionStorageRequest,
      port: MessagePort,
    ) => {
      try {
        if (!storageAdapter) {
          throw new Error("No extension storage adapter is registered");
        }
        const requestContext: AgentNativeExtensionStorageContext = {
          ...(storageContext ?? {}),
          extensionId: extension.id,
          slotId,
        };
        const { op, collection, id, data, options } = request;
        const requestedScope =
          typeof options?.scope === "string"
            ? options.scope
            : (requestContext.scope ?? "user");
        if (
          storageScopeAllowlist &&
          !storageScopeAllowlist.has(requestedScope)
        ) {
          throw new Error(
            `Extension is not allowed to use storage scope "${requestedScope}"`,
          );
        }
        const result =
          op === "list"
            ? await storageAdapter.list(collection, options, requestContext)
            : op === "get"
              ? await storageAdapter.get(
                  collection,
                  id as string,
                  options,
                  requestContext,
                )
              : op === "set"
                ? await storageAdapter.set(
                    collection,
                    id as string,
                    data,
                    options,
                    requestContext,
                  )
                : await storageAdapter.remove(
                    collection,
                    id as string,
                    options,
                    requestContext,
                  );
        respond(port, request.requestId, { ok: true, result });
      } catch (error) {
        const err = safeError(error);
        onStorageError?.(err, request);
        respond(port, request.requestId, { ok: false, error: err.message });
      }
    };

    function onMessage(message: unknown, port: MessagePort) {
      if (framePortRef.current !== port) return;
      if (!isRecord(message)) return;

      if (message.type === AGENT_NATIVE_EXTENSION_MESSAGE_TYPES.RESIZE) {
        if (!autoHeight) return;
        const nextHeight = Number(message.height);
        if (Number.isFinite(nextHeight) && nextHeight > 0) {
          setHeight(Math.ceil(nextHeight));
        }
        return;
      }

      if (
        message.type !== AGENT_NATIVE_EXTENSION_MESSAGE_TYPES.STORAGE_REQUEST
      ) {
        return;
      }

      const request = normalizeStorageRequest(message);
      if (!request) {
        const requestId =
          typeof message.requestId === "string" ? message.requestId : "";
        if (requestId) {
          respond(port, requestId, {
            ok: false,
            error: "Invalid extension storage request",
          });
        }
        return;
      }

      void handleStorageRequest(request, port);
    }

    storageMessageHandlerRef.current = onMessage;
    pendingFrameMessagesRef.current
      .splice(0)
      .forEach(({ message, port }) => onMessage(message, port));
    return () => {
      if (storageMessageHandlerRef.current === onMessage) {
        storageMessageHandlerRef.current = null;
      }
    };
  }, [
    autoHeight,
    extension.id,
    onStorageError,
    slotId,
    storageAdapter,
    storageContext,
    storageScopeAllowlist,
  ]);

  if (!linkNonce) return null;

  return (
    <iframe
      {...iframeProps}
      {...{ [SESSION_REPLAY_IFRAME_ATTRIBUTE]: "" }}
      key={`${extensionFrameKey}-${linkNonce}`}
      ref={(node) => {
        iframeRef.current = node;
        setForwardedRef(forwardedRef, node);
        bridgeRef.current?.setTargetWindow(node?.contentWindow ?? null);
      }}
      title={title ?? extension.name}
      srcDoc={srcDoc}
      sandbox={sandboxValue}
      allow={allow}
      referrerPolicy={referrerPolicy}
      style={{
        ...defaultFrameStyle,
        height: autoHeight ? height : "100%",
        ...style,
      }}
      onLoad={(event) => {
        bridgeRef.current?.setTargetWindow(
          event.currentTarget.contentWindow ?? null,
        );
        onLoad?.(event);
      }}
    />
  );
});

export function AgentNativeExtensionSlot({
  id,
  extensions,
  context,
  actions,
  getContext,
  commands,
  allowedActions,
  allowedCommands,
  auth,
  session,
  storage,
  allowedStorageScopes,
  storageNamespace,
  storageContext,
  themeCss,
  isDark,
  autoHeight,
  initialHeight,
  onBridgeEvent,
  onBridgeReady,
  onStorageError,
  className,
  extensionClassName,
  extensionStyle,
  empty = null,
  showEmptyAffordance = false,
  ...iframeProps
}: AgentNativeExtensionSlotProps) {
  const slotExtensions = extensions.filter((extension) =>
    isAgentNativeExtensionAllowedInSlot(extension, id),
  );

  if (slotExtensions.length === 0) {
    if (!showEmptyAffordance) return null;
    return <div className={className}>{empty}</div>;
  }

  return (
    <div className={className}>
      {slotExtensions.map((extension) => (
        <AgentNativeExtensionFrame
          {...iframeProps}
          key={extension.id}
          extension={extension}
          slotId={id}
          context={context}
          actions={actions}
          getContext={getContext}
          commands={commands}
          allowedActions={allowedActions}
          allowedCommands={allowedCommands}
          auth={auth}
          session={session}
          storage={storage}
          allowedStorageScopes={allowedStorageScopes}
          storageNamespace={storageNamespace}
          storageContext={storageContext}
          themeCss={themeCss}
          isDark={isDark}
          autoHeight={autoHeight}
          initialHeight={initialHeight}
          onBridgeEvent={onBridgeEvent}
          onBridgeReady={onBridgeReady}
          onStorageError={onStorageError}
          className={extensionClassName}
          style={extensionStyle}
        />
      ))}
    </div>
  );
}
