import { agentNativePath } from "../api-path.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  IconDots,
  IconExternalLink,
  IconLayoutSidebarRightCollapse,
  IconTrash,
} from "@tabler/icons-react";
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
  TooltipTrigger,
} from "../components/ui/tooltip.js";

interface Extension {
  id: string;
  name: string;
  description?: string;
  content?: string;
  updatedAt?: string;
}

export interface EmbeddedExtensionProps {
  extensionId: string;
  /** Slot identifier passed via the iframe URL so the extension runtime knows it's
   * embedded and enables auto-resize. */
  slotId: string;
  /** Object pushed into the extension as `window.slotContext`. Re-posted whenever
   * the host re-renders with a new context. */
  context?: Record<string, unknown> | null;
  /** Optional className applied to the iframe container. */
  className?: string;
  /** Initial iframe height before content reports a real height. */
  initialHeight?: number;
}

/**
 * Renders a extension inline as a small auto-sized iframe — for use inside an
 * `<ExtensionSlot>`. Different from `<ExtensionViewer>` (which is full-page with a
 * toolbar): no header, sized to content, receives a `slotContext`.
 */
export function EmbeddedExtension({
  extensionId,
  slotId,
  context,
  className,
  initialHeight = 80,
}: EmbeddedExtensionProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(initialHeight);
  const [isDark, setIsDark] = useState(false);
  // (audit H4) Mirror ExtensionViewer's role-aware gating; deny-by-default until
  // the iframe's render binding announcement arrives.
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

  const { data: extension } = useQuery<Extension>({
    queryKey: ["extension", extensionId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/extensions/${extensionId}`),
      );
      if (!res.ok) throw new Error("Failed to fetch extension");
      return res.json();
    },
  });

  const iframeSrc = useMemo(() => {
    const v = encodeURIComponent(extension?.updatedAt ?? "");
    return agentNativePath(
      `/_agent-native/extensions/${extensionId}/render?slot=${encodeURIComponent(slotId)}&dark=${isDark}&v=${v}`,
    );
  }, [extensionId, slotId, isDark, extension?.updatedAt]);

  // Forward slot context whenever it changes. The iframe's own load handler
  // posts the initial value once it's ready; this effect handles updates.
  const contextJson = JSON.stringify(context ?? {});
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      { type: "agent-native-slot-context", context: context ?? {} },
      "*",
    );
  }, [contextJson]);

  // Bridge extension requests + height reports.
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (message.type === "agent-native-extension-binding") {
        const binding = (message as any).binding ?? {};
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

      if (message.type === "agent-native-extension-resize") {
        const h = Number(message.height);
        if (Number.isFinite(h) && h > 0) {
          setHeight(Math.ceil(h));
        }
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
        // (audit H4) Role-aware gating: viewer-shared extensions can read but not
        // write. The bridge policy is decided here in the parent before the
        // request leaves; the server enforces a second layer.
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
        // (audit H5) Same extension-bridge tagging as <ExtensionViewer>. action-routes
        // uses these headers to enforce per-action `toolCallable` opt-in.
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
  }, [extensionId]);

  if (!extension) {
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
        ref={iframeRef}
        key={`${extensionId}-${extension.updatedAt ?? ""}`}
        src={iframeSrc}
        title={extension.name}
        sandbox="allow-scripts allow-forms"
        style={{ width: "100%", border: 0, height, display: "block" }}
        onLoad={() => {
          iframeRef.current?.contentWindow?.postMessage(
            { type: "agent-native-slot-context", context: context ?? {} },
            "*",
          );
        }}
      />
      <EmbeddedToolMenu
        extensionId={extensionId}
        slotId={slotId}
        toolName={extension.name}
      />
    </div>
  );
}

function EmbeddedToolMenu({
  extensionId,
  slotId,
  toolName,
}: {
  extensionId: string;
  slotId: string;
  toolName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
      queryClient.invalidateQueries({ queryKey: ["slot-installs", slotId] });
    }
  };

  const deleteExtension = async () => {
    closeMenu();
    queryClient.setQueryData<any[]>(["slot-installs", slotId], (old) =>
      (old ?? []).filter((i) => i.extensionId !== extensionId),
    );
    try {
      await fetch(agentNativePath(`/_agent-native/extensions/${extensionId}`), {
        method: "DELETE",
      });
    } finally {
      queryClient.invalidateQueries({ queryKey: ["slot-installs", slotId] });
      queryClient.invalidateQueries({ queryKey: ["extension", extensionId] });
      queryClient.invalidateQueries({ queryKey: ["extensions"] });
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
              className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-md bg-background/60 text-muted-foreground/60 opacity-0 hover:bg-accent hover:text-foreground hover:opacity-100 group-hover/embedded-extension:opacity-100 cursor-pointer transition-opacity"
              aria-label={`${toolName} options`}
            >
              <IconDots className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{`${toolName} options`}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={4} className="w-56 p-1">
        {!confirmingDelete ? (
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => {
                closeMenu();
                navigate(`/extensions/${extensionId}`);
              }}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent cursor-pointer text-left"
            >
              <IconExternalLink className="h-3.5 w-3.5" />
              <span>Open full view</span>
            </button>
            <button
              type="button"
              onClick={removeFromSlot}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent cursor-pointer text-left"
            >
              <IconLayoutSidebarRightCollapse className="h-3.5 w-3.5" />
              <span>Remove from this widget area</span>
            </button>
            <div className="my-1 h-px bg-border/40" />
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] text-destructive hover:bg-destructive/10 cursor-pointer text-left"
            >
              <IconTrash className="h-3.5 w-3.5" />
              <span>Delete extension…</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-2">
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
