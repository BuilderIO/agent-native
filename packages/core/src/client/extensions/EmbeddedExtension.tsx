import {
  IconDots,
  IconExternalLink,
  IconLayoutSidebarRightCollapse,
  IconTrash,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { extensionPath } from "../../extensions/path.js";
import { THEME_VAR_NAMES } from "../../extensions/theme.js";
import { SESSION_REPLAY_IFRAME_ATTRIBUTE } from "../../session-replay-iframe-protocol.js";
import { sendToAgentChat } from "../agent-chat.js";
import { agentNativePath } from "../api-path.js";
import { useAppearance } from "../appearance.js";
import { getBrowserTabId } from "../browser-tab-id.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import {
  deleteOrHideExtension,
  invalidateExtensionRemoval,
} from "./delete-extension.js";
import {
  extensionLoadError,
  extensionLoadErrorStatus,
  shouldRetryExtensionLoad,
} from "./extension-load-error.js";
import {
  isAllowedExtensionPath,
  sanitizeExtensionRequestOptions,
  checkBridgePolicy,
  type BridgePolicyContext,
  type ExtensionBridgeRole,
} from "./iframe-bridge.js";
import { normalizeAgentNativeExtensionSandbox } from "./portable-extension.js";

interface Extension {
  id: string;
  name: string;
  description?: string;
  content?: string;
  updatedAt?: string;
  canDelete?: boolean;
  source?: {
    mode?: "database" | "local-files";
    permissions?: BridgePolicyContext["permissions"];
  };
}

const EXTENSION_IFRAME_SANDBOX =
  normalizeAgentNativeExtensionSandbox(undefined);

function readHostThemeVars(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const computed = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const name of THEME_VAR_NAMES) {
    const value = computed.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return vars;
}

function serializeChatValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function sanitizeSlotContextForPostMessage(
  context: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(context ?? {}));
  } catch {
    return {};
  }
}

export interface EmbeddedExtensionProps {
  extensionId: string;
  slotId: string;
  context?: Record<string, unknown> | null;
  className?: string;
  initialHeight?: number;
  onReady?: () => void;
  onUnavailable?: (status?: number) => void;
}

export function EmbeddedExtension({
  extensionId,
  slotId,
  context,
  className,
  initialHeight = 80,
  onReady,
  onUnavailable,
}: EmbeddedExtensionProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readyFiredRef = useRef(false);
  const fireReady = () => {
    if (readyFiredRef.current) return;
    readyFiredRef.current = true;
    onReadyRef.current?.();
  };
  const [height, setHeight] = useState<number>(initialHeight);
  const [isDark, setIsDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );
  const bridgeContextRef = useRef<BridgePolicyContext>({
    role: "viewer",
    isAuthor: false,
  });
  const bindingLatchedRef = useRef(false);
  const extensionRef = useRef(null as null | Extension);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const {
    data: extension,
    isFetching,
    isLoading,
    isError,
    error,
  } = useQuery<Extension>({
    queryKey: ["extension", extensionId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/extensions/${extensionId}`),
      );
      if (res.status === 404) {
        throw extensionLoadError(404, "Extension not found");
      }
      if (res.status === 403) {
        throw extensionLoadError(403, "Extension access denied");
      }
      if (!res.ok) {
        throw extensionLoadError(res.status, "Failed to fetch extension");
      }
      return res.json();
    },
    retry: shouldRetryExtensionLoad,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
  });
  extensionRef.current = extension ?? null;

  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const unavailableFiredRef = useRef(false);
  useEffect(() => {
    unavailableFiredRef.current = false;
  }, [extensionId]);
  useEffect(() => {
    if (isError && !isFetching && !unavailableFiredRef.current) {
      unavailableFiredRef.current = true;
      onUnavailableRef.current?.(extensionLoadErrorStatus(error));
    }
  }, [isError, isFetching, error]);

  const initialDarkRef = useRef(isDark);
  const iframeSrc = useMemo(() => {
    const v = encodeURIComponent(extension?.updatedAt ?? "");
    return agentNativePath(
      `/_agent-native/extensions/${extensionId}/render?slot=${encodeURIComponent(slotId)}&dark=${initialDarkRef.current}&v=${v}`,
    );
  }, [extensionId, slotId, extension?.updatedAt]);

  useEffect(() => {
    bridgeContextRef.current = { role: "viewer", isAuthor: false };
    bindingLatchedRef.current = false;
    readyFiredRef.current = false;
  }, [extensionId, extension?.updatedAt]);

  const appearance = useAppearance();

  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      { type: "agent-native-theme-update", isDark, vars: readHostThemeVars() },
      "*",
    );
  }, [isDark, appearance]);

  const contextJson = JSON.stringify(context ?? {});
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: "agent-native-slot-context",
        context: sanitizeSlotContextForPostMessage(context),
      },
      "*",
    );
  }, [contextJson]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (message.type === "agent-native-extension-binding") {
        if (bindingLatchedRef.current) return;
        bindingLatchedRef.current = true;
        const binding = (message as any).binding ?? {};
        const role: ExtensionBridgeRole =
          binding.role === "owner" ||
          binding.role === "admin" ||
          binding.role === "editor" ||
          binding.role === "commenter" ||
          binding.role === "viewer"
            ? binding.role
            : "viewer";
        bridgeContextRef.current = {
          role,
          isAuthor: !!binding.isAuthor,
          source: binding.source === "local-files" ? "local-files" : "database",
          permissions:
            binding && typeof binding.permissions === "object"
              ? binding.permissions
              : undefined,
        };
        return;
      }

      if (message.type === "agent-native-extension-resize") {
        const h = Number(message.height);
        if (Number.isFinite(h) && h > 0) {
          setHeight(Math.ceil(h));
          fireReady();
        }
        return;
      }

      if (message.type === "agent-native-send-to-chat") {
        const text = serializeChatValue((message as any).message);
        if (!text?.trim()) return;
        sendToAgentChat({
          message: text,
          context: serializeChatValue((message as any).context),
          submit: (message as any).submit === true,
          openSidebar: (message as any).openSidebar !== false,
        });
        return;
      }

      if (message.type === "agent-native-extension-error-fix") {
        const name = extensionRef.current?.name ?? extensionId;
        const errors: string[] = Array.isArray((message as any).errors)
          ? (message as any).errors
          : [];
        const errorDetails: Array<{ message: string; stack: string }> =
          Array.isArray((message as any).errorDetails)
            ? (message as any).errorDetails
            : [];
        const consoleLogs: Array<{ level: string; message: string }> =
          Array.isArray((message as any).consoleLogs)
            ? (message as any).consoleLogs
            : [];
        const networkLogs: Array<{
          path: string;
          method: string;
          ok?: boolean;
          status?: number;
          error?: string;
        }> = Array.isArray((message as any).networkLogs)
          ? (message as any).networkLogs
          : [];

        const detailedTrace = errorDetails
          .filter((e) => e && typeof e === "object")
          .map((e) => {
            const msg =
              typeof e.message === "string" ? e.message : String(e.message);
            return typeof e.stack === "string" ? `${msg}\n${e.stack}` : msg;
          })
          .join("\n\n");

        let freshContent: string | undefined;
        try {
          const res = await fetch(
            agentNativePath(`/_agent-native/extensions/${extensionId}`),
            { cache: "no-store" },
          );
          if (res.ok) {
            const fresh = (await res.json()) as Extension;
            freshContent =
              typeof fresh?.content === "string" ? fresh.content : undefined;
          }
        } catch {
          // Fall through with no snapshot — agent can still re-read via get-extension.
        }

        const contextParts = [
          `The user is viewing a dashboard panel embedding extension "${name}" (id: ${extensionId}, slot: ${slotId}) and there are runtime errors that need fixing.`,
          `\nFull error details:\n${detailedTrace}`,
        ];

        if (consoleLogs.length > 0) {
          const consoleStr = consoleLogs
            .map((l) => `[${l.level}] ${l.message}`)
            .join("\n");
          contextParts.push(`\nRecent console output:\n${consoleStr}`);
        }

        if (networkLogs.length > 0) {
          const netStr = networkLogs
            .map(
              (l) =>
                `${l.method} ${l.path} → ${l.ok ? l.status : "FAILED: " + (l.error || l.status)}`,
            )
            .join("\n");
          contextParts.push(`\nRecent network requests:\n${netStr}`);
        }

        if (freshContent) {
          contextParts.push(
            `\nCurrent extension content (just re-read from the database — this is the authoritative source, not anything you may have written in a previous turn):\n\`\`\`html\n${freshContent}\n\`\`\``,
          );
        }

        sendToAgentChat({
          message: `Fix runtime errors in extension "${name}" (id: ${extensionId}), embedded as a dashboard panel. The content snapshot below was just re-read from the database — treat it as authoritative and ignore any prior version you may have generated in this chat. If in doubt, call get-extension first.\n\nErrors:\n${errors.join("\n")}`,
          context: contextParts.join("\n"),
          submit: true,
          openSidebar: true,
        });
        return;
      }

      if (message.type !== "agent-native-extension-request") return;

      const requestId = String(message.requestId ?? "");
      const path = String(message.path ?? "");
      const respond = (payload: Record<string, unknown>) => {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "agent-native-extension-response", requestId, ...payload },
          "*",
        );
      };

      if (!requestId || !isAllowedExtensionPath(path, extensionId)) {
        respond({ error: "Extension request path is not allowed" });
        return;
      }

      try {
        const options = sanitizeExtensionRequestOptions(message.options);
        const policy = checkBridgePolicy(path, options.method ?? "GET", {
          ...bridgeContextRef.current,
          extensionId,
        });
        if (!policy.ok) {
          respond({
            response: {
              ok: false,
              status: 403,
              statusText: "Forbidden",
              body: { error: policy.error },
            },
          });
          return;
        }
        const finalHeaders = new Headers(options.headers ?? undefined);
        finalHeaders.set("X-Agent-Native-Extension-Bridge", "1");
        finalHeaders.set("X-Agent-Native-Extension-Id", extensionId);
        finalHeaders.set("X-Agent-Native-Tool-Bridge", "1");
        finalHeaders.set("X-Agent-Native-Tool-Id", extensionId);
        finalHeaders.set("X-Agent-Native-Browser-Tab", getBrowserTabId());
        const res = await fetch(agentNativePath(path), {
          ...options,
          headers: finalHeaders,
          credentials: "same-origin",
        });
        const text = await res.text();
        let body: unknown = text;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        respond({
          response: {
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            body,
          },
        });
      } catch (err: any) {
        respond({ error: err?.message ?? "Extension host request failed" });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [extensionId, slotId]);

  if (!extension) {
    if (!isLoading && !isFetching) return null;
    return (
      <div
        className={className}
        style={{ height: initialHeight }}
        aria-busy="true"
      />
    );
  }

  return (
    <div className={`relative group/embedded-extension ${className ?? ""}`}>
      <iframe
        {...{ [SESSION_REPLAY_IFRAME_ATTRIBUTE]: "" }}
        ref={iframeRef}
        key={`${extensionId}-${extension.updatedAt ?? ""}`}
        src={iframeSrc}
        title={extension.name}
        sandbox={EXTENSION_IFRAME_SANDBOX}
        style={{ width: "100%", border: 0, height, display: "block" }}
        onLoad={() => {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "agent-native-slot-context",
              context: sanitizeSlotContextForPostMessage(context),
            },
            "*",
          );
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "agent-native-theme-update",
              isDark,
              vars: readHostThemeVars(),
            },
            "*",
          );
          fireReady();
        }}
      />
      <EmbeddedToolMenu
        extensionId={extensionId}
        slotId={slotId}
        toolName={extension.name}
        canDelete={extension.canDelete}
      />
    </div>
  );
}

function EmbeddedToolMenu({
  extensionId,
  slotId,
  toolName,
  canDelete,
}: {
  extensionId: string;
  slotId: string;
  toolName: string;
  canDelete?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();

  const closeMenu = () => {
    setOpen(false);
    setConfirmingDelete(false);
  };

  const removeFromSlot = async () => {
    closeMenu();
    queryClient.setQueryData<any[]>(["slot-installs", slotId], (old) =>
      (old ?? []).filter((i) => i.extensionId !== extensionId),
    );
    try {
      await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(slotId)}/install/${encodeURIComponent(extensionId)}`,
        ),
        { method: "DELETE" },
      );
    } finally {
      void queryClient.invalidateQueries({
        queryKey: ["slot-installs", slotId],
      });
    }
  };

  const deleteExtension = async () => {
    closeMenu();
    try {
      await deleteOrHideExtension({ id: extensionId, canDelete });
      invalidateExtensionRemoval(queryClient, extensionId);
    } catch {
      void queryClient.invalidateQueries({
        queryKey: ["extension", extensionId],
      });
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setConfirmingDelete(false);
      }}
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-md bg-background/60 text-muted-foreground/60 opacity-0 hover:bg-accent hover:text-foreground hover:opacity-100 group-hover/embedded-extension:opacity-100 cursor-pointer transition-opacity"
                aria-label={t("extensions.optionsFor", { name: toolName })}
              >
                <IconDots className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {t("extensions.optionsFor", { name: toolName })}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" sideOffset={4} className="w-56 p-1">
        {!confirmingDelete ? (
          <div className="flex flex-col">
            <Link
              to={extensionPath(extensionId, toolName)}
              onClick={closeMenu}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent cursor-pointer text-left"
            >
              <IconExternalLink className="h-3.5 w-3.5" />
              <span>{t("extensions.openFullView")}</span>
            </Link>
            <button
              type="button"
              onClick={removeFromSlot}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent cursor-pointer text-left"
            >
              <IconLayoutSidebarRightCollapse className="h-3.5 w-3.5" />
              <span>{t("extensions.removeFromWidgetArea")}</span>
            </button>
            {canDelete !== false && (
              <>
                <div className="my-1 h-px bg-border/40" />
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] text-destructive hover:bg-destructive/10 cursor-pointer text-left"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                  <span>{t("extensions.deleteExtensionEllipsis")}</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-2">
            <p className="text-[12px]">
              {t("extensions.deleteQuestion", { name: toolName })}{" "}
              {t("extensions.deleteEverywhereConfirmation")}
            </p>
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md px-2 py-1 text-[12px] hover:bg-accent cursor-pointer"
              >
                {t("extensions.cancel")}
              </button>
              <button
                type="button"
                onClick={deleteExtension}
                className="rounded-md bg-destructive px-2 py-1 text-[12px] text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
              >
                {t("extensions.delete")}
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
