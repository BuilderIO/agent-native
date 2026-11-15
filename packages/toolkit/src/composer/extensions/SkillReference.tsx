import { IconStack2 } from "@tabler/icons-react";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";

const SkillReferenceComponent = ({ node }: { node: any }) => {
  const displayName =
    (node.attrs.name || node.attrs.path || "")
      .replace(/^(\.agents?\/)?skills\//, "")
      .replace(/\/SKILL\.md$/i, "")
      .replace(/\.md$/i, "")
      .split("/")
      .pop() || "skill";

  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        className="mx-1 inline-flex max-w-[160px] items-center h-5 gap-1 rounded-[var(--agent-kit-radius-xs,0.25rem)] border border-border bg-muted/50 px-2 text-xs leading-4 font-medium text-foreground align-middle select-none"
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
