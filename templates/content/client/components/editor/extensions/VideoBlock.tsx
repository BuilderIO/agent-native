import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState, useRef, useCallback, useEffect } from "react";
import { Video, Replace, Trash2, Loader2, Download } from "lucide-react";
import { downloadMediaAsset, getDownloadFilename } from "@/lib/media-download";

export function VideoBlock({
  node,
  updateAttributes,
  deleteNode,
  selected,
  extension,
}: NodeViewProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const src = node.attrs.src as string;
  const title = node.attrs.title as string;
  const uploading = node.attrs.uploading as boolean;
  const uploadStatus = (node.attrs.uploadStatus as "uploading" | "processing" | null) ?? null;
  const isTransientSrc = typeof src === "string" && src.startsWith("blob:");

  const onUpload = extension.options.onUpload as
    | ((file: File, options?: { onStatusChange?: (status: "uploading" | "processing") => void }) => Promise<{ url: string } | null>)
    | undefined;

  const handleReplace = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !onUpload) return;

      const previousSrc = src;
      const tempUrl = URL.createObjectURL(file);
      updateAttributes({ src: tempUrl, uploading: true, uploadStatus: "uploading" });

      try {
        const result = await onUpload(file, {
          onStatusChange: (status) => {
            updateAttributes({ uploading: true, uploadStatus: status });
          },
        });
        if (result) {
          updateAttributes({ src: result.url, uploading: false, uploadId: null, uploadStatus: null });
          return;
        }

        updateAttributes({ src: previousSrc, uploading: false, uploadId: null, uploadStatus: null });
      } catch {
        updateAttributes({ src: previousSrc, uploading: false, uploadId: null, uploadStatus: null });
      } finally {
        URL.revokeObjectURL(tempUrl);
        e.target.value = "";
      }
    },
    [onUpload, src, updateAttributes]
  );

  useEffect(() => {
    if (!uploading || !src) return;

    const timeoutId = window.setTimeout(() => {
      const video = videoRef.current;
      const readyState = video?.readyState ?? null;
      const networkState = video?.networkState ?? null;

      console.warn("[video] Upload preview still loading", {
        src,
        isTransientSrc,
        readyState,
        networkState,
      });
    }, 10000);

    return () => window.clearTimeout(timeoutId);
  }, [isTransientSrc, src, uploading]);

  const handleDownload = useCallback(async () => {
    if (isDownloading) return;

    setIsDownloading(true);
    try {
      await downloadMediaAsset({
        url: src,
        filename: getDownloadFilename(src, title || "video"),
      });
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, src, title]);

  if (!src) {
    return (
      <NodeViewWrapper className="media-block-wrapper" data-drag-handle>
        <div className="media-placeholder" onClick={handleReplace}>
          <Video size={24} />
          <span>Click to add a video</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="media-block-wrapper" data-drag-handle>
      <div
        className={`media-block ${selected ? "media-block--selected" : ""}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <video
          ref={videoRef}
          src={src}
          controls
          preload="metadata"
          playsInline
          title={title || ""}
          className="media-block__content"
          onLoadedMetadata={() => {
            const video = videoRef.current;
            console.info("[video] Loaded metadata", {
              src,
              isTransientSrc,
              duration: video?.duration ?? null,
              readyState: video?.readyState ?? null,
            });
          }}
          onCanPlay={() => {
            const video = videoRef.current;
            console.info("[video] Can play", {
              src,
              isTransientSrc,
              readyState: video?.readyState ?? null,
              networkState: video?.networkState ?? null,
            });
          }}
          onError={() => {
            const video = videoRef.current;
            const mediaError = video?.error;
            console.error("[video] Video element failed to load", {
              src,
              isTransientSrc,
              code: mediaError?.code ?? null,
              message: mediaError?.message ?? null,
              readyState: video?.readyState ?? null,
              networkState: video?.networkState ?? null,
            });
          }}
        />

        {uploading && (
          <div className="media-block__uploading-overlay">
            <div className="flex flex-col items-center gap-2 text-white">
              <Loader2 className="animate-spin w-8 h-8" />
              <span className="text-xs font-medium">
                {uploadStatus === "processing" ? "Processing in Builder..." : "Uploading video..."}
              </span>
            </div>
          </div>
        )}

        {(isHovered || selected) && !uploading && (
          <div className="media-block__overlay">
            <button
              onClick={handleReplace}
              className="media-block__btn"
              title="Replace video"
            >
              <Replace size={14} />
              <span>Replace</span>
            </button>
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="media-block__btn"
              title="Download video"
            >
              {isDownloading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              <span>Download</span>
            </button>
            <button
              onClick={deleteNode}
              className="media-block__btn media-block__btn--danger"
              title="Remove video"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </NodeViewWrapper>
  );
}
