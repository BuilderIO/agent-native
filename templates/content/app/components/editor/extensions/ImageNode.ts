import Image, { type ImageOptions } from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageBlock } from "./ImageBlock";
import { defaultMarkdownSerializer } from "@tiptap/pm/markdown";

// Override the default image serializer to treat images as block elements
defaultMarkdownSerializer.nodes.image = function (state: any, node: any) {
  const src = node.attrs.src || "";
  const alt = node.attrs.alt || "";
  const title = node.attrs.title || "";
  const escapedTitle = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
  state.write(`![${state.esc(alt)}](${state.esc(src)}${escapedTitle})`);
  state.closeBlock(node);
};

export const ImageNode = Image.extend<ImageOptions>({
  inline: false,
  group: "block",
  atom: true,
  draggable: true,

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlock);
  },
});
