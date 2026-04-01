import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";
import { IconTrash } from "@tabler/icons-react";

export function ImageBlock({
  node,
  updateAttributes,
  deleteNode,
  selected,
}: NodeViewProps) {
  const [isHovered, setIsHovered] = useState(false);
  const src = node.attrs.src as string;
  const alt = node.attrs.alt as string;

  if (!src) {
    return (
      <NodeViewWrapper className="media-block-wrapper" data-drag-handle>
        <div className="media-placeholder">
          <span className="text-muted-foreground text-sm">No image source</span>
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
        <img src={src} alt={alt || ""} className="media-block__content" />

        {(isHovered || selected) && (
          <div className="media-block__overlay">
            <button
              onClick={deleteNode}
              className="media-block__btn media-block__btn--danger"
              title="Remove image"
            >
              <IconTrash size={14} />
            </button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
