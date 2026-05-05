import { agentNativePath } from "../api-path.js";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  IconDots,
  IconLoader2,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { ShareButton } from "../sharing/ShareButton.js";
import { AgentToggleButton } from "../AgentPanel.js";
import { NotificationsBell } from "../notifications/NotificationsBell.js";
import { sendToAgentChat } from "../agent-chat.js";
import { PromptComposer } from "../composer/PromptComposer.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  isAllowedExtensionPath,
  sanitizeExtensionRequestOptions,
  checkBridgePolicy,
  type ExtensionBridgeRole,
} from "./iframe-bridge.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";

const THEME_CSS_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--radius",
  "--sidebar-background",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
];

function getParentThemeVars(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const name of THEME_CSS_VARS) {
    const val = computed.getPropertyValue(name).trim();
    if (val) vars[name] = val;
  }
  return vars;
}

interface Extension {
  id: string;
  name: string;
  description?: string;
  content?: string;
  updatedAt?: string;
}

export interface ExtensionViewerProps {
  extensionId: string;
}

function EditToolPopover({ extension }: { extension: Extension }) {
  const [open, setOpen] = useState(false);

  // Radix's outside-click detection runs in the parent document, so a click
  // inside the extension iframe (or any other iframe) never fires it. The browser
  // does shift focus to the iframe though, which blurs the parent window — we
  // hook that to close the popover so it behaves like a normal click-outside.
  useEffect(() => {
    if (!open) return;
    const handleBlur = () => {
      // Defer until after the focus actually lands so document.activeElement
      // reflects the iframe (or whatever the user clicked on).
      setTimeout(() => {
        if (document.activeElement?.tagName === "IFRAME") setOpen(false);
      }, 0);
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [open]);

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendToAgentChat({
      message: trimmed,
      context: `The user is viewing extension "${extension.name}" (id: ${extension.id}) and wants to edit it.`,
      submit: true,
      openSidebar: true,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
            >
              <IconPencil className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={6} className="w-[420px] p-3">
        <p className="px-1 pb-2 text-sm font-semibold text-foreground">
          Edit extension
        </p>
        <PromptComposer
          autoFocus
          placeholder="What would you like to change?"
          draftScope={`extensions:edit:${extension.id}`}
          onSubmit={handleSubmit}
        />
      </PopoverContent>
    </Popover>
  );
}

export function ExtensionViewer({ extensionId }: ExtensionViewerProps) {
  const [isDark, setIsDark] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const toolRef = useRef<Extension | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  // (audit H4) Role plumbed through from the iframe's render binding. Until
  // the iframe announces its role we deny non-trivial helper calls — that
  // way a malicious extension body that races the announcement can't briefly
  // operate at higher privilege than the viewer's actual role.
  const bridgeContextRef = useRef<{
    role: ExtensionBridgeRole;
    isAuthor: boolean;
  }>({
    role: "viewer",
    isAuthor: false,
  });

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

  const sendThemeToIframe = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: "agent-native-theme-update",
        isDark: document.documentElement.classList.contains("dark"),
        vars: getParentThemeVars(),
      },
      "*",
    );
  };

  useEffect(() => {
    if (!iframeReady) return;
    sendThemeToIframe();
  }, [isDark, iframeReady]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data;
      if (!message) return;

      if (message.type === "agent-native-extension-binding") {
        // (audit H4) The iframe announced its render binding. Trust the role
        // value because the iframe's binding is generated server-side in
        // extensions/routes.ts (resolveAccess), not by user-authored content.
        const binding = message.binding ?? {};
        const role: ExtensionBridgeRole =
          binding.role === "owner" ||
          binding.role === "admin" ||
          binding.role === "editor" ||
          binding.role === "viewer"
            ? binding.role
            : "viewer";
        bridgeContextRef.current = {
          role,
          isAuthor: !!binding.isAuthor,
        };
        return;
      }

      if (
        message.type === "agent-native-extension-consent-granted" ||
        message.type === "agent-native-extension-consent-cancelled"
      ) {
        // (audit C1) The consent stub fired; force a reload of the iframe so
        // the next render returns the extension body (granted) or stays on the
        // stub (cancelled — viewer can also navigate away).
        if (message.type === "agent-native-extension-consent-granted") {
          // Invalidate the cached extension record — author may have edited
          // since the cache was warmed.
          queryClient.invalidateQueries({
            queryKey: ["extension", extensionId],
          });
          setRefreshKey((k) => k + 1);
        }
        return;
      }

      if (message.type === "agent-native-extension-keydown") {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: message.key,
            code: message.code,
            metaKey: !!message.metaKey,
            ctrlKey: !!message.ctrlKey,
            shiftKey: !!message.shiftKey,
            altKey: !!message.altKey,
            bubbles: true,
            cancelable: true,
          }),
        );
        return;
      }

      if (message.type === "agent-native-extension-error-fix") {
        const t = toolRef.current;
        if (!t) return;
        const errors: string[] = message.errors || [];
        const errorDetails: Array<{ message: string; stack: string }> =
          message.errorDetails || [];
        const consoleLogs: Array<{ level: string; message: string }> =
          message.consoleLogs || [];
        const networkLogs: Array<{
          path: string;
          method: string;
          ok?: boolean;
          status?: number;
          error?: string;
        }> = message.networkLogs || [];

        const detailedTrace = errorDetails
          .map((e) => (e.stack ? `${e.message}\n${e.stack}` : e.message))
          .join("\n\n");

        const contextParts = [
          `The user is viewing extension "${t.name}" (id: ${t.id}) and there are runtime errors that need fixing.`,
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

        sendToAgentChat({
          message: `Fix runtime errors in this extension:\n${errors.join("\n")}`,
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
          {
            type: "agent-native-extension-response",
            requestId,
            ...payload,
          },
          "*",
        );
      };

      if (!requestId || !isAllowedExtensionPath(path, extensionId)) {
        respond({ error: "Extension request path is not allowed" });
        return;
      }

      try {
        const options = sanitizeExtensionRequestOptions(message.options);
        // (audit H4) Role-aware policy gate: viewer-shared extensions can read
        // but not write. Decided here in the parent before the request
        // leaves; the server enforces a second layer.
        const policy = checkBridgePolicy(
          path,
          options.method ?? "GET",
          bridgeContextRef.current,
        );
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
        // (audit H5) Tag every outbound bridge request with the
        // X-Agent-Native-Extension-Bridge sentinel so the action-routes layer can
        // enforce per-action `toolCallable` opt-in. The header is added by
        // the parent — it is NOT taken from the iframe-supplied options
        // (which were filtered by sanitizeExtensionRequestOptions).
        const finalHeaders = new Headers(options.headers ?? undefined);
        finalHeaders.set("X-Agent-Native-Extension-Bridge", "1");
        finalHeaders.set("X-Agent-Native-Extension-Id", extensionId);
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
  }, [extensionId, queryClient]);

  const { data: extension, isLoading } = useQuery<Extension>({
    queryKey: ["extension", extensionId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/extensions/${extensionId}`),
      );
      if (!res.ok) throw new Error("Failed to fetch extension");
      return res.json();
    },
  });

  toolRef.current = extension ?? null;

  const iframeSrc = useMemo(
    () =>
      agentNativePath(
        `/_agent-native/extensions/${extensionId}/render?dark=${document.documentElement.classList.contains("dark")}&v=${encodeURIComponent(extension?.updatedAt ?? "")}&r=${refreshKey}`,
      ),
    [extensionId, extension?.updatedAt, refreshKey],
  );

  useEffect(() => {
    setIframeReady(false);
    // Reset role to deny-by-default on every reload — the new render's
    // binding announcement re-establishes the role before any helper call.
    bridgeContextRef.current = { role: "viewer", isAuthor: false };
  }, [extensionId, extension?.updatedAt, refreshKey]);

  const startRename = useCallback(() => {
    if (!extension) return;
    setRenameValue(extension.name);
    setIsRenaming(true);
    requestAnimationFrame(() => renameInputRef.current?.select());
  }, [extension]);

  const submitRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !extension || trimmed === extension.name) {
      setIsRenaming(false);
      return;
    }
    queryClient.setQueryData<Extension>(["extension", extensionId], (old) =>
      old ? { ...old, name: trimmed } : old,
    );
    queryClient.setQueryData<Extension[]>(["extensions"], (old) =>
      (old ?? []).map((t) =>
        t.id === extensionId ? { ...t, name: trimmed } : t,
      ),
    );
    setIsRenaming(false);
    try {
      await fetch(agentNativePath(`/_agent-native/extensions/${extensionId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      queryClient.invalidateQueries({ queryKey: ["extension", extensionId] });
      queryClient.invalidateQueries({ queryKey: ["extensions"] });
    } catch {
      queryClient.invalidateQueries({ queryKey: ["extension", extensionId] });
      queryClient.invalidateQueries({ queryKey: ["extensions"] });
    }
  }, [renameValue, extension, extensionId, queryClient]);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-12 items-center gap-2 px-3 border-b shrink-0">
          <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
          <div className="h-3.5 w-24 rounded bg-muted animate-pulse" />
        </div>
        <div className="flex-1 bg-muted/20 animate-pulse" />
      </div>
    );
  }

  if (!extension) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Extension not found
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full w-full flex-col">
        <div className="flex h-12 items-center justify-between border-b px-3 shrink-0">
          <div className="group/name flex items-center gap-1">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={submitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename();
                  if (e.key === "Escape") setIsRenaming(false);
                }}
                className="text-sm font-medium bg-transparent border-b border-primary outline-none py-0 px-0"
              />
            ) : (
              <>
                <span className="text-sm font-medium">{extension.name}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={startRename}
                      className="cursor-pointer rounded p-0.5 text-muted-foreground/40 opacity-0 group-hover/name:opacity-100 hover:text-foreground"
                    >
                      <IconPencil className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Rename</TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setRefreshKey((k) => k + 1)}
                  className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
                >
                  <IconRefresh className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
            <EditToolPopover extension={extension} />
            <ShareButton
              resourceType="extension"
              resourceId={extensionId}
              resourceTitle={extension.name}
            />
            <ToolMoreMenu extensionId={extensionId} toolName={extension.name} />
            <NotificationsBell />
            <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
          </div>
        </div>
        <div className="relative flex-1 min-h-0">
          {!iframeReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
              <IconLoader2
                className="size-5 animate-spin text-muted-foreground"
                role="status"
                aria-label="Loading"
              />
            </div>
          )}
          <iframe
            ref={iframeRef}
            key={`${extension.updatedAt}-${refreshKey}`}
            src={iframeSrc}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-forms"
            title={extension.name}
            onLoad={() => {
              sendThemeToIframe();
              setTimeout(() => setIframeReady(true), 150);
            }}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

interface SlotDeclaration {
  id: string;
  extensionId: string;
  slotId: string;
}

function ToolMoreMenu({
  extensionId,
  toolName,
}: {
  extensionId: string;
  toolName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: slots = [] } = useQuery<SlotDeclaration[]>({
    queryKey: ["extension-slots", extensionId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/slots/extension/${extensionId}`),
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
  });

  const closeMenu = () => {
    setOpen(false);
    setConfirmingDelete(false);
  };

  const removeFromSlot = async (slotId: string) => {
    try {
      await fetch(
        agentNativePath(
          `/_agent-native/slots/${encodeURIComponent(slotId)}/install/${encodeURIComponent(extensionId)}`,
        ),
        { method: "DELETE" },
      );
    } finally {
      queryClient.invalidateQueries({ queryKey: ["slot-installs", slotId] });
    }
  };

  const deleteExtension = async () => {
    closeMenu();
    try {
      await fetch(agentNativePath(`/_agent-native/extensions/${extensionId}`), {
        method: "DELETE",
      });
    } finally {
      queryClient.invalidateQueries({ queryKey: ["extension", extensionId] });
      queryClient.invalidateQueries({ queryKey: ["extensions"] });
      slots.forEach((s) =>
        queryClient.invalidateQueries({
          queryKey: ["slot-installs", s.slotId],
        }),
      );
      navigate("/extensions");
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
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
              aria-label="More options"
            >
              <IconDots className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>More options</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={4} className="w-72 p-0">
        {!confirmingDelete ? (
          <>
            <div className="px-3 py-2 border-b border-border/40">
              <p className="text-[12px] font-medium">Appears in</p>
              {slots.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                  Not installed in any widget areas. Ask the agent to add it
                  somewhere.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                  This extension can render in {slots.length} widget area
                  {slots.length === 1 ? "" : "s"}.
                </p>
              )}
            </div>
            {slots.length > 0 && (
              <div className="max-h-48 overflow-y-auto py-1">
                {slots.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
                  >
                    <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
                      {s.slotId}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => removeFromSlot(s.slotId)}
                          className="rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground cursor-pointer"
                          aria-label="Remove from this widget area"
                        >
                          <IconX className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        Remove from this widget area (for me)
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-border/40 p-1">
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] text-destructive hover:bg-destructive/10 cursor-pointer text-left"
              >
                <IconTrash className="h-3.5 w-3.5" />
                <span>Delete extension…</span>
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            <p className="text-[12px]">
              Delete <span className="font-medium">{toolName}</span>? This
              removes the extension everywhere, for everyone it's shared with.
            </p>
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md px-2 py-1 text-[12px] hover:bg-accent cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteExtension}
                className="rounded-md bg-destructive px-2 py-1 text-[12px] text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
