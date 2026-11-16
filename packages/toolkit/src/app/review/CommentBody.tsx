import {
  COMMENT_MENTION_CHIP_LIMIT,
  findCommentMentions,
  isCommentMarkdownTangled,
  splitCommentAtMarkdownLimit,
} from "@agent-native/core/review/plain-text";
import type { ReviewMention } from "@agent-native/core/review/types";
import { Component, type ReactNode } from "react";

import { cn } from "../../utils.js";
import {
  InlineMarkdown,
  protectInlineMarkdownSpans,
  type InlineMarkdownProps,
  type InlineMarkdownProtectedSpan,
} from "./InlineMarkdown.js";
import { ReviewMentionChip } from "./ReviewMentionChip.js";

export interface CommentBodyMention extends ReviewMention {
  /**
   * Where this mention's `@` sits in the body. Without it, every whole-word
   * `@label` in the body is this mention.
   */
  at?: number;
  kind?: "person" | "agent";
}

export interface CommentBodyProps {
  /** The comment as its author wrote it, in Markdown. */
  body: string;
  /**
   * People and agents the comment mentions as `@label`. A mention written
   * inline as `@[Name](mailto:…)` needs no entry.
   */
  mentions?: readonly CommentBodyMention[] | undefined;
  /**
   * One run of inline text for previews: blocks flatten, and links show as
   * text, because a preview usually sits inside a row or card that opens the
   * comment.
   */
  compact?: boolean | undefined;
  className?: string | undefined;
  linkClassName?: string | undefined;
  codeClassName?: string | undefined;
  /** Draws a link in a full body. The default opens it in a new tab. */
  renderLink?: InlineMarkdownProps["renderLink"];
  /**
   * Draws a mention. Return nothing to draw the kit's mention chip, which is
   * also the default.
   */
  renderMention?: ((mention: CommentBodyMention) => ReactNode) | undefined;
}

/**
 * A comment body, drawn the same way in every app: paragraphs, bold, italic,
 * strikethrough, code, links, lists, quotes, code blocks and mention chips.
 * Headings show as bold lines, and raw HTML shows as written, but for HTML
 * comments, which stay hidden. A comment past the Markdown limit, or a
 * paragraph nested or tangled far past what people write, shows the rest as
 * written.
 */
export function CommentBody({
  body,
  mentions = [],
  compact = false,
  className,
  linkClassName,
  codeClassName,
  renderLink,
  renderMention,
}: CommentBodyProps) {
  // Past the limit, or from a paragraph that would take the parser seconds,
  // the rest shows as plain text, so one comment can't stall the page. Emails
  // and webhooks split it the same way.
  const { markdown, rest } = splitCommentAtMarkdownLimit(body);
  let found = findCommentMentions(markdown, mentions);
  let spans: InlineMarkdownProtectedSpan[] = found.map(
    ({ at, source, mention }) => ({ source, label: `@${mention.label}`, at }),
  );
  // The parser reads the comment with each mention swapped for a link. Should
  // that text be one the split above would cut, the mentions show as written,
  // so the split guards the text the parser reads. So do more mentions than a
  // comment names: each link adds about 50 characters and each chip two
  // elements, so thousands would take longer to read and draw than the
  // longest comment without them.
  if (
    spans.length > COMMENT_MENTION_CHIP_LIMIT ||
    (spans.length > 0 &&
      isCommentMarkdownTangled(protectInlineMarkdownSpans(markdown, spans)))
  ) {
    found = [];
    spans = [];
  }
  const mentionAt = new Map(found.map(({ at, mention }) => [at, mention]));
  const wrapsRest = Boolean(rest);
  const rendered = (
    <InlineMarkdown
      content={markdown}
      inline={compact}
      renderLists
      showRawHtml
      // A preview stays one run of text, often in a row one line high.
      breaksAsSpaces={compact}
      // A compact body is one run of text: the newlines Markdown leaves
      // between paragraphs, list items and lines read as spaces, so they
      // don't spend a clamped preview's lines.
      className={cn(
        compact && "whitespace-normal",
        wrapsRest ? undefined : className,
      )}
      linkClassName={linkClassName}
      codeClassName={codeClassName}
      protectedSpans={spans}
      renderProtectedSpan={(span, children) => {
        const mention =
          span.at === undefined ? undefined : mentionAt.get(span.at);
        if (!mention) return <span>{children}</span>;
        return (
          renderMention?.(mention) ?? (
            <ReviewMentionChip
              mention={mention}
              // A preview's line is often smaller than a chip, and it may sit on
              // an inverted card, like a video's comment bubble. There the chip
              // takes the line's size and color, so it neither pushes the row
              // taller nor goes dark on a dark card.
              className={cn(
                "select-text",
                compact &&
                  "h-auto py-0 text-[1em] leading-[inherit] text-inherit border-current/30",
              )}
              title={mention.email ?? undefined}
            />
          )
        );
      }}
      renderLink={
        compact
          ? (_href, children, linkClass) => (
              <span className={linkClass}>{children}</span>
            )
          : renderLink
      }
    />
  );
  return (
    <CommentMarkdownBoundary
      body={body}
      fallback={
        compact ? (
          <span className={cn("whitespace-normal", className)}>{body}</span>
        ) : (
          <p className={cn("m-0 whitespace-pre-wrap break-words", className)}>
            {body}
          </p>
        )
      }
    >
      {!wrapsRest ? (
        rendered
      ) : compact ? (
        <span className={cn("whitespace-normal", className)}>
          {rendered}
          {markdown ? " " : null}
          {rest}
        </span>
      ) : (
        <div className={cn("flex min-w-0 flex-col gap-2", className)}>
          {rendered}
          <p className="m-0 whitespace-pre-wrap break-words">{rest}</p>
        </div>
      )}
    </CommentMarkdownBoundary>
  );
}

interface CommentMarkdownBoundaryProps {
  body: string;
  fallback: ReactNode;
  children: ReactNode;
}

interface CommentMarkdownBoundaryState {
  body: string;
  failed: boolean;
}

/**
 * Shows a comment as written should drawing it fail, so one comment can't
 * break the list it sits in. The email and webhook text falls back the same
 * way.
 */
class CommentMarkdownBoundary extends Component<
  CommentMarkdownBoundaryProps,
  CommentMarkdownBoundaryState
> {
  override state: CommentMarkdownBoundaryState = {
    body: this.props.body,
    failed: false,
  };

  static getDerivedStateFromProps(
    props: CommentMarkdownBoundaryProps,
    state: CommentMarkdownBoundaryState,
  ): Partial<CommentMarkdownBoundaryState> | null {
    // An edited comment gets another try.
    return props.body === state.body
      ? null
      : { body: props.body, failed: false };
  }

  static getDerivedStateFromError(): Partial<CommentMarkdownBoundaryState> {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
