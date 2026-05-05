import { useState, useRef } from "react";
import {
  IconChevronRight,
  IconFolder,
  IconFolderOpen,
  IconPencil,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CompositionCard } from "@/components/CompositionCard";
import type { CompositionEntry } from "@/remotion/registry";
import type { VideoFolder } from "@/hooks/use-folders";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type LibraryFolderRowProps = {
  folder: VideoFolder;
  compositions: CompositionEntry[];
  selectedCompositionId: string | null;
  onSelectComposition: (id: string) => void;
  onDelete?: (id: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onDropComposition: (compositionId: string, folderId: string) => void;
  onRemoveFromFolder: (compositionId: string) => void;
};

export function LibraryFolderRow({
  folder,
  compositions,
  selectedCompositionId,
  onSelectComposition,
  onDelete,
  onRenameFolder,
  onDeleteFolder,
  onDropComposition,
  onRemoveFromFolder,
}: LibraryFolderRowProps) {
  const [expanded, setExpanded] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Auto-expand if a child composition is currently selected
  const hasSelectedChild = compositions.some(
    (c) => c.id === selectedCompositionId,
  );
  const isExpanded = expanded || hasSelectedChild;

  const handleRenameStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(folder.name);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const handleRenameCommit = () => {
    if (renameValue.trim()) {
      onRenameFolder(folder.id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleRenameCommit();
    if (e.key === "Escape") {
      setRenameValue(folder.name);
      setIsRenaming(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the folder container itself
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const compositionId = e.dataTransfer.getData("text/composition-id");
    if (compositionId) {
      onDropComposition(compositionId, folder.id);
      setExpanded(true);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg transition-all",
        isDragOver && "ring-2 ring-primary/50 bg-primary/5",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Folder header */}
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors select-none",
          "hover:bg-secondary/60",
          isDragOver && "bg-primary/10",
        )}
        onClick={() => !isRenaming && setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isRenaming) {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <IconChevronRight
          className={cn(
            "h-3 w-3 flex-shrink-0 text-muted-foreground transition-transform",
            isExpanded && "rotate-90",
          )}
        />

        {isExpanded ? (
          <IconFolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
        ) : (
          <IconFolder className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
        )}

        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 text-xs bg-background border border-primary/50 rounded px-1 py-0 outline-none"
            autoFocus
          />
        ) : (
          <span className="flex-1 min-w-0 text-xs font-medium truncate">
            {folder.name}
          </span>
        )}

        <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 tabular-nums">
          {compositions.length}
        </span>

        {showActions && !isRenaming && (
          <div
            className="flex items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleRenameStart}
                  className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                >
                  <IconPencil className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Rename folder</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onDeleteFolder(folder.id)}
                  className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <IconTrash className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete folder</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Folder contents */}
      {isExpanded && (
        <div className="ml-4 mt-0.5 pb-0.5 space-y-0.5">
          {compositions.length === 0 ? (
            <div className="text-[10px] text-muted-foreground/40 px-2 py-2 italic">
              Drag videos here
            </div>
          ) : (
            compositions.map((comp) => (
              <div key={comp.id} className="relative group/item">
                <CompositionCard
                  composition={comp}
                  isSelected={comp.id === selectedCompositionId}
                  onClick={() => onSelectComposition(comp.id)}
                  onDelete={onDelete}
                  draggable
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onRemoveFromFolder(comp.id)}
                      className="absolute top-1 right-7 p-0.5 rounded opacity-0 group-hover/item:opacity-100 bg-secondary/80 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                    >
                      <IconX className="h-2.5 w-2.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Remove from folder</TooltipContent>
                </Tooltip>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
