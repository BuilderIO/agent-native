import { useFormatters } from "@agent-native/core/client/i18n";
import type {
  ReviewComment,
  ReviewCommentReaction,
} from "@agent-native/core/review/types";
import { cn } from "@agent-native/toolkit/utils";
import { IconCircleCheck } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { InlineMarkdown } from "./InlineMarkdown.js";
import { resolveReviewAgent } from "./review-agent.js";
import { ReviewAuthorAvatar } from "./ReviewAuthorAvatar.js";
import {
  ReviewReactionBar,
  type ReviewReactionBarProps,
} from "./ReviewReactionBar.js";

const MAX_REVIEW_IMAGE_ATTACHMENTS = 5;

interface ReviewCommentAttachment {
  url: string;
  name: string;
}

export interface ReviewCommentItemProps {
  comment: ReviewComment;
  /** The first comment of a thread is the root; the rest are replies. */
  variant: "root" | "reply";
  reviewerLabel?: string | undefined;
  /** Replaces the display name of agent authors. */
  agentLabel?: string | undefined;
  agentBadgeLabel?: string | undefined;
  resolvedLabel?: string | undefined;
  unread?: boolean | undefined;
  unreadLabel?: string | undefined;
  showReactions?: boolean | undefined;
  reactions?: readonly ReviewCommentReaction[] | undefined;
  canReact?: boolean | undefined;
  reactionChoices?: readonly string[] | undefined;
  addReactionLabel?: string | undefined;
  reactionLabel?: ReviewReactionBarProps["reactionLabel"];
  onReact?:
    | ((comment: ReviewComment, reaction: string, active: boolean) => void)
    | undefined;
  /** Trailing control of the header, usually a `ReviewCommentMenu`. */
  menu?: ReactNode;
  /** Replaces the whole comment while it is being edited. */
  editor?: ReactNode;
  className?: string | undefined;
}

export function ReviewCommentItem({
  comment,
  variant,
  reviewerLabel = "Reviewer",
  agentLabel,
  agentBadgeLabel = "Agent",
  resolvedLabel = "Resolved",
  unread = false,
  unreadLabel = "Unread",
  showReactions = false,
  reactions = [],
  canReact = false,
  reactionChoices,
  addReactionLabel,
  reactionLabel,
  onReact,
  menu,
  editor,
  className,
}: ReviewCommentItemProps) {
  const formatters = useFormatters();
  const agent = resolveReviewAgent({
    createdBy: comment.createdBy,
    authorName: comment.authorName,
  });
  // An agent never falls back to authorEmail: on agent comments that is the
  // owner's address, not the agent's. A whitespace-only name counts as unnamed.
  const agentName = comment.authorName?.trim() || null;
  const author = agent
    ? (agentLabel ?? agentName ?? agentBadgeLabel)
    : (comment.authorName ?? comment.authorEmail ?? reviewerLabel);
  const showAgentBadge =
    agent !== null &&
    author.trim().toLowerCase() !== agentBadgeLabel.trim().toLowerCase();
  const resolutionNote =
    comment.status === "resolved" ? getReviewResolutionNote(comment) : null;
  const bodyIsResolutionNote =
    resolutionNote !== null &&
    resolutionNote === comment.body.trim() &&
    isResolutionNoteMetadata(comment.metadata);
  const handleReact = (reaction: string, active: boolean) =>
    onReact?.(comment, reaction, active);

  if (editor) {
    return (
      <div className={cn("px-3 pt-3", className)} data-review-comment-editing>
        {editor}
      </div>
    );
  }

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1 px-3 pt-3", className)}
      data-review-comment={comment.id}
      data-review-comment-variant={variant}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ReviewAuthorAvatar
          name={author}
          email={comment.authorEmail}
          agent={agent}
          size={24}
        />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="flex min-w-0 items-center gap-0.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {author}
            </span>
            {showAgentBadge ? (
              <span className="inline-flex h-5 shrink-0 items-center rounded-md border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {agentBadgeLabel}
              </span>
            ) : null}
          </span>
          <time
            className="shrink-0 text-sm text-muted-foreground"
            dateTime={comment.createdAt}
          >
            {formatReviewCommentRelativeTime(comment.createdAt, formatters)}
          </time>
          {unread ? (
            <>
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 self-center rounded-full bg-primary"
              />
              <span className="sr-only">{unreadLabel}</span>
            </>
          ) : null}
          {comment.status === "resolved" ? (
            <span className="hidden shrink-0 self-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground @xs/review:inline-flex">
              {resolvedLabel}
            </span>
          ) : null}
        </div>
        {menu}
      </div>
      <div className="min-w-0 ps-8">
        {!bodyIsResolutionNote ? (
          <InlineMarkdown
            content={displayReviewCommentBody(comment.body)}
            className="text-sm leading-6 text-foreground"
          />
        ) : null}
        {resolutionNote ? (
          <div
            className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-muted-foreground"
            aria-label={resolvedLabel}
          >
            <IconCircleCheck className="mt-0.5 size-3.5 shrink-0" />
            <InlineMarkdown
              content={displayReviewCommentBody(resolutionNote)}
              className="min-w-0 text-xs leading-4"
            />
          </div>
        ) : null}
        <ReviewCommentAttachmentStrip comment={comment} />
      </div>
      {showReactions ? (
        <ReviewReactionBar
          className="ps-[26px]"
          reactions={reactions}
          canReact={canReact}
          choices={reactionChoices}
          addReactionLabel={addReactionLabel}
          reactionLabel={reactionLabel}
          onReact={handleReact}
        />
      ) : null}
    </div>
  );
}

/**
 * Relative age through `Intl.RelativeTimeFormat`, falling back to a short
 * calendar date past 30 days. An unparseable value is returned as-is so a bad
 * timestamp shows up instead of reading as "now".
 */
export function formatReviewCommentRelativeTime(
  value: string,
  formatters: ReturnType<typeof useFormatters>,
  now: number = Date.now(),
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.RelativeTimeFormatOptions = { numeric: "auto" };
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 60) {
    return formatters.formatRelativeTime(0, "second", options);
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return formatters.formatRelativeTime(-minutes, "minute", options);
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return formatters.formatRelativeTime(-hours, "hour", options);
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return formatters.formatRelativeTime(-days, "day", options);
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return formatters.formatDate(date, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function ReviewCommentAttachmentStrip({ comment }: { comment: ReviewComment }) {
  const attachments = reviewCommentAttachments(comment);
  if (!attachments.length) return null;
  return (
    <div
      className="mt-2 flex max-w-64 flex-wrap gap-1.5"
      data-review-comment-attachments
    >
      {attachments.map((attachment) => (
        <a
          key={attachment.url}
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="block size-16 overflow-hidden rounded-md border border-border bg-muted"
        >
          <img
            src={attachment.url}
            alt={attachment.name}
            loading="lazy"
            className="size-full object-cover"
          />
        </a>
      ))}
    </div>
  );
}

function reviewCommentAttachments(
  comment: ReviewComment,
): ReviewCommentAttachment[] {
  const raw = comment.metadata?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const attachment = value as Record<string, unknown>;
      const url = typeof attachment.url === "string" ? attachment.url : "";
      const contentType =
        typeof attachment.contentType === "string"
          ? attachment.contentType
          : undefined;
      if (
        !url ||
        (contentType && !contentType.startsWith("image/")) ||
        !isTrustedReviewAttachmentUrl(url)
      ) {
        return [];
      }
      return [
        {
          url,
          name:
            typeof attachment.name === "string" && attachment.name.trim()
              ? attachment.name
              : "image",
        },
      ];
    })
    .slice(0, MAX_REVIEW_IMAGE_ATTACHMENTS);
}

export function isTrustedReviewAttachmentUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(
      value,
      typeof window === "undefined"
        ? "http://localhost"
        : window.location.origin,
    );
    // coercion-ok: an unparseable attachment URL is untrusted, not absent.
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (typeof window !== "undefined" && parsed.origin === window.location.origin)
    return true;
  return parsed.protocol === "https:" && parsed.hostname === "cdn.builder.io";
}

function displayReviewCommentBody(body: string): string {
  return body.replace(/@\[([^\]]+)\]\(mailto:[^)]+\)/g, "@$1");
}

function getReviewResolutionNote(comment: ReviewComment): string | null {
  const direct = comment.resolutionNote;
  const metadata = comment.metadata;
  const nestedResolution = metadata?.resolution;
  const nestedNote =
    isRecord(nestedResolution) && typeof nestedResolution.note === "string"
      ? nestedResolution.note
      : null;
  const metadataNote =
    typeof metadata?.resolutionNote === "string"
      ? metadata.resolutionNote
      : typeof metadata?.resolvedNote === "string"
        ? metadata.resolvedNote
        : isResolutionNoteMetadata(metadata) &&
            typeof metadata?.note === "string"
          ? metadata.note
          : isResolutionNoteMetadata(metadata)
            ? comment.body
            : null;
  const candidate =
    typeof direct === "string" ? direct : (metadataNote ?? nestedNote);
  const normalized = candidate?.trim();
  return normalized || null;
}

function isResolutionNoteMetadata(
  metadata: Record<string, unknown> | null,
): boolean {
  const marker = metadata?.type ?? metadata?.kind;
  return (
    marker === "resolution" ||
    marker === "resolution_note" ||
    marker === "resolution-note"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
