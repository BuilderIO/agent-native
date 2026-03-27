import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import React from "react";

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

const FileReferenceComponent = ({ node }: { node: any }) => {
  const isFolder = node.attrs.path?.endsWith("/");
  const cleanPath = isFolder ? node.attrs.path.slice(0, -1) : node.attrs.path;
  const displayName = cleanPath.split("/").pop() || cleanPath;

  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-foreground align-middle mx-0.5 max-w-[200px] select-none"
        title={node.attrs.path}
      >
        {isFolder ? <FolderIcon /> : <FileIcon />}
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
