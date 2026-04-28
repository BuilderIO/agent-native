import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPencil, IconRefresh } from "@tabler/icons-react";
import { ShareButton } from "../sharing/ShareButton.js";
import { sendToAgentChat } from "../agent-chat.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";

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

interface Tool {
  id: string;
  name: string;
  description?: string;
  content?: string;
  updatedAt?: string;
}

export interface ToolViewerProps {
  toolId: string;
}

function EditToolPopover({ tool }: { tool: Tool }) {
  const [open, setOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");

  const handleSubmit = () => {
    if (!editPrompt.trim()) return;
    sendToAgentChat({
      message: editPrompt.trim(),
      context: `The user is viewing tool "${tool.name}" (id: ${tool.id}) and wants to edit it.`,
      submit: true,
      openSidebar: true,
    });
    setEditPrompt("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
          title="Edit"
        >
          <IconPencil className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            placeholder="What would you like to change?"
            className="flex w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 min-h-[100px] resize-y"
            autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (editPrompt.trim()) handleSubmit();
              }
            }}
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-[11px] text-muted-foreground">
              {/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}
              +Enter
            </span>
            <button
              type="submit"
              disabled={!editPrompt.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Send
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function ToolViewer({ toolId }: ToolViewerProps) {
  const [isDark, setIsDark] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const toolRef = useRef<Tool | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

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

      if (message.type === "agent-native-tool-error-fix") {
        const t = toolRef.current;
        if (!t) return;
        const errors: string[] = message.errors || [];
        sendToAgentChat({
          message: `Fix runtime errors in this tool:\n${errors.join("\n")}`,
          context: `The user is viewing tool "${t.name}" (id: ${t.id}) and there are runtime errors that need fixing.`,
          submit: true,
          openSidebar: true,
        });
        return;
      }

      if (message.type !== "agent-native-tool-request") return;

      const requestId = String(message.requestId ?? "");
      const path = String(message.path ?? "");
      const respond = (payload: Record<string, unknown>) => {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "agent-native-tool-response",
            requestId,
            ...payload,
          },
          "*",
        );
      };

      if (!requestId || !isAllowedToolPath(path)) {
        respond({ error: "Tool request path is not allowed" });
        return;
      }

      try {
        const options = sanitizeToolRequestOptions(message.options);
        const res = await fetch(path, {
          ...options,
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
        respond({ error: err?.message ?? "Tool host request failed" });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const { data: tool, isLoading } = useQuery<Tool>({
    queryKey: ["tool", toolId],
    queryFn: async () => {
      const res = await fetch(`/_agent-native/tools/${toolId}`);
      if (!res.ok) throw new Error("Failed to fetch tool");
      return res.json();
    },
  });

  toolRef.current = tool ?? null;

  const iframeSrc = useMemo(
    () =>
      `/_agent-native/tools/${toolId}/render?dark=${document.documentElement.classList.contains("dark")}&v=${encodeURIComponent(tool?.updatedAt ?? "")}&r=${refreshKey}`,
    [toolId, tool?.updatedAt, refreshKey],
  );

  useEffect(() => {
    setIframeReady(false);
  }, [toolId, tool?.updatedAt, refreshKey]);

  const startRename = useCallback(() => {
    if (!tool) return;
    setRenameValue(tool.name);
    setIsRenaming(true);
    requestAnimationFrame(() => renameInputRef.current?.select());
  }, [tool]);

  const submitRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !tool || trimmed === tool.name) {
      setIsRenaming(false);
      return;
    }
    queryClient.setQueryData<Tool>(["tool", toolId], (old) =>
      old ? { ...old, name: trimmed } : old,
    );
    queryClient.setQueryData<Tool[]>(["tools"], (old) =>
      (old ?? []).map((t) => (t.id === toolId ? { ...t, name: trimmed } : t)),
    );
    setIsRenaming(false);
    try {
      await fetch(`/_agent-native/tools/${toolId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      queryClient.invalidateQueries({ queryKey: ["tool", toolId] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
    } catch {
      queryClient.invalidateQueries({ queryKey: ["tool", toolId] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
    }
  }, [renameValue, tool, toolId, queryClient]);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b">
          <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
          <div className="h-3.5 w-24 rounded bg-muted animate-pulse" />
        </div>
        <div className="flex-1 bg-muted/20 animate-pulse" />
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Tool not found
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
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
              <span className="text-sm font-medium">{tool.name}</span>
              <button
                type="button"
                onClick={startRename}
                className="cursor-pointer rounded p-0.5 text-muted-foreground/40 opacity-0 group-hover/name:opacity-100 hover:text-foreground"
                title="Rename"
              >
                <IconPencil className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
            title="Refresh"
          >
            <IconRefresh className="h-4 w-4" />
          </button>
          <EditToolPopover tool={tool} />
          <ShareButton
            resourceType="tool"
            resourceId={toolId}
            resourceTitle={tool.name}
          />
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        {!iframeReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          </div>
        )}
        <iframe
          ref={iframeRef}
          key={`${tool.updatedAt}-${refreshKey}`}
          src={iframeSrc}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-forms"
          title={tool.name}
          onLoad={() => {
            sendThemeToIframe();
            setTimeout(() => setIframeReady(true), 150);
          }}
        />
      </div>
    </div>
  );
}

function isAllowedToolPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  return true;
}

function sanitizeToolRequestOptions(value: unknown): RequestInit {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const method =
    typeof raw.method === "string" && raw.method.trim()
      ? raw.method.toUpperCase()
      : "GET";
  const headers =
    raw.headers && typeof raw.headers === "object"
      ? Object.fromEntries(
          Object.entries(raw.headers as Record<string, unknown>)
            .filter(([key, val]) => isAllowedHeader(key) && val !== undefined)
            .map(([key, val]) => [key, String(val)]),
        )
      : undefined;
  const body =
    typeof raw.body === "string" ||
    raw.body instanceof Blob ||
    raw.body instanceof FormData
      ? raw.body
      : raw.body === undefined
        ? undefined
        : JSON.stringify(raw.body);

  return {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  };
}

function isAllowedHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return !["cookie", "host", "origin", "referer"].includes(lower);
}
