import React, { useState, useRef, useCallback } from "react";
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
  IconMessageChatbot,
  IconPlugConnected,
  IconBulb,
  IconClockHour3,
  IconLoader2,
} from "@tabler/icons-react";
import { cn } from "../utils.js";
import type { TreeNode, ResourceMeta, JobMetadata } from "./use-resources.js";
import type { McpServer } from "./use-mcp-servers.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";

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
      <IconMessageChatbot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    );
  }
  if (node.kind === "remote-agent" || node.kind === "mcp-server") {
    return (
      <IconPlugConnected className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
}

interface CreatingState {
  parentPath: string;
  type: "file" | "folder";
}

function McpStatusDot({ server }: { server: McpServer }) {
  if (server.status.state === "connected") {
    return (
      <StatusDot
        className="rounded-full bg-green-500"
        tooltip={`Connected — ${server.status.toolCount} tool${server.status.toolCount === 1 ? "" : "s"}`}
      />
    );
  }
  if (server.status.state === "error") {
    return (
      <StatusDot
        className="rounded-full bg-red-500"
        tooltip={`Error: ${server.status.error}`}
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
        {!readOnly && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100">
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
                          onDelete(node.resource!.id);
                        }}
                        aria-label="Delete"
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent/50"
                      >
                        <IconTrash className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Delete</TooltipContent>
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
}: ResourceTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [dragOver, setDragOver] = useState(false);

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
          {titleTooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
                  {title}
                  {headingHint && (
                    <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground/50">
                      {headingHint}
                    </span>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent>{titleTooltip}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
              {title}
              {headingHint && (
                <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground/50">
                  {headingHint}
                </span>
              )}
            </span>
          )}
          {!readOnly && (
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
          )}
        </TooltipProvider>
      </div>

      {tree.map((node) => (
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

      {isLoading && tree.length === 0 && (
        <div className="px-1 py-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-1.5 py-1">
              <div
                className="h-3.5 w-3.5 rounded bg-muted-foreground/10 animate-pulse"
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

      {tree.length === 0 && !creating && !isLoading && (
        <div className="px-2 py-1">
          <p className="text-[11px] text-muted-foreground/40">No files yet</p>
        </div>
      )}
    </div>
  );
}
