import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useUploadAsset } from "@/hooks/use-brand";
import type { AssetCategory } from "@shared/types";

interface AssetUploaderProps {
  category: AssetCategory;
  accept: string;
}

export function AssetUploader({ category, accept }: AssetUploaderProps) {
  const uploadAsset = useUploadAsset();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      Array.from(files).forEach((file) => {
        uploadAsset.mutate({ file, category });
      });
    },
    [category, uploadAsset]
  );

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors ${
        dragging
          ? "border-ring bg-accent/50"
          : "border-border hover:border-muted-foreground"
      }`}
    >
      <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
      {uploadAsset.isPending ? (
        <p className="text-sm text-muted-foreground">Uploading...</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Drop files here or click to browse
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
    </div>
  );
}
