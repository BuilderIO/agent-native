import type { ReviewMention } from "@agent-native/core/review/types";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";

import { cn } from "../../utils.js";
import { resolveReviewAgent } from "./review-agent.js";
import { ReviewAgentMark } from "./ReviewAgentMark.js";
import { REVIEW_MENTION_NODE_NAME } from "./ReviewComposerText.js";

/** A mention names an agent when it says so; everything else is a person. */
export function isReviewAgentMention(mention: ReviewMention): boolean {
  const { kind } = mention as ReviewMention & { kind?: unknown };
  return kind === "agent" || Boolean(mention.id?.startsWith("agent:"));
}

export function ReviewMentionChip({
  mention,
  className,
  ...props
}: {
  mention: ReviewMention;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<"span">, "children">) {
  const agent = isReviewAgentMention(mention)
    ? resolveReviewAgent({ createdBy: "agent", authorName: mention.label })
    : null;
  return (
    <span
      {...props}
      className={cn(
        "mx-0.5 inline-flex h-5 max-w-[200px] select-none items-center gap-1 rounded-full border border-border px-2 py-0.5 align-middle text-xs font-semibold leading-4 text-foreground",
        className,
      )}
    >
      {agent ? (
        <ReviewAgentMark kind={agent.kind} className="size-3 shrink-0" />
      ) : null}
      <span className="truncate">{`@${mention.label}`}</span>
    </span>
  );
}

function ReviewMentionNodeView({
  node,
}: {
  node: { attrs: Record<string, unknown> };
}) {
  const { label, email, id } = node.attrs as {
    label: string;
    email: string | null;
    id: string | null;
  };
  return (
    <NodeViewWrapper as="span" className="inline">
      <ReviewMentionChip
        mention={{ label, email, id }}
        data-review-mention-chip=""
      />
    </NodeViewWrapper>
  );
}

export const ReviewMentionNode = Node.create({
  name: REVIEW_MENTION_NODE_NAME,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: { default: "" },
      email: { default: null },
      id: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-review-mention]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-review-mention": "" }, HTMLAttributes),
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.label}`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReviewMentionNodeView);
  },
});
