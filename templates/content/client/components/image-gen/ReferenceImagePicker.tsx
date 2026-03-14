import { useState, useCallback, useRef } from "react";
import { Upload, FolderOpen, X, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { FolderBrowser } from "./FolderBrowser";

interface ReferenceImagePickerProps {
  uploadedImages: string[];
  onUploadedImagesChange: (images: string[]) => void;
  folderPaths: string[];
  onFolderPathsChange: (paths: string[]) => void;
}

type Mode = "upload" | "folder";

export function ReferenceImagePicker({
  uploadedImages,
  onUploadedImagesChange,
  folderPaths,
  onFolderPathsChange,
}: ReferenceImagePickerProps) {
  const [mode, setMode] = useLocalStorage<Mode>("image-gen:ref-mode", "upload");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList) => {
      const newImages: string[] = [];
      let processed = 0;
      const total = Math.min(files.length, 10 - uploadedImages.length);

      if (total <= 0) return;

      for (let i = 0; i < total; i++) {
        const file = files[i];
        if (!file.type.startsWith("image/")) continue;
        const reader = new FileReader();
        reader.onload = (e) => {
          newImages.push(e.target?.result as string);
          processed++;
          if (processed === total) {
            onUploadedImagesChange([...uploadedImages, ...newImages]);
          }
        };
        reader.readAsDataURL(file);
      }
    },
    [uploadedImages, onUploadedImagesChange],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const removeUploaded = (index: number) => {
    onUploadedImagesChange(uploadedImages.filter((_, i) => i !== index));
  };

  const toggleFolderPath = (path: string) => {
    if (folderPaths.includes(path)) {
      onFolderPathsChange(folderPaths.filter((p) => p !== path));
    } else {
      onFolderPathsChange([...folderPaths, path]);
    }
  };

  const totalRefs = uploadedImages.length + folderPaths.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon size={13} className="text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            Reference Images
          </span>
          {totalRefs > 0 && (
            <>
              <span className="text-[11px] text-primary font-medium">
                ({totalRefs} selected)
              </span>
              <button
                onClick={() => onFolderPathsChange([])}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                clear
              </button>
            </>
          )}
        </div>
        <div className="flex rounded-md border border-border overflow-hidden bg-muted">
          <button
            onClick={() => setMode("upload")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors",
              mode === "upload"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Upload size={10} />
            Upload
          </button>
          <button
            onClick={() => setMode("folder")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors border-l border-border",
              mode === "folder"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <FolderOpen size={10} />
            Folders
          </button>
        </div>
      </div>

      {mode === "upload" ? (
        <div className="space-y-2">
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors bg-muted",
              isDragging
                ? "border-primary bg-primary/10"
                : "border-border hover:border-foreground/20",
            )}
          >
            <Upload
              size={20}
              className="mx-auto mb-1.5 text-muted-foreground/50"
            />
            <p className="text-xs text-muted-foreground">
              Drop images here or click to upload
            </p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              PNG, JPG, WebP (max 10)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {/* Uploaded previews */}
          {uploadedImages.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {uploadedImages.map((img, i) => (
                <div
                  key={i}
                  className="relative group rounded-md overflow-hidden aspect-square border border-border"
                >
                  <img
                    src={img}
                    alt={`Reference ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeUploaded(i);
                    }}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-background/80 text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <FolderBrowser
          selectedPaths={folderPaths}
          onTogglePath={toggleFolderPath}
        />
      )}
    </div>
  );
}
