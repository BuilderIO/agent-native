import {
  IconArrowLeft,
  IconArrowBackUp,
  IconChevronRight,
  IconCode,
  IconDotsVertical,
  IconHistory,
  IconLoader2,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { buildExtensionHtml } from "../../extensions/html-shell.js";
import { extensionPath, isExtensionPathname } from "../../extensions/path.js";
import { getThemeVars } from "../../extensions/theme.js";
import { sendToAgentChat } from "../agent-chat.js";
import { AgentToggleButton } from "../AgentPanel.js";
import { agentNativePath, appPath } from "../api-path.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
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
import { PromptComposer } from "../composer/PromptComposer.js";
import { isEmbedMcpChatBridgeActive } from "../embed-auth.js";
import { ShareButton } from "../sharing/ShareButton.js";
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
  ownerEmail?: string;
  role?: ExtensionBridgeRole | null;
  canEdit?: boolean;
  canDelete?: boolean;
  source?: {
    mode?: "database" | "local-files";
    entryPath?: string;
    manifestPath?: string;
    permissions?: BridgePolicyContext["permissions"];
  };
}

export interface ExtensionViewerProps {
  extensionId: string;
}

function readExtensionTitleSuffix(): string | null {
  const current = typeof document !== "undefined" ? document.title.trim() : "";
  const match = current.match(/^(?:Extension|Tool)s?\s+(?:\u2014|-)\s+(.+)$/);
  return match?.[1]?.trim() || null;
}

function extensionDocumentTitle(name: string, suffix: string | null): string {
  return suffix ? `${name} \u2014 ${suffix}` : `${name} \u2014 Extensions`;
}

function extensionRole(value: unknown): ExtensionBridgeRole {
  return value === "owner" ||
    value === "admin" ||
    value === "editor" ||
    value === "viewer"
    ? value
    : "viewer";
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

function buildExtensionViewerSrcDoc(
  extension: Extension,
  isDark: boolean,
): string {
  const role = extensionRole(extension.role);
  return buildExtensionHtml(
    extension.content ?? "",
    getThemeVars(isDark),
    isDark,
    extension.id,
    {
      authorEmail: extension.ownerEmail ?? "",
      viewerEmail: "",
      isAuthor: role === "owner",
      role,
      source: extension.source?.mode,
      permissions: extension.source?.permissions,
    },
  );
}

interface ExtensionHistoryEntry {
  id: string;
  extensionId: string;
  version: number;
  operation: string;
  summary: string;
  name: string;
  description: string;
  icon: string | null;
  actorEmail: string | null;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  persisted: boolean;
  contentLength: number;
}

interface ExtensionHistoryDiffLine {
  type: "equal" | "insert" | "delete";
  text: string;
}

interface ExtensionHistoryDetail {
  entry: ExtensionHistoryEntry & { content?: string };
  previous: (ExtensionHistoryEntry & { content?: string }) | null;
  diff: ExtensionHistoryDiffLine[];
  stats: {
    addedLines: number;
    deletedLines: number;
    changed: boolean;
  };
}

type CompactDiffLine =
  | ExtensionHistoryDiffLine
  | { type: "omitted"; count: number };

function formatHistoryTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function operationLabel(operation: string): string {
  switch (operation) {
    case "create":
      return "Created";
    case "baseline":
      return "Baseline";
    case "metadata-update":
      return "Details";
    case "content-update":
      return "Content";
    case "restore":
      return "Restore";
    default:
      return operation;
  }
}

function compactDiffLines(
  lines: ExtensionHistoryDiffLine[],
  context = 3,
): CompactDiffLine[] {
  const result: CompactDiffLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type !== "equal") {
      result.push(line);
      i += 1;
      continue;
    }

    let end = i + 1;
    while (end < lines.length && lines[end].type === "equal") end += 1;
    const run = lines.slice(i, end);
    if (run.length > context * 2 + 1) {
      result.push(...run.slice(0, context));
      result.push({ type: "omitted", count: run.length - context * 2 });
      result.push(...run.slice(-context));
    } else {
      result.push(...run);
    }
    i = end;
  }
  return result;
}

function diffLineClass(line: CompactDiffLine): string {
  switch (line.type) {
    case "insert":
      return "bg-primary/10 text-primary";
    case "delete":
      return "bg-destructive/10 text-destructive";
    case "omitted":
      return "bg-muted/60 text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function diffLinePrefix(line: CompactDiffLine): string {
  switch (line.type) {
    case "insert":
      return "+";
    case "delete":
      return "-";
    case "omitted":
      return "...";
    default:
      return " ";
  }
}

function applyCanonicalLink(path: string): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return () => {};
  }

  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const created = !link;
  const previousHref = link?.getAttribute("href") ?? null;
  const previousMarker = link?.dataset.agentNativeExtensionCanonical;

  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }

  link.dataset.agentNativeExtensionCanonical = "true";
  link.href = new URL(appPath(path), window.location.origin).toString();

  return () => {
    if (!link) return;
    if (created) {
      link.remove();
      return;
    }
    if (previousHref === null) {
      link.removeAttribute("href");
    } else {
      link.href = previousHref;
    }
    if (previousMarker === undefined) {
      delete link.dataset.agentNativeExtensionCanonical;
    } else {
      link.dataset.agentNativeExtensionCanonical = previousMarker;
    }
  };
}

function SourceCodeDialog({
  extension,
  onSaved,
}: {
  extension: Extension;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(extension.content ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the extension content changes externally
  useEffect(() => {
    if (!open) setCode(extension.content ?? "");
  }, [extension.content, open]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        agentNativePath(`/_agent-native/extensions/${extension.id}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: code }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      setOpen(false);
      onSaved?.();
    } catch (err: any) {
      setError(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
          >
            <IconCode className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>View / edit source</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85vh] w-[90vw] max-w-[900px] flex-col gap-3">
          <DialogHeader className="shrink-0">
            <DialogTitle className="truncate text-sm">
              {extension.name} — source
            </DialogTitle>
          </DialogHeader>
          <textarea
            className="flex-1 resize-none rounded-md border border-input bg-muted px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
          />
          {error ? (
            <p className="shrink-0 text-xs text-destructive">{error}</p>
          ) : null}
          <div className="flex shrink-0 justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs hover:bg-accent cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditToolPopover({
  extension,
  onOpenChange,
}: {
  extension: Extension;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const setOpenAndNotify = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  };

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
        if (document.activeElement?.tagName === "IFRAME")
          setOpenAndNotify(false);
      }, 0);
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [open]);

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendToAgentChat({
      message: `Update extension "${extension.name}" (${extension.id}): ${trimmed}`,
      context: [
        `The user is viewing extension "${extension.name}" (id: ${extension.id}) and wants to edit it.`,
        "This is an existing sandboxed Alpine.js extension stored in SQL. Use list-extensions/update-extension for this extension id.",
        "Do not call connect-builder and do not route this to a source-code change flow.",
      ].join("\n"),
      submit: true,
      openSidebar: true,
      newTab: true,
    });
    setOpenAndNotify(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpenAndNotify}>
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

function ExtensionHistoryPopover({
  extensionId,
  canEdit,
  onRestored,
  onOpenChange,
}: {
  extensionId: string;
  canEdit?: boolean;
  onRestored?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const setOpenAndNotify = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  };

  const historyQuery = useQuery<{ history: ExtensionHistoryEntry[] }>({
    queryKey: ["extension-history", extensionId],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(`/_agent-native/extensions/${extensionId}/history`),
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to fetch extension history");
      return res.json();
    },
    enabled: open,
  });

  const history = historyQuery.data?.history ?? [];
  useEffect(() => {
    if (!open || history.length === 0) return;
    if (
      !selectedVersion ||
      !history.some((h) => h.version === selectedVersion)
    ) {
      setSelectedVersion(history[0].version);
    }
  }, [history, open, selectedVersion]);

  const detailQuery = useQuery<ExtensionHistoryDetail>({
    queryKey: ["extension-history-detail", extensionId, selectedVersion],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(
          `/_agent-native/extensions/${extensionId}/history/${selectedVersion}`,
        ),
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to fetch extension history version");
      return res.json();
    },
    enabled: open && selectedVersion !== null,
  });

  const latestVersion = history[0]?.version ?? null;
  const selectedEntry =
    history.find((entry) => entry.version === selectedVersion) ?? history[0];
  const canRestoreSelected =
    !!canEdit &&
    !!selectedEntry?.persisted &&
    selectedEntry.version !== latestVersion;

  const restoreSelected = async () => {
    if (!selectedEntry || !canRestoreSelected) return;
    setRestoringVersion(selectedEntry.version);
    try {
      const res = await fetch(
        agentNativePath(
          `/_agent-native/extensions/${extensionId}/history/${selectedEntry.version}/restore`,
        ),
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to restore extension version");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["extension", extensionId] }),
        queryClient.invalidateQueries({ queryKey: ["extensions"] }),
        queryClient.invalidateQueries({
          queryKey: ["extension-history", extensionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["extension-history-detail", extensionId],
        }),
      ]);
      onRestored?.();
    } finally {
      setRestoringVersion(null);
    }
  };

  const compactedDiff = compactDiffLines(detailQuery.data?.diff ?? []);

  return (
    <Popover open={open} onOpenChange={setOpenAndNotify}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
              aria-label="History"
            >
              <IconHistory className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>History</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[42rem] max-w-[calc(100vw-2rem)] p-0"
      >
        <div className="grid max-h-[72vh] min-h-[24rem] grid-cols-1 overflow-hidden sm:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="border-b border-border/60 sm:border-b-0 sm:border-r">
            <div className="border-b border-border/60 px-3 py-2">
              <p className="text-sm font-semibold text-foreground">History</p>
              <p className="text-[11px] text-muted-foreground">
                Snapshots are saved when extensions change.
              </p>
            </div>
            <div className="max-h-56 overflow-y-auto p-1 sm:max-h-[calc(72vh-3.5rem)]">
              {historyQuery.isLoading ? (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading history
                </div>
              ) : history.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No history yet.
                </p>
              ) : (
                history.map((entry) => (
                  <button
                    key={`${entry.id}-${entry.version}`}
                    type="button"
                    onClick={() => setSelectedVersion(entry.version)}
                    className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left text-xs hover:bg-accent ${
                      entry.version === selectedVersion
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        Version {entry.version}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {operationLabel(entry.operation)}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-[11px] text-muted-foreground">
                      {entry.summary || "Saved version"}
                    </span>
                    <span className="text-[10px] text-muted-foreground/80">
                      {formatHistoryTime(entry.createdAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {selectedEntry
                    ? `Version ${selectedEntry.version}`
                    : "Select a version"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {selectedEntry?.summary ?? "Compare saved extension content"}
                </p>
              </div>
              <button
                type="button"
                disabled={!canRestoreSelected || restoringVersion !== null}
                onClick={restoreSelected}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              >
                {restoringVersion === selectedEntry?.version ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <IconArrowBackUp className="h-3.5 w-3.5" />
                )}
                Restore
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
              {detailQuery.isLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading diff
                </div>
              ) : detailQuery.isError ? (
                <div className="p-4 text-xs text-destructive">
                  Could not load this version.
                </div>
              ) : compactedDiff.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">
                  No content changes in this version.
                </div>
              ) : (
                <pre className="min-w-full text-[11px] leading-5">
                  {compactedDiff.map((line, index) => (
                    <div
                      key={index}
                      className={`grid grid-cols-[2rem_minmax(0,1fr)] px-2 ${diffLineClass(line)}`}
                    >
                      <span className="select-none text-right font-mono opacity-70">
                        {diffLinePrefix(line)}
                      </span>
                      <span className="whitespace-pre-wrap break-words pl-3 font-mono">
                        {line.type === "omitted"
                          ? `${line.count} unchanged lines`
                          : line.text}
                      </span>
                    </div>
                  ))}
                </pre>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ExtensionViewer({ extensionId }: ExtensionViewerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const toolRef = useRef<Extension | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const titleSuffixRef = useRef<string | null | undefined>(undefined);
  // Tracks how many toolbar popovers are open. Iframes capture pointer events
  // from areas they visually overlap, so when a popover opens above the iframe,
  // hover and click on the popover items get swallowed by the iframe. Disabling
  // pointer-events on the iframe while any popover is open lets the popover
  // receive its own events. Each popover increments on open / decrements on
  // close, so concurrent popovers (rare) compose correctly.
  const [openPopoverCount, setOpenPopoverCount] = useState(0);
  const onPopoverOpenChange = useCallback((open: boolean) => {
    setOpenPopoverCount((c) => Math.max(0, c + (open ? 1 : -1)));
  }, []);
  const queryClient = useQueryClient();
  // (audit H4) Role plumbed through from the iframe's render binding. Until
  // the iframe announces its role we deny non-trivial helper calls — that
  // way a malicious extension body that races the announcement can't briefly
  // operate at higher privilege than the viewer's actual role.
  const bridgeContextRef = useRef<BridgePolicyContext>({
    role: "viewer",
    isAuthor: false,
  });
  // (audit H4) Latch the render binding once per iframe instance; later
  // announcements are attacker-controllable and must be ignored.
  const bindingLatchedRef = useRef(false);

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
        // (audit H4) Trust only the FIRST announcement: the shell sends the
        // server-resolved binding BEFORE user-authored content runs. Later
        // announcements share the iframe realm with user code and could forge
        // an owner role, so they are ignored.
        if (bindingLatchedRef.current) return;
        bindingLatchedRef.current = true;
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
          source: binding.source === "local-files" ? "local-files" : "database",
          permissions:
            binding && typeof binding.permissions === "object"
              ? binding.permissions
              : undefined,
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

      if (message.type === "agent-native-send-to-chat") {
        const text = serializeChatValue(message.message);
        if (!text?.trim()) return;
        sendToAgentChat({
          message: text,
          context: serializeChatValue(message.context),
          submit: message.submit !== false,
          openSidebar: message.openSidebar !== false,
        });
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

        // Force a fresh read from the server. toolRef.current is bound to the
        // React Query cache, which is the same state the agent's previous
        // (broken) turn just wrote — without this, Fix-in-same-chat ends up
        // patching the agent's prior attempt from chat history instead of the
        // current DB row, which is why users had to open a new chat to
        // recover. Cache-bust so we never read a stale fetch.
        let freshContent: string | undefined;
        try {
          const res = await fetch(
            agentNativePath(`/_agent-native/extensions/${t.id}`),
            { cache: "no-store" },
          );
          if (res.ok) {
            const fresh = (await res.json()) as Extension;
            freshContent =
              typeof fresh?.content === "string" ? fresh.content : undefined;
          }
        } catch {
          // Fall through with the cached value — agent can still re-read via
          // its get-extension tool.
        }

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

        if (freshContent) {
          contextParts.push(
            `\nCurrent extension content (just re-read from the database — this is the authoritative source, not anything you may have written in a previous turn):\n\`\`\`html\n${freshContent}\n\`\`\``,
          );
        }

        sendToAgentChat({
          message: `Fix runtime errors in this extension. The content snapshot below was just re-read from the database — treat it as authoritative and ignore any prior version you may have generated in this chat. If in doubt, call get-extension first.\n\nErrors:\n${errors.join("\n")}`,
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
        // (audit H5) Tag every outbound bridge request with the
        // X-Agent-Native-Extension-Bridge sentinel so the action-routes layer can
        // enforce per-action `toolCallable` opt-in. The header is added by
        // the parent — it is NOT taken from the iframe-supplied options
        // (which were filtered by sanitizeExtensionRequestOptions).
        const finalHeaders = new Headers(options.headers ?? undefined);
        finalHeaders.set("X-Agent-Native-Extension-Bridge", "1");
        finalHeaders.set("X-Agent-Native-Extension-Id", extensionId);
        finalHeaders.set("X-Agent-Native-Tool-Bridge", "1");
        finalHeaders.set("X-Agent-Native-Tool-Id", extensionId);
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

  const {
    data: extension,
    error: extensionError,
    isFetching,
    isLoading,
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

  toolRef.current = extension ?? null;

  useEffect(() => {
    if (!extension) return;
    const canonicalPath = extensionPath(extension.id, extension.name);
    if (titleSuffixRef.current === undefined) {
      titleSuffixRef.current = readExtensionTitleSuffix();
    }
    document.title = extensionDocumentTitle(
      extension.name,
      titleSuffixRef.current,
    );

    if (
      isExtensionPathname(location.pathname, extension.id) &&
      location.pathname !== canonicalPath
    ) {
      navigate(`${canonicalPath}${location.search}${location.hash}`, {
        replace: true,
      });
    }

    return applyCanonicalLink(canonicalPath);
  }, [extension, location.hash, location.pathname, location.search, navigate]);

  const iframeSrc = useMemo(
    () =>
      agentNativePath(
        `/_agent-native/extensions/${extensionId}/render?dark=${document.documentElement.classList.contains("dark")}&v=${encodeURIComponent(extension?.updatedAt ?? "")}&r=${refreshKey}`,
      ),
    [extensionId, extension?.updatedAt, refreshKey],
  );
  const iframeSrcDoc = useMemo(() => {
    if (!extension?.content || !isEmbedMcpChatBridgeActive()) return undefined;
    return buildExtensionViewerSrcDoc(extension, isDark);
  }, [extension, isDark]);

  useEffect(() => {
    setIframeReady(false);
    // Reset role to deny-by-default on every reload — the new render's
    // binding announcement re-establishes the role before any helper call.
    bridgeContextRef.current = { role: "viewer", isAuthor: false };
    bindingLatchedRef.current = false;
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

  if (isLoading || (!extension && isFetching)) {
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
    const status = extensionLoadErrorStatus(extensionError);
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {status === 403 ? "Extension access denied" : "Extension not found"}
      </div>
    );
  }

  const isLocalExtension = extension.source?.mode === "local-files";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full w-full flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3">
          <div className="flex min-w-0 items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/"
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  aria-label="Back to app"
                >
                  <IconArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Back to app</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Back to app</TooltipContent>
            </Tooltip>
            <nav
              aria-label="Extension breadcrumb"
              className="group/name flex min-w-0 items-center gap-1 text-sm"
            >
              <Link
                to="/extensions"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                Extensions
              </Link>
              <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
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
                  className="min-w-0 bg-transparent px-0 py-0 text-sm font-medium outline-none border-b border-primary"
                />
              ) : (
                <>
                  <span className="truncate text-sm font-medium">
                    {extension.name}
                  </span>
                  {extension.canEdit && !isLocalExtension && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={startRename}
                          className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground/40 opacity-0 group-hover/name:opacity-100 hover:text-foreground"
                        >
                          <IconPencil className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Rename</TooltipContent>
                    </Tooltip>
                  )}
                </>
              )}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
            {!isLocalExtension && (
              <>
                <ExtensionHistoryPopover
                  extensionId={extensionId}
                  canEdit={extension.canEdit}
                  onRestored={() => setRefreshKey((k) => k + 1)}
                  onOpenChange={onPopoverOpenChange}
                />
                {extension.canEdit && (
                  <SourceCodeDialog
                    extension={extension}
                    onSaved={() => setRefreshKey((k) => k + 1)}
                  />
                )}
                <EditToolPopover
                  extension={extension}
                  onOpenChange={onPopoverOpenChange}
                />
              </>
            )}
            <ToolMoreMenu
              extensionId={extensionId}
              toolName={extension.name}
              canDelete={extension.canDelete}
              sourceMode={extension.source?.mode}
              onOpenChange={onPopoverOpenChange}
            />
            {!isLocalExtension && (
              <>
                <ShareButton
                  resourceType="extension"
                  resourceId={extensionId}
                  resourceTitle={extension.name}
                  onOpenChange={onPopoverOpenChange}
                  accessNote={
                    <>
                      Extensions can be shared inside your organization only —
                      they run with the viewer's credentials, so cross-org
                      access isn't supported.
                    </>
                  }
                />
              </>
            )}
            <AgentToggleButton />
          </div>
        </div>
        {isLocalExtension && (
          <div className="shrink-0 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            Repo-backed extension. Edit{" "}
            <span className="font-mono text-foreground">
              {extension.source?.entryPath ?? "extensions/*/index.html"}
            </span>{" "}
            in your workspace, then refresh this preview.
          </div>
        )}
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
            src={iframeSrcDoc ? undefined : iframeSrc}
            srcDoc={iframeSrcDoc}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-forms"
            title={extension.name}
            style={{
              pointerEvents: openPopoverCount > 0 ? "none" : "auto",
            }}
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
  canDelete,
  sourceMode,
  onOpenChange,
}: {
  extensionId: string;
  toolName: string;
  canDelete?: boolean;
  sourceMode?: "database" | "local-files";
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setOpenAndNotify = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  };

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
    setOpenAndNotify(false);
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
      await deleteOrHideExtension({ id: extensionId, canDelete });
      invalidateExtensionRemoval(queryClient, extensionId);
      slots.forEach((s) =>
        queryClient.invalidateQueries({
          queryKey: ["slot-installs", s.slotId],
        }),
      );
      navigate("/extensions");
    } catch {
      queryClient.invalidateQueries({ queryKey: ["extension", extensionId] });
    }
  };
  const isLocalExtension = sourceMode === "local-files";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpenAndNotify(o);
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
              <IconDotsVertical className="h-4 w-4" />
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
                    {!isLocalExtension && (
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
                    )}
                  </div>
                ))}
              </div>
            )}
            {isLocalExtension ? (
              <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
                Slot targets and source edits are controlled by this extension's
                files.
              </div>
            ) : (
              <div className="border-t border-border/40 p-1">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] text-destructive hover:bg-destructive/10 cursor-pointer text-left"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                  <span>
                    {canDelete === false
                      ? "Remove from my list..."
                      : "Delete extension..."}
                  </span>
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            <p className="text-[12px]">
              {canDelete === false ? "Remove " : "Delete "}
              <span className="font-medium">{toolName}</span>?
              {canDelete === false
                ? " This hides it from your Extensions list without deleting it for anyone else."
                : " This removes the extension everywhere, for everyone it's shared with."}
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
                {canDelete === false ? "Remove" : "Delete"}
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
