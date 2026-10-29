import { splitCommentAtMarkdownLimit } from "@agent-native/core/review/plain-text";
import type { ReviewMention } from "@agent-native/core/review/types";
import { Component, type ReactNode } from "react";

import { cn } from "../../utils.js";
import { InlineMarkdown, type InlineMarkdownProps } from "./InlineMarkdown.js";
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
  const found = findCommentBodyMentions(markdown, mentions);
  const mentionAt = new Map(found.map(({ at, mention }) => [at, mention]));
  const wrapsRest = Boolean(rest);
  const rendered = (
    <InlineMarkdown
      content={markdown}
      inline={compact}
      renderLists
      showRawHtml
      // A compact body is one run of text: the newlines Markdown leaves
      // between paragraphs, list items and lines read as spaces, so they
      // don't spend a clamped preview's lines.
      className={cn(
        compact && "whitespace-normal",
        wrapsRest ? undefined : className,
      )}
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
  const byEmail = new Map<string, CommentBodyMention>();
  for (const mention of mentions) {
    const email = mention.email?.toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, mention);
  }
  for (const match of body.matchAll(MAILTO_MENTION)) {
    const [source, name = "", encodedEmail = ""] = match;
    const email = safeDecodeURIComponent(encodedEmail);
    const listed = byEmail.get(email.toLowerCase());
    found.push({
      at: match.index,
      source,
      mention: { ...listed, label: name.trim() || email, email },
    });
    claimed.add(match.index);
  }
  // A mention inside a link's text or address, or inside a bare URL, stays
  // part of that link.
  const inLink = linkRanges(body);
  const unpinned = new MentionLabels();
  for (const mention of mentions) {
    if (!mention.label) continue;
    if (mention.at === undefined) {
      if (mention.label.length <= MAX_MENTION_LABEL) unpinned.add(mention);
      continue;
    }
    const source = `@${mention.label}`;
    if (
      !claimed.has(mention.at) &&
      !inLink(mention.at) &&
      body.startsWith(source, mention.at)
    ) {
      found.push({ at: mention.at, source, mention });
      claimed.add(mention.at);
    }
  }
  if (!unpinned.empty) {
    for (
      let index = body.indexOf("@");
      index !== -1;
      index = body.indexOf("@", index + 1)
    ) {
      if (claimed.has(index) || inLink(index)) continue;
      const previous = codePointBefore(body, index);
      if (previous && NAME_CHAR.test(previous)) continue;
      const mention = unpinned.longestAt(body, index + 1);
      if (mention) {
        found.push({ at: index, source: `@${mention.label}`, mention });
      }
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** Longer labels aren't names; skipping them bounds the scan per `@`. */
const MAX_MENTION_LABEL = 200;

interface LabelNode {
  next: Map<string, LabelNode>;
  /** The mention a label names, or null when it names more than one. */
  mention?: CommentBodyMention | null;
}

/**
 * Unpinned mention labels in a character tree, so matching at an `@` walks
 * at most one label's length, however many mentions a comment lists. A label
 * two people share stays text, rather than draw one of them for both.
 */
class MentionLabels {
  private readonly root: LabelNode = { next: new Map() };
  empty = true;

  add(mention: CommentBodyMention) {
    let node = this.root;
    for (const char of mention.label) {
      let child = node.next.get(char);
      if (!child) {
        child = { next: new Map() };
        node.next.set(char, child);
      }
      node = child;
    }
    if (node.mention === undefined) node.mention = mention;
    else if (node.mention && !sameIdentity(node.mention, mention)) {
      node.mention = null;
    }
    this.empty = false;
  }

  /**
   * The longest label that starts at `start` and ends on a word boundary, so
   * `@Sam` isn't read inside `@Samantha`. If two people share that label,
   * none: a shorter one, like `@Sam` in `@Sam Lee`, would name someone else.
   */
  longestAt(body: string, start: number): CommentBodyMention | undefined {
    let node: LabelNode | undefined = this.root;
    let longest: CommentBodyMention | null | undefined;
    let end = start;
    for (const char of body.slice(start, start + MAX_MENTION_LABEL)) {
      node = node.next.get(char);
      if (!node) break;
      end += char.length;
      if (node.mention === undefined) continue;
      const next = codePointAt(body, end);
      const endsWord = !(NAME_CHAR.test(char) && next && NAME_CHAR.test(next));
      if (endsWord) longest = node.mention;
    }
    return longest ?? undefined;
  }
}

/** Whether two listed mentions name the same person or agent. */
function sameIdentity(a: CommentBodyMention, b: CommentBodyMention): boolean {
  return (
    (a.id ?? null) === (b.id ?? null) &&
    (a.email?.toLowerCase() ?? null) === (b.email?.toLowerCase() ?? null) &&
    (a.kind ?? null) === (b.kind ?? null)
  );
}

const LINK_PATTERNS = [
  // `[text](address)` and images, the same shapes InlineMarkdown links.
  /!?\[[^[\]]*\]\([^()]*\)/g,
  // `<https://…>` autolinks.
  /<(?:https?|mailto):[^\s<>]*>/gi,
  // Bare URLs, which GitHub-flavored Markdown links.
  /\b(?:https?:\/\/|www\.)[^\s<]*/gi,
];

/** Whether an offset falls inside a link, with the links found once. */
function linkRanges(body: string): (at: number) => boolean {
  const ranges: { start: number; end: number }[] = [];
  for (const pattern of LINK_PATTERNS) {
    for (const match of body.matchAll(pattern)) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  // Overlaps merge, so at most one range can hold an offset.
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return (at) => {
    let low = 0;
    let high = merged.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const range = merged.at(middle);
      if (!range) return false;
      if (at < range.start) high = middle - 1;
      else if (at >= range.end) low = middle + 1;
      else return true;
    }
    return false;
  };
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
