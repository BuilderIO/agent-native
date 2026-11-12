import Image, { type ImageOptions } from "@tiptap/extension-image";
import type { EditorView } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { defaultMarkdownSerializer } from "prosemirror-markdown";

import { ImageBlock } from "./ImageBlock";

export interface ContentImageOptions extends ImageOptions {
  documentId?: string;
  canMutateMedia?: () => boolean;
  /** Starts a comment on the whole image at `pos` in `view`. */
  onImageComment?: (view: EditorView, pos: number, offsetTop: number) => void;
  onImageFilePickerRequest?: (request: {
    pickerId: string;
    position: number;
    attrs: Record<string, unknown>;
  }) => void;
  /** True when uploads go to the page's private image route, not file storage. */
  usesPrivateImageUploads?: () => boolean;
  /**
   * Uploads an image file the block already has, such as one chosen in
   * Assets, as the picker request's image, with `attrs` set once it's in.
   * Calls `onStorageUnavailable`, if given, instead of reporting an error
   * when the page has no storage to keep the image in.
   */
  onPickedImageFile?: (
    request: {
      pickerId: string;
      position: number;
      attrs: Record<string, unknown>;
    },
    file: File,
    attrs: Record<string, unknown>,
    onStorageUnavailable?: () => void,
  ) => void;
}

function normalizedImageWidth(value: unknown): number | null {
  const width =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.round(width);
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

defaultMarkdownSerializer.nodes.image = function (state: any, node: any) {
  const src = node.attrs.src || "";
  const alt = node.attrs.alt || "";
  const title = node.attrs.title || "";
  const width = normalizedImageWidth(node.attrs.width);

  if (width) {
    const titleAttribute = title
      ? ` title="${escapeHtmlAttribute(title)}"`
      : "";
    state.write(
      `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(
        alt,
      )}" width="${width}"${titleAttribute} />`,
    );
    state.closeBlock(node);
    return;
  }

  const escapedTitle = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
  state.write(`![${state.esc(alt)}](${state.esc(src)}${escapedTitle})`);
  state.closeBlock(node);
};

export const ImageNode = Image.extend<ContentImageOptions>({
  inline: false,
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ...this.parent!(),
      documentId: undefined,
      canMutateMedia: undefined,
      onImageComment: undefined,
      onImageFilePickerRequest: undefined,
      usesPrivateImageUploads: undefined,
      onPickedImageFile: undefined,
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const explicitWidth =
            element.getAttribute("data-width") ?? element.getAttribute("width");
          const widthFromStyle = element.style.width.endsWith("px")
            ? element.style.width
            : null;
          return normalizedImageWidth(explicitWidth ?? widthFromStyle);
        },
        renderHTML: (attributes) => {
          const width = normalizedImageWidth(attributes.width);
          if (!width) return {};
          return {
            "data-width": String(width),
            width: String(width),
          };
        },
      },
      // The Assets asset an image came from, so the page keeps track of where
      // its own copy came from.
      assetId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-asset-id"),
        renderHTML: (attributes) => {
          if (!attributes.assetId) return {};
          return { "data-asset-id": attributes.assetId };
        },
      },
      uploadId: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlock);
  },
});
