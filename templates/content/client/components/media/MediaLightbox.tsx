import { useState, useRef, useCallback, useEffect } from "react";
import { X, Trash2, RefreshCw, Upload, ChevronDown, Loader2, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeleteProjectMedia, type MediaFile } from "@/hooks/use-project-media";
import { useMediaUpload } from "@/hooks/use-media-upload";
import { useQueryClient } from "@tanstack/react-query";
import { RegeneratePanel } from "./RegeneratePanel";
import { downloadMediaAsset } from "@/lib/media-download";

interface MediaLightboxProps {
  filename: string;
  files: MediaFile[];
  projectSlug: string;
  onClose: () => void;
}

export function MediaLightbox({ filename, files, projectSlug, onClose }: MediaLightboxProps) {
  // Find initial index
  const initialIndex = files.findIndex((f) => f.filename === filename);
  const [currentIndex, setCurrentIndex] = useState(initialIndex !== -1 ? initialIndex : 0);
  const deleteMutation = useDeleteProjectMedia(projectSlug);
  const { upload } = useMediaUpload(projectSlug);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showReplaceMenu, setShowReplaceMenu] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Get current file info
  const currentFile = files[currentIndex];
  const currentFilename = currentFile?.filename || filename;
  const url = currentFile?.url || `/api/projects/${projectSlug}/media/${currentFilename}`;
  const isVideo = /\.(mp4|webm|mov)$/i.test(currentFilename) || currentFile?.type === "video";

  // Navigation functions
  const navigatePrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + files.length) % files.length);
  }, [files.length]);

  const navigateNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % files.length);
  }, [files.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigatePrevious();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigatePrevious, navigateNext]);

  const handleDelete = () => {
    deleteMutation.mutate(currentFilename, { onSuccess: onClose });
  };

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDownloading) return;

    setIsDownloading(true);
    try {
      await downloadMediaAsset({
        url,
        filename: currentFilename,
      });
    } finally {
      setIsDownloading(false);
    }
  }, [currentFilename, isDownloading, url]);

  const handleUploadReplace = useCallback(
    async (file: File) => {
      // Delete old, upload new
      deleteMutation.mutate(currentFilename, {
        onSuccess: async () => {
          await upload(file);
          queryClient.invalidateQueries({ queryKey: ["project-media", projectSlug] });
          onClose();
        },
      });
    },
    [deleteMutation, currentFilename, upload, queryClient, projectSlug, onClose]
  );

  const handleRegenerated = useCallback(() => {
    // Delete the old file, then close
    deleteMutation.mutate(currentFilename, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["project-media", projectSlug] });
        onClose();
      },
    });
  }, [deleteMutation, currentFilename, queryClient, projectSlug, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Top bar actions */}
      <div className="absolute top-4 right-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {/* Replace dropdown */}
        {!isVideo && (
          <div className="relative">
            <button
              onClick={() => setShowReplaceMenu(!showReplaceMenu)}
              className="flex items-center gap-1 px-3 py-2 rounded-md bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors text-sm"
            >
              Replace
              <ChevronDown size={14} />
            </button>
            {showReplaceMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowReplaceMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-md bg-neutral-900 border border-white/10 shadow-xl overflow-hidden">
                  <button
                    onClick={() => {
                      setShowReplaceMenu(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <Upload size={14} />
                    Upload
                  </button>
                  <button
                    onClick={() => {
                      setShowReplaceMenu(false);
                      setShowRegenerate(true);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <RefreshCw size={14} />
                    Regenerate
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={handleDelete}
          className="p-2 rounded-md bg-white/10 text-white/80 hover:bg-red-600/80 hover:text-white transition-colors"
          title="Delete"
        >
          <Trash2 size={16} />
        </button>
        <button
          onClick={handleDownload}
          disabled={isDownloading}
          className="p-2 rounded-md bg-white/10 text-white/80 hover:bg-blue-600/80 hover:text-white transition-colors disabled:cursor-progress disabled:opacity-60"
          title="Download"
        >
          {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        </button>
        <button
          onClick={onClose}
          className="p-2 rounded-md bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Hidden file input for upload-replace */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadReplace(file);
          e.target.value = "";
        }}
      />

      {/* Regenerate panel */}
      {showRegenerate && (
        <div
          className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 w-full max-w-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <RegeneratePanel
            projectSlug={projectSlug}
            currentImageUrl={url}
            onRegenerated={handleRegenerated}
            onCancel={() => setShowRegenerate(false)}
          />
        </div>
      )}

      {/* Navigation buttons */}
      {files.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigatePrevious();
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            aria-label="Previous image"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigateNext();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            aria-label="Next image"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Image/Video */}
      {isVideo ? (
        <video
          src={url}
          controls
          autoPlay
          className="max-w-[90vw] max-h-[85vh] rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img
          src={url}
          alt={currentFilename}
          className={cn(
            "max-w-[90vw] max-h-[85vh] object-contain rounded-lg",
            showRegenerate && "max-h-[60vh]"
          )}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/60">
        {showRegenerate ? "" : currentFilename}
      </p>
    </div>
  );
}
