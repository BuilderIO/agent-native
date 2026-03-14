import { useState, useRef, useCallback } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { Upload, Trash2, X, Plus, ChevronLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useImageFolders } from "@/hooks/use-image-folders";
import { useQueryClient } from "@tanstack/react-query";

interface ImageFolderGridProps {
  /** e.g. "image-references/diagrams" */
  folderPath: string;
  onBack: () => void;
}

export function ImageFolderGrid({ folderPath, onBack }: ImageFolderGridProps) {
  const { data, isLoading } = useImageFolders();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const folderName = folderPath.split("/").pop() || folderPath;
  const folder = data?.folders.find((f) => f.path === folderPath);
  const images = folder?.images ?? [];

  const handleUpload = useCallback(
    async (files: FileList) => {
      if (!files.length) return;
      setUploading(true);
      try {
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
          if (files[i].type.startsWith("image/")) {
            formData.append("files", files[i]);
          }
        }
        const res = await authFetch(
          `/api/shared/image-upload?folder=${encodeURIComponent(folderPath)}`,
          { method: "POST", body: formData }
        );
        if (!res.ok) throw new Error("Upload failed");
        queryClient.invalidateQueries({ queryKey: ["image-folders"] });
        queryClient.invalidateQueries({ queryKey: ["shared-tree"] });
      } catch (e) {
        console.error("Upload error:", e);
      } finally {
        setUploading(false);
      }
    },
    [folderPath, queryClient]
  );

  const handleDelete = useCallback(
    async (imgPath: string) => {
      setDeleting(imgPath);
      try {
        const res = await authFetch(
          `/api/shared/image?path=${encodeURIComponent(imgPath)}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error("Delete failed");
        if (selectedImage === imgPath) setSelectedImage(null);
        queryClient.invalidateQueries({ queryKey: ["image-folders"] });
        queryClient.invalidateQueries({ queryKey: ["shared-tree"] });
      } catch (e) {
        console.error("Delete error:", e);
      } finally {
        setDeleting(null);
      }
    },
    [queryClient, selectedImage]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
    },
    [handleUpload]
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
          <span className="text-sm font-medium truncate">{folderName}</span>
          <span className="text-xs text-muted-foreground">
            {images.length} image{images.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-muted hover:bg-accent transition-colors"
        >
          {uploading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} />
          )}
          Add Images
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Grid + lightbox */}
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
              Drop images to upload
            </div>
          </div>
        )}

        {images.length === 0 ? (
          <EmptyFolder onAdd={() => fileInputRef.current?.click()} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {images.map((img) => (
              <ImageCard
                key={img.path}
                image={img}
                isDeleting={deleting === img.path}
                onDelete={() => handleDelete(img.path)}
                onClick={() => setSelectedImage(img.path)}
              />
            ))}
            {/* Add card */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square rounded-lg border-2 border-dashed border-border hover:border-foreground/20 bg-muted/50 flex flex-col items-center justify-center gap-1.5 transition-colors"
            >
              <Upload size={18} className="text-muted-foreground/50" />
              <span className="text-[11px] text-muted-foreground">Add</span>
            </button>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {selectedImage && (
        <Lightbox
          imagePath={selectedImage}
          onClose={() => setSelectedImage(null)}
          onDelete={() => {
            handleDelete(selectedImage);
            setSelectedImage(null);
          }}
        />
      )}
    </div>
  );
}

function ImageCard({
  image,
  isDeleting,
  onDelete,
  onClick,
}: {
  image: { name: string; path: string };
  isDeleting: boolean;
  onDelete: () => void;
  onClick: () => void;
}) {
  return (
    <div
      className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted cursor-pointer"
      onClick={onClick}
    >
      <img
        src={`/api/shared/asset?path=${encodeURIComponent(image.path)}`}
        alt={image.name}
        className="w-full h-full object-cover"
        loading="lazy"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-[10px] text-white truncate">{image.name}</p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={isDeleting}
        className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white/80 hover:text-white hover:bg-red-600/80 opacity-0 group-hover:opacity-100 transition-all"
      >
        {isDeleting ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Trash2 size={12} />
        )}
      </button>
    </div>
  );
}

function EmptyFolder({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Upload size={32} className="text-muted-foreground/30 mb-3" />
      <p className="text-sm text-muted-foreground mb-1">No images yet</p>
      <p className="text-xs text-muted-foreground/60 mb-4">
        Drag & drop images or click to add
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium bg-muted hover:bg-accent transition-colors"
      >
        <Plus size={13} />
        Add Images
      </button>
    </div>
  );
}

function Lightbox({
  imagePath,
  onClose,
  onDelete,
}: {
  imagePath: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  const fileName = imagePath.split("/").pop() || imagePath;
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center" onClick={onClose}>
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-2 rounded-md bg-white/10 text-white/80 hover:bg-red-600/80 hover:text-white transition-colors"
          title="Delete"
        >
          <Trash2 size={16} />
        </button>
        <button
          onClick={onClose}
          className="p-2 rounded-md bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>
      <img
        src={`/api/shared/asset?path=${encodeURIComponent(imagePath)}`}
        alt={fileName}
        className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/60">
        {fileName}
      </p>
    </div>
  );
}
