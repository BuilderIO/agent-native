import Image, { type ImageOptions } from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageBlock } from "./ImageBlock";
import { defaultMarkdownSerializer } from "@tiptap/pm/markdown";
import type { UploadOptions } from "@/hooks/use-media-upload";

// Override the default image serializer to treat images as block elements
// so they get proper blank lines around them in markdown.
defaultMarkdownSerializer.nodes.image = function (state: any, node: any) {
  const src = node.attrs.src || "";
  const alt = node.attrs.alt || "";
  const title = node.attrs.title || "";

  const escapedTitle = title ? ` "${title.replace(/"/g, '\\"')}"` : "";

  state.write(
    `![${state.esc(alt)}](${state.esc(src)}${escapedTitle})`
  );
  state.closeBlock(node);
};

export interface ImageNodeOptions extends ImageOptions {
  onUpload?: (file: File, options?: UploadOptions) => Promise<{ url: string } | null>;
  projectSlug?: string;
  articleContent?: string;
}

export const ImageNode = Image.extend<ImageNodeOptions>({
  inline: false,
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return {
      ...this.parent?.(),
      onUpload: undefined,
      projectSlug: undefined,
      articleContent: undefined,
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      uploading: {
        default: false,
      },
      uploadId: {
        default: null,
      },
      uploadStatus: {
        default: null,
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlock);
  },
});
