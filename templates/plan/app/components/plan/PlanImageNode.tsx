import { useT } from "@agent-native/core/client/i18n";
import { uploadEditorImage } from "@agent-native/core/client/uploads";
import { useFileUploadStatus } from "@agent-native/core/client/uploads";
import { SharedImage } from "@agent-native/toolkit/editor";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useRef, type ChangeEvent } from "react";
import { toast } from "sonner";

import { PlanImageViewer } from "./PlanImageViewer";

function PlanImageNodeView({
  node,
  editor,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const t = useT();
  const fileUploadStatus = useFileUploadStatus();
  const canUploadImages =
    import.meta.env.DEV ||
    (fileUploadStatus.isSuccess && fileUploadStatus.data?.configured === true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const src = (node.attrs.src as string) || "";
  const alt = (node.attrs.alt as string) || "";
  const uploading = Boolean(node.attrs.uploadId);
  const isEditable = editor.options.editable !== false;

  async function handleReplaceFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !canUploadImages) return;

    const toastId = toast.loading(t("raw.document.replacingImage"));
    try {
      const { src: nextSrc, alt: nextAlt } = await uploadEditorImage(file);
      updateAttributes({ src: nextSrc, alt: nextAlt ?? alt });
      toast.success(t("raw.document.imageReplaced"), { id: toastId });
    } catch (error) {
      console.error("Image replace failed:", error);
      toast.error(t("raw.document.replaceImageFailed"), { id: toastId });
    }
  }

  return (
    <NodeViewWrapper className="plan-image-node" data-drag-handle>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={!canUploadImages}
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
        onReplace={
          isEditable && canUploadImages
            ? () => fileInputRef.current?.click()
            : undefined
        }
      />
    </NodeViewWrapper>
  );
}

export const PlanImageNode = SharedImage.extend({
  atom: true,
  draggable: true,

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
