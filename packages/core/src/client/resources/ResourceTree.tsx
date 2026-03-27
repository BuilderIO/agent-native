import React, { useState, useRef, useCallback } from "react";
import { cn } from "../utils.js";
import type { TreeNode, ResourceMeta } from "./use-resources.js";

// ─── Icons ──────────────────────────────────────────────────────────────────

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function FileTextIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

function FileCodeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="m10 13-2 2 2 2" />
      <path d="m14 17 2-2-2-2" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getFileIcon(name: string): React.ReactNode {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const iconClass = "h-3.5 w-3.5 shrink-0 text-muted-foreground";
  if (ext === "md" || ext === "mdx")
    return <FileTextIcon className={iconClass} />;
  if (
    ["ts", "tsx", "js", "jsx", "json", "css", "html", "py", "sh"].includes(ext)
  )
    return <FileCodeIcon className={iconClass} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext))
    return <ImageIcon className={iconClass} />;
  return <FileIcon className={iconClass} />;
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
}

interface CreatingState {
  parentPath: string;
  type: "file" | "folder";
}

// ─── TreeNodeRow ────────────────────────────────────────────────────────────

function TreeNodeRow({
  node,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
  onDelete,
  onStartCreate,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selectedId: string | null;
  onToggle: (path: string) => void;
  onSelect: (resource: ResourceMeta) => void;
  onDelete: (id: string) => void;
  onStartCreate: (parentPath: string, type: "file" | "folder") => void;
}) {
  const isFolder = node.type === "folder";
  const isExpanded = expanded.has(node.path);
  const isSelected = node.resource?.id === selectedId;

  return (
    <div>
      <div
        className={cn(
          "group/row flex items-center gap-1 rounded-md px-1.5 py-1 cursor-pointer select-none",
          isSelected
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
        style={{ paddingLeft: depth * 16 + 6 }}
        onClick={() => {
          if (isFolder) {
            onToggle(node.path);
          } else if (node.resource) {
            onSelect(node.resource);
          }
        }}
      >
        {isFolder ? (
          isExpanded ? (
            <ChevronDownIcon className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRightIcon className="h-3 w-3 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isFolder ? (
          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          getFileIcon(node.name)
        )}
        <span className="min-w-0 truncate text-[12px] leading-none">
          {node.name}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100">
          {isFolder && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartCreate(node.path, "file");
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
              title="New file"
            >
              <PlusIcon className="h-3 w-3" />
            </button>
          )}
          {node.resource && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(node.resource!.id);
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent/50"
              title="Delete"
            >
              <TrashIcon className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {isFolder && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
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
      <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
      if (e.dataTransfer.files.length > 0) {
        onDrop(e.dataTransfer.files);
      }
    },
    [onDrop],
  );

  return (
    <div
      className={cn(
        "flex-1 min-h-0 overflow-y-auto p-1",
        dragOver && "ring-1 ring-inset ring-accent",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Root-level add button */}
      <div className="group/root flex items-center justify-between px-1.5 py-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
          Files
        </span>
        <button
          onClick={() => handleStartCreate("", "file")}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 opacity-0 group-hover/root:opacity-100 hover:text-foreground hover:bg-accent/50"
          title="New file"
        >
          <PlusIcon className="h-3 w-3" />
        </button>
      </div>

      {tree.map((node) => (
        <TreeNodeRow
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          selectedId={selectedId}
          onToggle={toggleExpand}
          onSelect={onSelect}
          onDelete={onDelete}
          onStartCreate={handleStartCreate}
        />
      ))}

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

      {tree.length === 0 && !creating && (
        <div
          className="flex flex-col items-center gap-2 text-muted-foreground/50"
          style={{ paddingTop: "5vh" }}
        >
          <FileIcon className="h-8 w-8" />
          <p className="text-[12px]">No resources yet</p>
          <p className="text-[11px]">Drop files here or click + to create</p>
        </div>
      )}
    </div>
  );
}
