import { Trash2, Loader2, X, CheckSquare } from "lucide-react";

interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}

export function BulkActionBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  onDelete,
  isDeleting,
}: BulkActionBarProps) {
  const allSelected = selectedCount === totalCount;

  return (
    <div className="flex items-center justify-between px-5 py-2 bg-muted/50 border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-foreground">
          {selectedCount} selected
        </span>
        <button
          onClick={allSelected ? onClearSelection : onSelectAll}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onClearSelection}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={12} />
          Cancel
        </button>
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-red-600 hover:bg-red-600/10 dark:text-red-400 dark:hover:bg-red-400/10 transition-colors"
        >
          {isDeleting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Trash2 size={12} />
          )}
          Delete {selectedCount}
        </button>
      </div>
    </div>
  );
}
