import type { ReviewMention } from "@agent-native/core/review/types";
import type { ReactNode } from "react";

import { cn } from "../../utils.js";
import { InlineMarkdown, type InlineMarkdownProps } from "./InlineMarkdown.js";
import { ReviewMentionChip } from "./ReviewMentionChip.js";

/**
 * A comment shows Markdown for this many characters and plain text after, so
 * one huge comment can't stall the page that renders it.
 */
export const COMMENT_BODY_MARKDOWN_LIMIT = 20_000;

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
  mentions?: readonly CommentBodyMention[];
  /**
   * One run of inline text for previews: blocks flatten, and links show as
   * text, because a preview usually sits inside a row or card that opens the
   * comment.
   */
  compact?: boolean;
  className?: string;
  linkClassName?: string;
  codeClassName?: string;
  /** Draws a link in a full body. The default opens it in a new tab. */
  renderLink?: InlineMarkdownProps["renderLink"];
  /** Draws a mention. The default is the kit's mention chip. */
  renderMention?: (mention: CommentBodyMention) => ReactNode;
}

/**
 * A comment body, drawn the same way in every app: paragraphs, bold, italic,
 * strikethrough, code, links, lists, quotes, code blocks and mention chips.
 * Headings show as bold lines, and raw HTML is skipped.
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
  const { markdown, rest } = splitAtMarkdownLimit(body);
  const found = findCommentBodyMentions(markdown, mentions);
  const mentionAt = new Map(found.map(({ at, mention }) => [at, mention]));
  const wrapsRest = Boolean(rest) && !compact;
  const rendered = (
    <InlineMarkdown
      content={markdown}
      inline={compact}
      renderLists
      className={wrapsRest ? undefined : className}
      linkClassName={linkClassName}
      codeClassName={codeClassName}
      protectedSpans={found.map(({ at, source, mention }) => ({
        source,
        label: `@${mention.label}`,
        at,
      }))}
      renderProtectedSpan={(span, children) => {
        const mention =
          span.at === undefined ? undefined : mentionAt.get(span.at);
        if (!mention) return <span>{children}</span>;
        return renderMention ? (
          renderMention(mention)
        ) : (
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
  if (!wrapsRest) return rendered;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {rendered}
      <p className="m-0 whitespace-pre-wrap break-words">{rest}</p>
    </div>
  );
}

/**
 * Splits a long body at a paragraph break near the limit, so the Markdown
 * part doesn't end inside a block when it can help it.
 */
function splitAtMarkdownLimit(body: string): {
  markdown: string;
  rest: string;
} {
  if (body.length <= COMMENT_BODY_MARKDOWN_LIMIT) {
    return { markdown: body, rest: "" };
  }
  const head = body.slice(0, COMMENT_BODY_MARKDOWN_LIMIT);
  const paragraphBreak = head.lastIndexOf("\n\n");
  let cut =
    paragraphBreak > COMMENT_BODY_MARKDOWN_LIMIT / 2
      ? paragraphBreak
      : COMMENT_BODY_MARKDOWN_LIMIT;
  const last = body.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return {
    markdown: body.slice(0, cut),
    rest: body.slice(cut).replace(/^\n+/, ""),
  };
}

const NAME_CHAR = /[\p{L}\p{M}\p{N}_]/u;
const MAILTO_MENTION = /@\[([^[\]]+)\]\(mailto:([^()\s]+)\)/g;

interface FoundMention {
  at: number;
  source: string;
  mention: CommentBodyMention;
}

/**
 * Finds each mention's place in the body: `@[Name](mailto:…)` text, mentions
 * pinned to an offset, and whole-word `@label`s, longest label first, so
 * `@Sam` is not read inside `@Samantha` or `mail@Sam`.
 */
function findCommentBodyMentions(
  body: string,
  mentions: readonly CommentBodyMention[],
): FoundMention[] {
  const found: FoundMention[] = [];
  const claimed = new Set<number>();
  for (const match of body.matchAll(MAILTO_MENTION)) {
    const [source, name = "", encodedEmail = ""] = match;
    const email = safeDecodeURIComponent(encodedEmail);
    const listed = mentions.find(
      (mention) => mention.email?.toLowerCase() === email.toLowerCase(),
    );
    found.push({
      at: match.index,
      source,
      mention: { ...listed, label: name.trim() || email, email },
    });
    claimed.add(match.index);
  }
  const unpinned: CommentBodyMention[] = [];
  for (const mention of mentions) {
    if (!mention.label) continue;
    if (mention.at === undefined) {
      unpinned.push(mention);
      continue;
    }
    const source = `@${mention.label}`;
    if (!claimed.has(mention.at) && body.startsWith(source, mention.at)) {
      found.push({ at: mention.at, source, mention });
      claimed.add(mention.at);
    }
  }
  unpinned.sort((a, b) => b.label.length - a.label.length);
  if (unpinned.length) {
    for (
      let index = body.indexOf("@");
      index !== -1;
      index = body.indexOf("@", index + 1)
    ) {
      if (claimed.has(index)) continue;
      const previous = codePointBefore(body, index);
      if (previous && NAME_CHAR.test(previous)) continue;
      const mention = unpinned.find((candidate) => {
        const source = `@${candidate.label}`;
        if (!body.startsWith(source, index)) return false;
        const next = codePointAt(body, index + source.length);
        const last = codePointBefore(body, index + source.length);
        return !(last && NAME_CHAR.test(last) && next && NAME_CHAR.test(next));
      });
      if (mention) {
        found.push({ at: index, source: `@${mention.label}`, mention });
      }
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

function codePointBefore(text: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const last = text.charCodeAt(index - 1);
  if (last >= 0xdc00 && last <= 0xdfff && index >= 2) {
    const lead = text.charCodeAt(index - 2);
    if (lead >= 0xd800 && lead <= 0xdbff) return text.slice(index - 2, index);
  }
  return text[index - 1];
}

function codePointAt(text: string, index: number): string | undefined {
  const codePoint = text.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
