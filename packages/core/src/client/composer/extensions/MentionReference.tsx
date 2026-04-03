import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import React from "react";
import {
  IconFile,
  IconFolder,
  IconFileText,
  IconCheckbox,
  IconMail,
  IconUser,
  IconPresentation,
  IconStack2,
  IconRobot,
} from "@tabler/icons-react";

const iconProps = { size: 14, className: "shrink-0 text-muted-foreground" };

function MentionIcon({ icon }: { icon?: string }) {
  switch (icon) {
    case "folder":
      return <IconFolder {...iconProps} />;
    case "document":
      return <IconFileText {...iconProps} />;
    case "form":
      return <IconCheckbox {...iconProps} />;
    case "email":
      return <IconMail {...iconProps} />;
    case "user":
      return <IconUser {...iconProps} />;
    case "deck":
      return <IconPresentation {...iconProps} />;
    case "agent":
      return <IconRobot {...iconProps} />;
    case "file":
      return <IconFile {...iconProps} />;
    default:
      return <IconStack2 {...iconProps} />;
  }
}

const MentionReferenceComponent = ({ node }: { node: any }) => {
  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-foreground align-middle mx-0.5 max-w-[200px] select-none"
        title={node.attrs.refPath || node.attrs.refId || node.attrs.label}
      >
        <MentionIcon icon={node.attrs.icon} />
        <span className="truncate">{node.attrs.label}</span>
      </span>
    </NodeViewWrapper>
  );
};

export const MentionReference = Node.create({
  name: "mentionReference",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      label: { default: null },
      icon: { default: "file" },
      source: { default: "" },
      refType: { default: "file" },
      refId: { default: null },
      refPath: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention-reference"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-type": "mention-reference" }, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionReferenceComponent);
  },
});
