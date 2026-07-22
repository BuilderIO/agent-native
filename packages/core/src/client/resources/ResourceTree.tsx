import {
  IconChevronRight,
  IconChevronDown,
  IconFolder,
  IconFileText,
  IconFileCode,
  IconPhoto,
  IconFile,
  IconPlus,
  IconTrash,
  IconHierarchy2,
  IconPlugConnected,
  IconBrowser,
  IconDeviceDesktop,
  IconBulb,
  IconClockHour3,
  IconLoader2,
  IconHelpCircle,
} from "@tabler/icons-react";
import React, { useState, useRef, useCallback } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { cn } from "../utils.js";
import type { McpServer } from "./use-mcp-servers.js";
import type { TreeNode, ResourceMeta, JobMetadata } from "./use-resources.js";

function StatusDot({
  className,
  tooltip,
}: {
  className: string;
  tooltip: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={tooltip}
            className={cn("ml-1 inline-block h-1.5 w-1.5 shrink-0", className)}
          />
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getFileIcon(node: TreeNode): React.ReactNode {
  if (node.kind === "agent") {
    return (
      <IconHierarchy2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    );
  }
  if (node.kind === "remote-agent" || node.kind === "mcp-server") {
    return (
      <IconPlugConnected className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    );
  }
  if (node.kind === "mcp-builtin") {
    return node.mcpBuiltinMeta?.exclusiveGroup === "browser" ? (
      <IconBrowser className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    ) : (
      <IconDeviceDesktop className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    );
  }
  if (node.kind === "skill") {
    return <IconBulb className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
  if (node.kind === "job") {
    return (
      <IconClockHour3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    );
  }
  const name = node.name;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const iconClass = "h-3.5 w-3.5 shrink-0 text-muted-foreground";
  if (ext === "md" || ext === "mdx")
    return <IconFileText className={iconClass} />;
  if (
    ["ts", "tsx", "js", "jsx", "json", "css", "html", "py", "sh"].includes(ext)
  )
    return <IconFileCode className={iconClass} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext))
    return <IconPhoto className={iconClass} />;
  return <IconFile className={iconClass} />;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResourceTreeProps {
  tree: TreeNode[];
  /** Presentation mode for the resources: nested tree rows or a flat collection. */
  variant?: "tree" | "collection";
  selectedId: string | null;
  onSelect: (resource: ResourceMeta) => void;
  onCreateFile: (parentPath: string, name: string) => void;
  onCreateFolder: (parentPath: string, name: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newPath: string) => void;
  onDrop: (files: FileList) => void;
  /** Section title displayed as heading */
  title?: string;
  /** Tooltip for the section heading */
  titleTooltip?: string;
  /** Whether this section's tree is still loading */
  isLoading?: boolean;
  /** Resource id currently being deleted (shows spinner + muted row) */
  deletingId?: string | null;
  /** When true, hide create/delete/rename/upload affordances. Files stay readable. */
  readOnly?: boolean;
  /** Optional hint shown next to the heading (e.g. "Read only") */
  headingHint?: React.ReactNode;
  /** Scope-specific action shown beside the section heading. */
  sectionAction?: React.ReactNode;
  /** Scope-specific action shown beneath an empty collection message. */
  emptyStateAction?: React.ReactNode;
}

interface CreatingState {
  parentPath: string;
  type: "file" | "folder";
}

function McpStatusDot({ server }: { server: McpServer }) {
  const status = server.status ?? { state: "unknown" as const };
  if (status.state === "connected") {
    return (
      <StatusDot
        className="rounded-full bg-green-500"
        tooltip={`Connected: ${status.toolCount} tool${status.toolCount === 1 ? "" : "s"}`}
      />
    );
  }
  if (status.state === "error") {
    return (
      <StatusDot
        className="rounded-full bg-red-500"
        tooltip={`Error: ${status.error}`}
      />
    );
  }
  return (
    <StatusDot
      className="rounded-full bg-muted-foreground/40"
      tooltip="Connecting…"
    />
  );
}

function BuiltinStatusDot({ node }: { node: TreeNode }) {
  const meta = node.mcpBuiltinMeta;
  if (!meta?.available) {
    return (
      <StatusDot
        className="rounded-full bg-muted-foreground/30"
        tooltip={meta?.unavailableReason ?? "Not available on this host"}
      />
    );
  }
  if (!meta.scopeEnabled) {
    return (
      <StatusDot
        className="rounded-full bg-muted-foreground/40"
        tooltip="Disabled"
      />
    );
  }
  const status = meta.status?.[meta.scope];
  if (status?.state === "connected") {
    return (
      <StatusDot
        className="rounded-full bg-green-500"
        tooltip={`Connected — ${status.toolCount} tool${status.toolCount === 1 ? "" : "s"}`}
      />
    );
  }
  if (status?.state === "error") {
    return (
      <StatusDot
        className="rounded-full bg-red-500"
        tooltip={`Error: ${status.error}`}
      />
    );
  }
  return <StatusDot className="rounded-full bg-amber-500" tooltip="Enabled" />;
}

function JobStatusDot({ meta }: { meta: JobMetadata }) {
  if (!meta.enabled) {
    return (
      <StatusDot
        className="rounded-full bg-muted-foreground/40"
        tooltip="Disabled"
      />
    );
  }
  if (meta.lastStatus === "running") {
    return (
      <StatusDot
        className="rounded-full bg-blue-500 animate-pulse"
        tooltip="Running"
      />
    );
  }
  if (meta.lastStatus === "error") {
    return (
      <StatusDot
        className="rounded-full bg-red-500"
        tooltip="Last run failed"
      />
    );
  }
  if (meta.lastStatus === "success") {
    return (
      <StatusDot
        className="rounded-full bg-green-500"
        tooltip="Last run succeeded"
      />
    );
  }
  return (
    <StatusDot
      className="rounded-full bg-amber-500"
      tooltip="Scheduled (not yet run)"
    />
  );
}

type LeafResourceNode = TreeNode & { resource: ResourceMeta };

function getLeafResources(nodes: TreeNode[]): LeafResourceNode[] {
  return nodes.flatMap((node) => {
    if (node.type === "folder") {
      return getLeafResources(node.children ?? []);
    }
    return node.resource ? [node as LeafResourceNode] : [];
  });
}

function formatResourceSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getCollectionDescriptor(node: LeafResourceNode): string {
  if (node.kind === "agent") {
    return (
      node.agentMeta?.description || node.agentMeta?.model || "Custom agent"
    );
  }
  if (node.kind === "skill") {
    return node.skillMeta?.description || "Skill";
  }
  if (node.kind === "remote-agent") {
    return (
      node.remoteAgentMeta?.description ||
      node.remoteAgentMeta?.url ||
      "Remote agent"
    );
  }
  if (node.kind === "job") {
    return (
      node.jobMeta?.scheduleDescription ||
      node.jobMeta?.schedule ||
      "Scheduled job"
    );
  }
  if (node.kind === "mcp-server") return "MCP server";
  if (node.kind === "mcp-builtin") return "Built-in MCP";
  return formatResourceSize(node.resource.size);
}

function CollectionResourceRow({
  node,
  selectedId,
  deletingId,
  readOnly,
  onSelect,
  onDelete,
}: {
  node: LeafResourceNode;
  selectedId: string | null;
  deletingId?: string | null;
  readOnly?: boolean;
  onSelect: (resource: ResourceMeta) => void;
  onDelete: (id: string) => void;
}) {
  const isSelected = node.resource.id === selectedId;
  const isDeleting = node.resource.id === deletingId;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const descriptor = getCollectionDescriptor(node);

  const selectResource = () => {
    if (!isDeleting) onSelect(node.resource);
  };

  return (
    <div
      className={cn(
        "group/collection-row flex w-full items-center gap-3 px-2.5 py-3 text-left transition-[background-color,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        isDeleting
          ? "pointer-events-none opacity-40"
          : isSelected
            ? "bg-accent text-foreground"
            : "text-foreground hover:bg-accent/50",
      )}
      onMouseLeave={() => setConfirmingDelete(false)}
    >
      <button
        type="button"
        disabled={isDeleting}
        aria-pressed={isSelected}
        onClick={selectResource}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50",
            isSelected && "bg-background/70",
          )}
        >
          {getFileIcon(node)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[12px] font-medium">
              {node.name}
            </span>
            {node.jobMeta && <JobStatusDot meta={node.jobMeta} />}
            {node.mcpServerMeta && <McpStatusDot server={node.mcpServerMeta} />}
            {node.mcpBuiltinMeta && <BuiltinStatusDot node={node} />}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px]">
            <span className="min-w-0 truncate text-muted-foreground/60">
              {node.resource.path}
            </span>
            <span className="shrink-0 text-muted-foreground/30">·</span>
            <span className="max-w-[40%] shrink-0 truncate text-muted-foreground/80">
              {descriptor}
            </span>
          </div>
        </div>
      </button>
      {!readOnly && node.kind !== "mcp-builtin" && (
        <div
          className={cn(
            "flex shrink-0 items-center opacity-0 transition-opacity group-hover/collection-row:opacity-100 group-focus-within/collection-row:opacity-100",
            confirmingDelete && "opacity-100",
          )}
        >
          <TooltipProvider delayDuration={200}>
            {isDeleting ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    aria-label="Deleting…"
                    className="flex size-6 items-center justify-center rounded text-muted-foreground"
                  >
                    <IconLoader2 className="size-3.5 animate-spin" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>Deleting…</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (confirmingDelete) {
                        onDelete(node.resource.id);
                        setConfirmingDelete(false);
                      } else {
                        setConfirmingDelete(true);
                      }
                    }}
                    aria-label={confirmingDelete ? "Confirm delete" : "Delete"}
                    className={cn(
                      "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-destructive",
                      confirmingDelete && "bg-destructive/10 text-destructive",
                    )}
                  >
                    <IconTrash className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {confirmingDelete ? "Click again to delete" : "Delete"}
                </TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}

// ─── TreeNodeRow ────────────────────────────────────────────────────────────

function TreeNodeRow({
  node,
  depth,
  expanded,
  selectedId,
  deletingId,
  readOnly,
  onToggle,
  onSelect,
  onDelete,
  onStartCreate,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selectedId: string | null;
  deletingId?: string | null;
  readOnly?: boolean;
  onToggle: (path: string) => void;
  onSelect: (resource: ResourceMeta) => void;
  onDelete: (id: string) => void;
  onStartCreate: (parentPath: string, type: "file" | "folder") => void;
}) {
  const isFolder = node.type === "folder";
  const isExpanded = expanded.has(node.path);
  const isSelected = node.resource?.id === selectedId;
  const isDeleting = !!node.resource && node.resource.id === deletingId;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div>
      <div
        className={cn(
          "group/row flex items-center gap-1 rounded-md px-1.5 py-1 select-none",
          isDeleting ? "pointer-events-none opacity-40" : "cursor-pointer",
          isSelected
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
        style={{ paddingLeft: depth * 16 + 6 }}
        onClick={() => {
          if (isDeleting) return;
          if (isFolder) {
            onToggle(node.path);
          } else if (node.resource) {
            onSelect(node.resource);
          }
        }}
        onMouseLeave={() => setConfirmingDelete(false)}
      >
        {isFolder ? (
          isExpanded ? (
            <IconChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <IconChevronRight className="h-3 w-3 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isFolder ? (
          <IconFolder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          getFileIcon(node)
        )}
        <span className="min-w-0 truncate text-[12px] leading-none">
          {node.name}
        </span>
        {node.jobMeta && <JobStatusDot meta={node.jobMeta} />}
        {node.mcpServerMeta && <McpStatusDot server={node.mcpServerMeta} />}
        {node.mcpBuiltinMeta && <BuiltinStatusDot node={node} />}
        {!readOnly && (
          <div
            className={cn(
              "ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100",
              confirmingDelete && "opacity-100",
            )}
          >
            <TooltipProvider delayDuration={200}>
              {isFolder && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartCreate(node.path, "file");
                      }}
                      aria-label="New file"
                      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    >
                      <IconPlus className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>New file</TooltipContent>
                </Tooltip>
              )}
              {node.resource &&
                node.kind !== "mcp-builtin" &&
                (isDeleting ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        aria-label="Deleting…"
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground"
                      >
                        <IconLoader2 className="h-3 w-3 animate-spin" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Deleting…</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirmingDelete) {
                            onDelete(node.resource!.id);
                            setConfirmingDelete(false);
                          } else {
                            setConfirmingDelete(true);
                          }
                        }}
                        aria-label={
                          confirmingDelete ? "Confirm delete" : "Delete"
                        }
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent/50",
                          confirmingDelete &&
                            "bg-destructive/10 text-destructive",
                        )}
                      >
                        <IconTrash className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {confirmingDelete ? "Click again to delete" : "Delete"}
                    </TooltipContent>
                  </Tooltip>
                ))}
            </TooltipProvider>
          </div>
        )}
      </div>
      {isFolder && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.resource?.id ?? child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              deletingId={deletingId}
              readOnly={readOnly}
              onToggle={onToggle}
              onSelect={onSelect}
              onDelete={onDelete}
              onStartCreate={onStartCreate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── InlineInput ────────────────────────────────────────────────────────────

function InlineInput({
  depth,
  onConfirm,
  onCancel,
}: {
  depth: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="flex items-center gap-1 px-1.5 py-0.5"
      style={{ paddingLeft: depth * 16 + 6 + 16 }}
    >
      <IconFile className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            onConfirm(value.trim());
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        onBlur={() => {
          if (value.trim()) {
            onConfirm(value.trim());
          } else {
            onCancel();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-[12px] leading-none text-foreground outline-none placeholder:text-muted-foreground/50"
        placeholder="filename.md"
      />
    </div>
  );
}

// ─── ResourceTree ───────────────────────────────────────────────────────────

export function ResourceTree({
  tree,
  variant = "tree",
  selectedId,
  onSelect,
  onCreateFile,
  onCreateFolder,
  onDelete,
  onDrop,
  title = "Files",
  titleTooltip,
  isLoading = false,
  deletingId = null,
  readOnly = false,
  headingHint,
  sectionAction,
  emptyStateAction,
}: ResourceTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const leafResources = variant === "collection" ? getLeafResources(tree) : [];
  const isEmpty =
    variant === "collection" ? leafResources.length === 0 : tree.length === 0;

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleStartCreate = useCallback(
    (parentPath: string, type: "file" | "folder") => {
      setCreating({ parentPath, type });
      // auto-expand the parent folder
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(parentPath);
        return next;
      });
    },
    [],
  );

  const handleConfirmCreate = useCallback(
    (name: string) => {
      if (!creating) return;
      if (creating.type === "file") {
        onCreateFile(creating.parentPath, name);
      } else {
        onCreateFolder(creating.parentPath, name);
      }
      setCreating(null);
    },
    [creating, onCreateFile, onCreateFolder],
  );

  const handleCancelCreate = useCallback(() => {
    setCreating(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (readOnly) return;
      if (e.dataTransfer.files.length > 0) {
        onDrop(e.dataTransfer.files);
      }
    },
    [onDrop, readOnly],
  );

  return (
    <div
      className={cn(
        "p-1",
        dragOver && !readOnly && "ring-1 ring-inset ring-accent",
      )}
      onDragOver={readOnly ? undefined : handleDragOver}
      onDragLeave={readOnly ? undefined : handleDragLeave}
      onDrop={readOnly ? undefined : handleDrop}
    >
      {/* Section heading */}
      <div className="group/root flex items-center justify-between px-1.5 py-1">
        <TooltipProvider delayDuration={200}>
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
            {title}
            {headingHint && (
              <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground/50">
                {headingHint}
              </span>
            )}
            {titleTooltip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`About ${title}`}
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground/40 hover:text-muted-foreground"
                  >
                    <IconHelpCircle className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{titleTooltip}</TooltipContent>
              </Tooltip>
            )}
          </span>
          {sectionAction ??
            (variant === "tree" && !readOnly && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleStartCreate("", "file")}
                    aria-label="New file"
                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 opacity-0 group-hover/root:opacity-100 hover:text-foreground hover:bg-accent/50"
                  >
                    <IconPlus className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>New file</TooltipContent>
              </Tooltip>
            ))}
        </TooltipProvider>
      </div>

      {variant === "collection"
        ? leafResources.length > 0 && (
            <div className="divide-y divide-border/60">
              {leafResources.map((node) => (
                <CollectionResourceRow
                  key={node.resource.id}
                  node={node}
                  selectedId={selectedId}
                  deletingId={deletingId}
                  readOnly={readOnly}
                  onSelect={onSelect}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )
        : tree.map((node) => (
            <TreeNodeRow
              key={node.resource?.id ?? node.path}
              node={node}
              depth={0}
              expanded={expanded}
              selectedId={selectedId}
              deletingId={deletingId}
              readOnly={readOnly}
              onToggle={toggleExpand}
              onSelect={onSelect}
              onDelete={onDelete}
              onStartCreate={handleStartCreate}
            />
          ))}

      {isLoading && isEmpty && (
        <div className={cn("px-1 py-1")}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2 px-1.5 py-1",
                variant === "collection" && "gap-3 px-2.5 py-3",
              )}
            >
              <div
                className={cn(
                  "rounded bg-muted-foreground/10 animate-pulse",
                  variant === "collection" ? "size-8" : "h-3.5 w-3.5",
                )}
                style={{ animationDelay: `${i * 75}ms` }}
              />
              <div
                className="h-3 rounded bg-muted-foreground/10 animate-pulse"
                style={{
                  width: `${50 + ((i * 37) % 40)}%`,
                  animationDelay: `${i * 75}ms`,
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Inline input for root-level creation */}
      {creating && creating.parentPath === "" && (
        <InlineInput
          depth={0}
          onConfirm={handleConfirmCreate}
          onCancel={handleCancelCreate}
        />
      )}

      {/* Inline input for folder-level creation */}
      {creating && creating.parentPath !== "" && (
        <InlineInput
          depth={creating.parentPath.split("/").filter(Boolean).length}
          onConfirm={handleConfirmCreate}
          onCancel={handleCancelCreate}
        />
      )}

      {isEmpty && !creating && !isLoading && (
        <div className="flex flex-col items-start border-y border-border/60 px-2 py-5">
          <p className="ps-5 text-xs text-muted-foreground">
            {variant === "collection"
              ? "No resources in this collection yet"
              : "No files yet"}
          </p>
          {emptyStateAction && <div className="mt-4">{emptyStateAction}</div>}
        </div>
      )}
    </div>
  );
}
