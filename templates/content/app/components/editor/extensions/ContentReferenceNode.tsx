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
  const referenceDepth =
    typeof extension.options.referenceDepth === "number"
      ? extension.options.referenceDepth
      : 0;

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
        referenceDepth={referenceDepth}
      />
    </NodeViewWrapper>
  );
}

export const ContentReferenceNode = TiptapNode.create<{
  currentPath?: string | null;
  referenceDepth?: number;
}>({
  name: "contentReference",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      currentPath: null,
      referenceDepth: 0,
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
