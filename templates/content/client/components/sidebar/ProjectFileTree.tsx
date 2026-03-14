import { useState } from "react";
import { cn } from "@/lib/utils";
import type { FileNode } from "@shared/api";
import { useFileTree, useDeleteFile } from "@/hooks/use-projects";
import {
  FileText,
  FolderOpen,
  Folder,
  ChevronDown,
  Trash2,
  FilePlus,
  FolderPlus,
} from "lucide-react";
import { NewFileDialog } from "./NewFileDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ActiveFile {
  projectSlug: string;
  filePath: string;
}

interface ProjectFileTreeProps {
  projectSlug: string;
  activeFile: ActiveFile | null;
  onSelectFile: (filePath: string) => void;
  onDeleteFile: (filePath: string) => void;
}

export function ProjectFileTree({
  projectSlug,
  activeFile,
  onSelectFile,
  onDeleteFile,
}: ProjectFileTreeProps) {
  const { data, isLoading } = useFileTree(projectSlug);
  const deleteMutation = useDeleteFile();
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileParent, setNewFileParent] = useState<string | undefined>();
  const [newFileType, setNewFileType] = useState<"file" | "directory">("file");

  const handleDelete = (filePath: string) => {
    deleteMutation.mutate(
      { projectSlug, filePath },
      { onSuccess: () => onDeleteFile(filePath) }
    );
  };

  const openNewFileDialog = (parentPath?: string, type: "file" | "directory" = "file") => {
    setNewFileParent(parentPath);
    setNewFileType(type);
    setShowNewFile(true);
  };

  if (isLoading) {
    return (
      <div className="px-4 py-3 text-xs text-sidebar-muted">Loading...</div>
    );
  }

  const tree = data?.tree || [];

  return (
    <div className="py-1">
      {/* Header with actions */}
      <div className="flex items-center justify-between px-4 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
          Documents
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => openNewFileDialog(undefined, "file")}
                className="p-1 rounded text-sidebar-muted hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
              >
                <FilePlus size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">New document</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => openNewFileDialog(undefined, "directory")}
                className="p-1 rounded text-sidebar-muted hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
              >
                <FolderPlus size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">New folder</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Tree nodes */}
      <div className="px-1">
        {tree.length === 0 ? (
          <div className="px-3 py-2 text-xs text-sidebar-muted">
            No documents yet
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              activeFile={activeFile}
              projectSlug={projectSlug}
              onSelectFile={onSelectFile}
              onDelete={handleDelete}
              onNewFile={openNewFileDialog}
            />
          ))
        )}
      </div>

      <NewFileDialog
        open={showNewFile}
        onOpenChange={setShowNewFile}
        projectSlug={projectSlug}
        parentPath={newFileParent}
        type={newFileType}
        onCreated={(filePath) => {
          setShowNewFile(false);
          if (newFileType === "file") {
            onSelectFile(filePath);
          }
        }}
      />
    </div>
  );
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  activeFile: ActiveFile | null;
  projectSlug: string;
  onSelectFile: (filePath: string) => void;
  onDelete: (filePath: string) => void;
  onNewFile: (parentPath?: string, type?: "file" | "directory") => void;
}

function TreeNode({
  node,
  depth,
  activeFile,
  projectSlug,
  onSelectFile,
  onDelete,
  onNewFile,
}: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth === 0);
  const isActive =
    activeFile?.projectSlug === projectSlug &&
    activeFile?.filePath === node.path;
  const isDir = node.type === "directory";
  const paddingLeft = 12 + depth * 16;

  if (isDir) {
    return (
      <div>
        <div
          className="flex items-center gap-1 pr-1 group overflow-hidden"
          style={{ paddingLeft }}
        >
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 py-1.5 text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors flex-1 min-w-0 overflow-hidden"
          >
            <ChevronDown
              size={12}
              className={cn(
                "shrink-0 transition-transform duration-150",
                !isExpanded && "-rotate-90"
              )}
            />
            {isExpanded ? (
              <FolderOpen size={14} className="text-sidebar-primary shrink-0" />
            ) : (
              <Folder size={14} className="text-sidebar-primary shrink-0" />
            )}
            <span className="text-sm truncate">{node.name}</span>
          </button>
          <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onNewFile(node.path, "file")}
                  className="p-0.5 rounded text-sidebar-muted hover:text-sidebar-accent-foreground transition-colors"
                >
                  <FilePlus size={12} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">New document</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onDelete(node.path)}
                  className="p-0.5 rounded text-sidebar-muted hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                activeFile={activeFile}
                projectSlug={projectSlug}
                onSelectFile={onSelectFile}
                onDelete={onDelete}
                onNewFile={onNewFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onSelectFile(node.path);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onSelectFile(node.path);
        }
      }}
      className={cn(
        "w-full flex items-center gap-1 pr-1 py-1.5 rounded-sm text-left group transition-colors overflow-hidden cursor-pointer",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60"
      )}
      style={{ paddingLeft: paddingLeft + 14 }}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
        <FileText size={14} className="text-sidebar-muted shrink-0" />
        <span className="text-sm truncate">{node.title || node.name}</span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(node.path);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onDelete(node.path);
              }
            }}
            className="p-0.5 rounded text-sidebar-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
          >
            <Trash2 size={12} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">Delete</TooltipContent>
      </Tooltip>
    </div>
  );
}
