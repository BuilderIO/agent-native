import { useRef, type ChangeEvent } from "react";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { SharedImage, uploadEditorImage } from "@agent-native/core/client";
import { toast } from "sonner";
import { PlanImageViewer } from "./PlanImageViewer";

/**
 * The plan editor's image node. It extends the shared core `SharedImage` node —
 * inheriting its byte-stable GFM `![alt](src)` serializer and the paste / drop /
 * `/image` upload plugin — and adds a React node view so editor images get the
 * same hover zoom button, lightbox, and three-dots menu (swap / download / copy)
 * as the read-only reader and structured image blocks.
 *
 * Plans inject this via `extraExtensions` with `features.image` off, so the core
 * default image node never coexists with it. Content keeps its own richer image
 * node and is unaffected.
 */
function PlanImageNodeView({
  node,
  editor,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const src = (node.attrs.src as string) || "";
  const alt = (node.attrs.alt as string) || "";
  const uploading = Boolean(node.attrs.uploadId);
  const isEditable = editor.options.editable !== false;

  async function handleReplaceFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const toastId = toast.loading("Replacing image…");
    try {
      const { src: nextSrc, alt: nextAlt } = await uploadEditorImage(file);
      updateAttributes({ src: nextSrc, alt: nextAlt ?? alt });
      toast.success("Image replaced.", { id: toastId });
    } catch (error) {
      console.error("Image replace failed:", error);
      toast.error("Could not replace the image.", { id: toastId });
    }
  }

  return (
    <NodeViewWrapper className="plan-image-node" data-drag-handle>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleReplaceFile}
      />
      <PlanImageViewer
        src={src}
        alt={alt}
        uploading={uploading}
        showControls={selected}
        imgClassName="an-rich-md-image"
        onReplace={isEditable ? () => fileInputRef.current?.click() : undefined}
      />
    </NodeViewWrapper>
  );
}

export const PlanImageNode = SharedImage.extend({
  atom: true,
  draggable: true,

  // `SharedImage.addProseMirrorPlugins` appends a plugin keyed
  // `an-shared-image-upload` via `this.parent?.()`. Extending the node WITHOUT
  // redefining this method makes Tiptap thread `this.parent` back to the very
  // same inherited method, so the keyed plugin is appended twice and
  // ProseMirror throws "Adding different instances of a keyed plugin". Delegate
  // to the parent exactly once so the upload plugin is registered a single time.
  addProseMirrorPlugins() {
    return this.parent?.() ?? [];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PlanImageNodeView);
  },
}).configure({
  onImageUpload: uploadEditorImage,
  HTMLAttributes: { class: "an-rich-md-image" },
});
