import { useState } from "react";
import { cn } from "@/lib/utils";
import type { FileNode } from "@shared/api";
import {
  useFileTree,
  useDeleteFile,
  workspaceSharedSlug,
} from "@/hooks/use-projects";
import {
  FileText,
  FolderOpen,
  Folder,
  ChevronDown,
  Trash2,
  FilePlus,
  ImageIcon,
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

interface WorkspaceResourceTreeProps {
  workspace: string;
  activeFile: ActiveFile | null;
  onSelectFile: (filePath: string) => void;
  onDeleteFile: (filePath: string) => void;
}

export function WorkspaceResourceTree({
  workspace,
  activeFile,
  onSelectFile,
  onDeleteFile,
}: WorkspaceResourceTreeProps) {
  const slug = workspaceSharedSlug(workspace);
  const { data, isLoading } = useFileTree(slug);
  const deleteMutation = useDeleteFile();
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileParent, setNewFileParent] = useState<string | undefined>();
  const [newFileType, setNewFileType] = useState<"file" | "directory">("file");

  const handleDelete = (filePath: string) => {
    deleteMutation.mutate(
      { projectSlug: slug, filePath },
      { onSuccess: () => onDeleteFile(filePath) },
    );
  };

  const openNewFileDialog = (
    parentPath?: string,
    type: "file" | "directory" = "file",
  ) => {
    setNewFileParent(parentPath);
    setNewFileType(type);
    setShowNewFile(true);
  };

  if (isLoading) {
    return (
      <div className="px-4 py-2 text-xs text-sidebar-muted">Loading...</div>
    );
  }

  const tree = data?.tree || [];

  return (
    <div className="py-0.5">
      <div className="px-1">
        {tree.length === 0 ? (
          <button
            onClick={() => openNewFileDialog(undefined, "file")}
            className="w-full px-3 py-1.5 text-xs text-sidebar-muted hover:text-sidebar-foreground transition-colors text-left"
          >
            No workspace resources yet. Click to create one.
          </button>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              slug={slug}
              activeFile={activeFile}
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
        projectSlug={slug}
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

function TreeNode({
  node,
  depth,
  slug,
  activeFile,
  onSelectFile,
  onDelete,
  onNewFile,
}: {
  node: FileNode;
  depth: number;
  slug: string;
  activeFile: ActiveFile | null;
  onSelectFile: (filePath: string) => void;
  onDelete: (filePath: string) => void;
  onNewFile: (parentPath?: string, type?: "file" | "directory") => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isActive =
    activeFile?.projectSlug === slug && activeFile?.filePath === node.path;
  const isDir = node.type === "directory";
  const paddingLeft = 12 + depth * 16;

  if (isDir) {
    return (
      <div>
        <div
          className="flex items-center gap-1 pr-1 group overflow-hidden rounded-sm"
          style={{ paddingLeft }}
        >
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 py-1 text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors flex-1 min-w-0 overflow-hidden"
          >
            <ChevronDown
              size={11}
              className={cn(
                "shrink-0 transition-transform duration-150",
                !isExpanded && "-rotate-90",
              )}
            />
            {isExpanded ? (
              <FolderOpen size={13} className="text-sidebar-primary shrink-0" />
            ) : (
              <Folder size={13} className="text-sidebar-primary shrink-0" />
            )}
            <span className="text-[13px] truncate">{node.name}</span>
          </button>
          <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onNewFile(node.path, "file")}
                  className="p-0.5 rounded text-sidebar-muted hover:text-sidebar-accent-foreground transition-colors"
                >
                  <FilePlus size={11} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                New file
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onDelete(node.path)}
                  className="p-0.5 rounded text-sidebar-muted hover:text-red-400 transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Delete
              </TooltipContent>
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
                slug={slug}
                activeFile={activeFile}
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
        "w-full flex items-center gap-1 pr-1 py-1 rounded-sm text-left group transition-colors overflow-hidden cursor-pointer",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60",
      )}
      style={{ paddingLeft: paddingLeft + 14 }}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
        {node.isImage ? (
          <ImageIcon size={13} className="text-emerald-400 shrink-0" />
        ) : (
          <FileText size={13} className="text-sidebar-muted shrink-0" />
        )}
        <span className="text-[13px] truncate">{node.title || node.name}</span>
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
            <Trash2 size={11} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Delete
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
