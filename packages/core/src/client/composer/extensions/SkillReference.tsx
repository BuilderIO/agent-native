import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import React from "react";
import { IconStack2 } from "@tabler/icons-react";

const SkillReferenceComponent = ({ node }: { node: any }) => {
  const displayName =
    (node.attrs.name || node.attrs.path || "")
      .replace(/^(\.agents\/)?skills\//, "")
      .replace(/\/SKILL\.md$/i, "")
      .replace(/\.md$/i, "")
      .split("/")
      .pop() || "skill";

  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-foreground align-middle mx-0.5 max-w-[160px] select-none"
        title={node.attrs.path}
      >
        <IconStack2 size={14} className="shrink-0 text-muted-foreground" />
        <span className="truncate">{displayName}</span>
      </span>
    </NodeViewWrapper>
  );
};

export const SkillReference = Node.create({
  name: "skillReference",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      name: { default: null },
      path: { default: null },
      source: { default: "codebase" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="skill-reference"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-type": "skill-reference" }, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SkillReferenceComponent);
  },
});
