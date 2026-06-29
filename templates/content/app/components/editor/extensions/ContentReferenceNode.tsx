import {
  Node as TiptapNode,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";

import { ContentReferencePreview } from "../ContentReferencePreview";

function ContentReferenceView({ node, extension }: NodeViewProps) {
  const sourcePath =
    typeof node.attrs.sourcePath === "string" ? node.attrs.sourcePath : null;
  const title = typeof node.attrs.title === "string" ? node.attrs.title : null;
  const currentPath =
    typeof extension.options.currentPath === "string"
      ? extension.options.currentPath
      : null;

  return (
    <NodeViewWrapper
      className="my-4"
      contentEditable={false}
      data-content-reference={sourcePath ?? ""}
    >
      <ContentReferencePreview
        sourcePath={sourcePath}
        currentPath={currentPath}
        title={title}
      />
    </NodeViewWrapper>
  );
}

export const ContentReferenceNode = TiptapNode.create<{
  currentPath?: string | null;
}>({
  name: "contentReference",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      currentPath: null,
    };
  },

  addAttributes() {
    return {
      sourcePath: { default: "" },
      title: { default: null },
      __raw: { default: "" },
      indent: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-content-reference]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-content-reference": HTMLAttributes.sourcePath,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ContentReferenceView);
  },
});
