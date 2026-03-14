import { useState } from "react";
import { X, Loader2, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProjectMedia, type MediaFile } from "@/hooks/use-project-media";

interface AssetLibraryPickerProps {
  projectSlug: string;
  onSelect: (url: string) => void;
  onClose: () => void;
}

export function AssetLibraryPicker({
  projectSlug,
  onSelect,
  onClose,
}: AssetLibraryPickerProps) {
  const { data, isLoading } = useProjectMedia(projectSlug);
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);

  const imageFiles = (data?.files ?? []).filter((f) => f.type === "image");

  return (
    <div className="border border-border rounded-lg bg-background">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-xs font-medium text-foreground">
          Choose from library
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-4 pb-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : imageFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ImageIcon
              size={24}
              className="text-muted-foreground/30 mb-2"
            />
            <p className="text-xs text-muted-foreground">
              No images in this project yet
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[280px] overflow-y-auto scrollbar-thin">
            {imageFiles.map((file) => (
              <AssetThumb
                key={file.filename}
                file={file}
                isHovered={hoveredFile === file.filename}
                onHover={() => setHoveredFile(file.filename)}
                onLeave={() => setHoveredFile(null)}
                onSelect={() => onSelect(file.url)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetThumb({
  file,
  isHovered,
  onHover,
  onLeave,
  onSelect,
}: {
  file: MediaFile;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={cn(
        "relative aspect-square rounded-md overflow-hidden border bg-muted cursor-pointer transition-all",
        isHovered
          ? "border-primary ring-2 ring-primary/30"
          : "border-border hover:border-foreground/20"
      )}
    >
      <img
        src={file.url}
        alt={file.filename}
        className="w-full h-full object-cover"
        loading="lazy"
      />
      {isHovered && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
          <p className="text-[9px] text-white truncate">{file.filename}</p>
        </div>
      )}
    </button>
  );
}
