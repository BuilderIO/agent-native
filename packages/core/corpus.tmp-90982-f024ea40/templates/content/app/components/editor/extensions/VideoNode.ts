import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { defaultMarkdownSerializer } from "prosemirror-markdown";

import { VideoBlock } from "./VideoBlock";

export interface ContentVideoOptions {
  HTMLAttributes: Record<string, unknown>;
  documentId?: string;
  onVideoComment?: (quotedText: string, offsetTop: number) => void;
}

function normalizedVideoWidth(value: unknown): number | null {
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

defaultMarkdownSerializer.nodes.video = function (state: any, node: any) {
  const src = node.attrs.src || "";
  const title = node.attrs.title || "";
  const poster = node.attrs.poster || "";
  const width = normalizedVideoWidth(node.attrs.width);
  const attrs = [
    src ? `src="${escapeHtmlAttribute(src)}"` : "",
    "controls",
    width ? `width="${width}"` : "",
    poster ? `poster="${escapeHtmlAttribute(poster)}"` : "",
    title ? `title="${escapeHtmlAttribute(title)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  state.write(`<video ${attrs}></video>`);
  state.closeBlock(node);
};

export const VideoNode = Node.create<ContentVideoOptions>({
  name: "video",

  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      documentId: undefined,
      onVideoComment: undefined,
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute("src"),
        renderHTML: (attributes) => {
          if (!attributes.src) return {};
          return { src: attributes.src };
        },
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("title"),
        renderHTML: (attributes) => {
          if (!attributes.title) return {};
          return { title: attributes.title };
        },
      },
      poster: {
        default: null,
        parseHTML: (element) => element.getAttribute("poster"),
        renderHTML: (attributes) => {
          if (!attributes.poster) return {};
          return { poster: attributes.poster };
        },
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const explicitWidth =
            element.getAttribute("data-width") ?? element.getAttribute("width");
          const widthFromStyle = element.style.width.endsWith("px")
            ? element.style.width
            : null;
          return normalizedVideoWidth(explicitWidth ?? widthFromStyle);
        },
        renderHTML: (attributes) => {
          const width = normalizedVideoWidth(attributes.width);
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

  parseHTML() {
    return [{ tag: "video" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        controls: "",
      },
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoBlock);
  },

  addStorage() {
    return {
      markdown: {
        serialize: (state: any, node: any) => {
          (defaultMarkdownSerializer.nodes as any).video(state, node);
        },
        parse: {},
      },
    };
  },
});
