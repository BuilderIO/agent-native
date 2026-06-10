import Image, { type ImageOptions } from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageBlock } from "./ImageBlock";
import { defaultMarkdownSerializer } from "prosemirror-markdown";

export interface ContentImageOptions extends ImageOptions {
  documentId?: string;
  onImageComment?: (quotedText: string, offsetTop: number) => void;
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

// Override the default image serializer to treat images as block elements
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
      onImageComment: undefined,
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
