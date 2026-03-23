import { useState } from "react";
import { Folder, ChevronLeft, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useImageFolders } from "@/hooks/use-image-folders";
import type { ImageFolder } from "@shared/api";

interface FolderBrowserProps {
  selectedPaths: string[];
  onTogglePath: (path: string) => void;
}

export function FolderBrowser({
  selectedPaths,
  onTogglePath,
}: FolderBrowserProps) {
  const { data, isLoading } = useImageFolders();
  const [openFolder, setOpenFolder] = useState<ImageFolder | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-xs">Loading folders...</span>
      </div>
    );
  }

  const folders = data?.folders ?? [];

  if (folders.length === 0) {
    return (
      <div className="text-center py-6 text-xs text-muted-foreground">
        <p>No image reference folders found.</p>
        <p className="mt-1 text-[11px]">
          Add folders to{" "}
          <code className="bg-muted px-1 rounded">
            shared-resources/image-references/
          </code>
        </p>
      </div>
    );
  }

  if (openFolder) {
    const folderSelectedCount = openFolder.images.filter((img) =>
      selectedPaths.includes(img.path),
    ).length;

    return (
      <div className="space-y-2">
        <button
          onClick={() => setOpenFolder(null)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          Back to folders
        </button>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">
            {openFolder.name}{" "}
            <span className="text-muted-foreground">
              ({folderSelectedCount}/{openFolder.images.length} selected)
            </span>
          </span>
          <button
            onClick={() => {
              const allSelected = openFolder.images.every((img) =>
                selectedPaths.includes(img.path),
              );
              for (const img of openFolder.images) {
                if (allSelected && selectedPaths.includes(img.path)) {
                  onTogglePath(img.path);
                } else if (!allSelected && !selectedPaths.includes(img.path)) {
                  onTogglePath(img.path);
                }
              }
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {openFolder.images.every((img) => selectedPaths.includes(img.path))
              ? "Deselect all"
              : "Select all"}
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
          {openFolder.images.map((img) => {
            const isSelected = selectedPaths.includes(img.path);
            return (
              <button
                key={img.path}
                onClick={() => onTogglePath(img.path)}
                className={cn(
                  "relative rounded-md overflow-hidden border-2 transition-colors shrink-0 w-24 h-24",
                  isSelected
                    ? "border-primary"
                    : "border-transparent hover:border-border",
                )}
              >
                <img
                  src={`/api/shared/asset?path=${encodeURIComponent(img.path)}`}
                  alt={img.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {isSelected && (
                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Check size={12} className="text-primary-foreground" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
      {folders.map((folder) => {
        const selectedInFolder = folder.images.filter((img) =>
          selectedPaths.includes(img.path),
        ).length;
        return (
          <button
            key={folder.path}
            onClick={() => setOpenFolder(folder)}
            className={cn(
              "rounded-lg border transition-colors overflow-hidden text-left shrink-0 w-36",
              selectedInFolder > 0
                ? "border-primary/50"
                : "border-border hover:border-foreground/20",
            )}
          >
            {folder.thumbnailPath && (
              <div className="h-20 bg-muted relative">
                <img
                  src={`/api/shared/asset?path=${encodeURIComponent(folder.thumbnailPath)}`}
                  alt={folder.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {selectedInFolder > 0 && (
                  <div className="absolute top-1 right-1 min-w-[20px] h-5 px-1 rounded-full bg-primary flex items-center justify-center">
                    <span className="text-[10px] font-bold text-primary-foreground">
                      {selectedInFolder}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-1">
                <Folder size={11} className="text-muted-foreground shrink-0" />
                <span className="text-[11px] font-medium truncate">
                  {folder.name}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {folder.imageCount} image{folder.imageCount !== 1 ? "s" : ""}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
