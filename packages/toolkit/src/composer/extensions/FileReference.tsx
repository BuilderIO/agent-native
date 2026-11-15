import { IconFile, IconFolder } from "@tabler/icons-react";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";

const FileReferenceComponent = ({ node }: { node: any }) => {
  const isFolder = node.attrs.path?.endsWith("/");
  const cleanPath = isFolder ? node.attrs.path.slice(0, -1) : node.attrs.path;
  const displayName = cleanPath.split("/").pop() || cleanPath;

  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        className="mx-1 inline-flex max-w-[200px] items-center h-5 gap-1 rounded-[var(--agent-kit-radius-xs,0.25rem)] border border-border bg-muted/50 px-2 text-xs leading-4 font-medium text-foreground align-middle select-none"
        title={node.attrs.path}
      >
        {isFolder ? (
          <IconFolder size={14} className="shrink-0 text-muted-foreground" />
        ) : (
          <IconFile size={14} className="shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{displayName}</span>
      </span>
    </NodeViewWrapper>
  );
};

export const FileReference = Node.create({
  name: "fileReference",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      path: { default: null },
      source: { default: "codebase" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="file-reference"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-type": "file-reference" }, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileReferenceComponent);
  },
});
