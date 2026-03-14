import { Trash2, Loader2, Check, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeleteProjectMedia, type MediaFile } from "@/hooks/use-project-media";
import { toast } from "sonner";

interface MediaCardProps {
  file: MediaFile;
  isSelected: boolean;
  isSelectMode: boolean;
  onClick: () => void;
  onToggleSelect: () => void;
  projectSlug: string;
}

export function MediaCard({
  file,
  isSelected,
  isSelectMode,
  onClick,
  onToggleSelect,
  projectSlug,
}: MediaCardProps) {
  const deleteMutation = useDeleteProjectMedia(projectSlug);
  const isDeleting = deleteMutation.isPending;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteMutation.mutate(file.filename);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.filename;
    a.click();
    toast.success(`Downloading ${file.filename}`);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelect();
  };

  return (
    <div
      className={cn(
        "group relative aspect-square rounded-lg overflow-hidden border bg-muted cursor-pointer transition-all",
        isSelected
          ? "border-primary ring-2 ring-primary/30"
          : "border-border hover:border-foreground/20"
      )}
      onClick={onClick}
    >
      {file.type === "video" ? (
        <video
          src={file.url}
          className="w-full h-full object-cover"
          muted
          preload="metadata"
        />
      ) : (
        <img
          src={file.url}
          alt={file.filename}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}

      {/* Filename overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-[10px] text-white truncate">{file.filename}</p>
        <p className="text-[9px] text-white/60">{formatSize(file.size)}</p>
      </div>

      {/* Select checkbox */}
      {(isSelectMode || isSelected) && (
        <button
          onClick={handleCheckboxClick}
          className={cn(
            "absolute top-1.5 left-1.5 w-5 h-5 rounded flex items-center justify-center transition-all z-10",
            isSelected
              ? "bg-primary text-primary-foreground"
              : "bg-black/40 text-white/70 hover:bg-black/60"
          )}
        >
          {isSelected && <Check size={12} strokeWidth={3} />}
        </button>
      )}

      {/* Download and Delete buttons (only when not in select mode) */}
      {!isSelectMode && (
        <>
          <button
            onClick={handleDownload}
            className="absolute top-1.5 right-8 p-1 rounded-md bg-black/50 text-white/80 hover:text-white hover:bg-blue-600/80 opacity-0 group-hover:opacity-100 transition-all"
            title="Download"
          >
            <Download size={12} />
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white/80 hover:text-white hover:bg-red-600/80 opacity-0 group-hover:opacity-100 transition-all"
            title="Delete"
          >
            {isDeleting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Trash2 size={12} />
            )}
          </button>
        </>
      )}

      {/* Video badge */}
      {file.type === "video" && (
        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-black/50 text-white/80">
          VIDEO
        </span>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
