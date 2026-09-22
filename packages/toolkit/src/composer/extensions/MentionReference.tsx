import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";

import { MentionItemMedia } from "../MentionItemMedia.js";
import type { MentionItemMedia as MentionItemMediaValue } from "../types.js";

function parseMentionItemMedia(
  value: string | null,
): MentionItemMediaValue | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    const backgroundColor =
      typeof candidate.backgroundColor === "string"
        ? candidate.backgroundColor
        : undefined;
    if (candidate.type === "none") return { type: "none" };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      return {
        type: "text",
        text: candidate.text,
        ...(backgroundColor ? { backgroundColor } : {}),
      };
    }
    if (candidate.type === "image" && typeof candidate.src === "string") {
      return {
        type: "image",
        src: candidate.src,
        ...(candidate.fit === "cover" ? { fit: "cover" } : {}),
        ...(backgroundColor ? { backgroundColor } : {}),
      };
    }
    // coercion-ok: Malformed optional media must preserve legacy draft rendering.
  } catch {}
  return null;
}

const MentionReferenceComponent = ({ node }: { node: any }) => {
  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-foreground align-middle mx-0.5 max-w-[200px] select-none"
        title={node.attrs.refPath || node.attrs.refId || node.attrs.label}
      >
        <MentionItemMedia
          icon={node.attrs.icon}
          media={node.attrs.media}
          size="sm"
          fallbackIcon="stack"
        />
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
      media: {
        default: null,
        parseHTML: (element) =>
          parseMentionItemMedia(element.getAttribute("data-media")),
        renderHTML: (attributes) =>
          attributes.media
            ? { "data-media": JSON.stringify(attributes.media) }
            : {},
      },
      source: { default: "" },
      refType: { default: "file" },
      refId: { default: null },
      refPath: { default: null },
      slotKey: { default: null },
      slotLabel: { default: null },
      metadata: { default: null },
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

  renderText({ node }) {
    return `@${node.attrs.label}`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionReferenceComponent);
  },
});
