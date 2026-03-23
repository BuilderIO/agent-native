import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState, useCallback } from "react";
import { ImageIcon, Loader2, X } from "lucide-react";
import { openFilePicker, uploadFile } from "@/lib/upload";

export function ComposeImageBlock({
  node,
  updateAttributes,
  deleteNode,
  selected,
  extension,
}: NodeViewProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const src = node.attrs.src as string;

  const handlePickImage = useCallback(async () => {
    const file = await openFilePicker("image/*");
    if (!file) return;

    setIsUploading(true);
    try {
      const result = await uploadFile(file);
      updateAttributes({ src: result.url });
    } catch {
      // leave as placeholder on failure
    } finally {
      setIsUploading(false);
    }
  }, [updateAttributes]);

  // No src — show placeholder
  if (!src) {
    return (
      <NodeViewWrapper>
        <div
          className="compose-image-placeholder"
          data-selected={selected || undefined}
          onClick={() => void handlePickImage()}
        >
          {isUploading ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span>Uploading...</span>
            </>
          ) : (
            <>
              <ImageIcon size={20} />
              <span>Add an image</span>
            </>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  // Has src — show the image
  return (
    <NodeViewWrapper>
      <div
        className="compose-image-wrapper"
        data-selected={selected || undefined}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <img src={src} className="compose-image" draggable={false} />
        {(isHovered || selected) && (
          <div className="compose-image-overlay">
            <button
              onClick={() => void handlePickImage()}
              className="compose-image-btn"
            >
              Replace
            </button>
            <button
              onClick={deleteNode}
              className="compose-image-btn compose-image-btn--danger"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
