import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ComposeImageBlock } from "./ComposeImageBlock";

export const ComposeImageNode = Image.extend({
  inline: false,
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ComposeImageBlock);
  },
});
