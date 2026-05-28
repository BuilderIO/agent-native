import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { defaultMarkdownSerializer } from "prosemirror-markdown";
import { AudioBlock } from "./AudioBlock";

export interface ContentAudioOptions {
  HTMLAttributes: Record<string, unknown>;
  documentId?: string;
  onAudioComment?: (quotedText: string, offsetTop: number) => void;
}

function normalizedAudioWidth(value: unknown): number | null {
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

defaultMarkdownSerializer.nodes.audio = function (state: any, node: any) {
  const src = node.attrs.src || "";
  const title = node.attrs.title || "";
  const width = normalizedAudioWidth(node.attrs.width);
  const attrs = [
    src ? `src="${escapeHtmlAttribute(src)}"` : "",
    "controls",
    width ? `width="${width}"` : "",
    title ? `title="${escapeHtmlAttribute(title)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  state.write(`<audio ${attrs}></audio>`);
  state.closeBlock(node);
};

export const AudioNode = Node.create<ContentAudioOptions>({
  name: "audio",

  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      documentId: undefined,
      onAudioComment: undefined,
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
      width: {
        default: null,
        parseHTML: (element) => {
          const explicitWidth =
            element.getAttribute("data-width") ?? element.getAttribute("width");
          const widthFromStyle = element.style.width.endsWith("px")
            ? element.style.width
            : null;
          return normalizedAudioWidth(explicitWidth ?? widthFromStyle);
        },
        renderHTML: (attributes) => {
          const width = normalizedAudioWidth(attributes.width);
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
    return [{ tag: "audio" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "audio",
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        controls: "",
      },
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioBlock);
  },

  addStorage() {
    return {
      markdown: {
        serialize: (state: any, node: any) => {
          (defaultMarkdownSerializer.nodes as any).audio(state, node);
        },
        parse: {},
      },
    };
  },
});
