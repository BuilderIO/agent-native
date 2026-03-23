import { Node, mergeAttributes } from "@tiptap/react";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { VideoBlock } from "./VideoBlock";
import type { UploadOptions } from "@/hooks/use-media-upload";

export interface VideoNodeOptions {
  HTMLAttributes: Record<string, any>;
  onUpload?: (
    file: File,
    options?: UploadOptions,
  ) => Promise<{ url: string } | null>;
}

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    video: {
      setVideo: (options: { src: string; title?: string }) => ReturnType;
    };
  }
}

function isPersistableVideoSrc(src: unknown): src is string {
  return typeof src === "string" && src.length > 0 && !src.startsWith("blob:");
}

export const VideoNode = Node.create<VideoNodeOptions>({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: { class: "notion-video" },
      onUpload: undefined,
    };
  },

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
      controls: { default: true },
      uploading: { default: false },
      uploadId: { default: null },
      uploadStatus: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "video" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoBlock);
  },

  addCommands() {
    return {
      setVideo:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const src = node.attrs.src;
          if (!isPersistableVideoSrc(src)) {
            return;
          }

          const title = node.attrs.title || "";
          state.write(
            `<video src="${src}" controls${title ? ` title="${title}"` : ""}></video>`,
          );
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: any) {
            markdownit.options.html = true;
          },
        },
      },
    };
  },
});
