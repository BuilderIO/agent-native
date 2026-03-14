import { useState, useRef, useCallback } from "react";
import {
  Upload,
  Trash2,
  X,
  Plus,
  ChevronLeft,
  Loader2,
  CheckSquare,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useProjectMedia,
  useBulkDeleteProjectMedia,
  type MediaFile,
} from "@/hooks/use-project-media";
import { useMediaUpload } from "@/hooks/use-media-upload";
import { useQueryClient } from "@tanstack/react-query";
import { MediaCard } from "./MediaCard";
import { MediaLightbox } from "./MediaLightbox";
import { BulkActionBar } from "./BulkActionBar";

interface ProjectMediaGridProps {
  projectSlug: string;
  onBack: () => void;
}

export function ProjectMediaGrid({ projectSlug, onBack }: ProjectMediaGridProps) {
  const { data, isLoading } = useProjectMedia(projectSlug);
  const bulkDelete = useBulkDeleteProjectMedia(projectSlug);
  const { upload, isUploading } = useMediaUpload(projectSlug);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [lightboxFile, setLightboxFile] = useState<string | null>(null);

  const files = data?.files ?? [];
  const isSelectMode = selectedFiles.size > 0;

  const toggleSelect = useCallback((filename: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(files.map((f) => f.filename)));
  }, [files]);

  const clearSelection = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const handleBulkDelete = useCallback(() => {
    const filenames = Array.from(selectedFiles);
    bulkDelete.mutate(filenames, {
      onSuccess: () => setSelectedFiles(new Set()),
    });
  }, [selectedFiles, bulkDelete]);

  const handleUploadFiles = useCallback(
    async (fileList: FileList) => {
      for (let i = 0; i < fileList.length; i++) {
        await upload(fileList[i]);
      }
      queryClient.invalidateQueries({ queryKey: ["project-media", projectSlug] });
    },
    [upload, queryClient, projectSlug]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) handleUploadFiles(e.dataTransfer.files);
    },
    [handleUploadFiles]
  );

  const handleCardClick = useCallback(
    (file: MediaFile) => {
      if (isSelectMode) {
        toggleSelect(file.filename);
      } else {
        setLightboxFile(file.filename);
      }
    },
    [isSelectMode, toggleSelect]
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-screen bg-background overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium truncate">Media</span>
          <span className="text-xs text-muted-foreground">
            {files.length} file{files.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {files.length > 0 && (
            <button
              onClick={isSelectMode ? clearSelection : selectAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-muted hover:bg-accent transition-colors"
            >
              {isSelectMode ? (
                <>
                  <X size={13} />
                  Deselect
                </>
              ) : (
                <>
                  <CheckSquare size={13} />
                  Select
                </>
              )}
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-muted hover:bg-accent transition-colors"
          >
            {isUploading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Plus size={13} />
            )}
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleUploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Bulk action bar */}
      {isSelectMode && (
        <BulkActionBar
          selectedCount={selectedFiles.size}
          totalCount={files.length}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onDelete={handleBulkDelete}
          isDeleting={bulkDelete.isPending}
        />
      )}

      {/* Grid */}
      <div
        className="flex-1 overflow-y-auto scrollbar-thin p-5"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="fixed inset-0 z-30 bg-primary/5 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none">
            <div className="text-sm font-medium text-primary">
              Drop files to upload
            </div>
          </div>
        )}

        {files.length === 0 ? (
          <EmptyMedia onAdd={() => fileInputRef.current?.click()} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {files.map((file) => (
              <MediaCard
                key={file.filename}
                file={file}
                isSelected={selectedFiles.has(file.filename)}
                isSelectMode={isSelectMode}
                onClick={() => handleCardClick(file)}
                onToggleSelect={() => toggleSelect(file.filename)}
                projectSlug={projectSlug}
              />
            ))}
            {/* Add card */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square rounded-lg border-2 border-dashed border-border hover:border-foreground/20 bg-muted/50 flex flex-col items-center justify-center gap-1.5 transition-colors"
            >
              <Upload size={18} className="text-muted-foreground/50" />
              <span className="text-[11px] text-muted-foreground">Upload</span>
            </button>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxFile && (
        <MediaLightbox
          filename={lightboxFile}
          files={files}
          projectSlug={projectSlug}
          onClose={() => setLightboxFile(null)}
        />
      )}
    </div>
  );
}

function EmptyMedia({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Upload size={32} className="text-muted-foreground/30 mb-3" />
      <p className="text-sm text-muted-foreground mb-1">No media yet</p>
      <p className="text-xs text-muted-foreground/60 mb-4">
        Drag & drop files or click to upload
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium bg-muted hover:bg-accent transition-colors"
      >
        <Plus size={13} />
        Upload Media
      </button>
    </div>
  );
}
