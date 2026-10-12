import { emailToColor } from "@agent-native/core/client/collab";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  InlineMarkdown,
  type InlineMarkdownProtectedSpan,
} from "@agent-native/toolkit/app/review";
import { forwardRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

import {
  Avatar as UserAvatar,
  AvatarFallback as UserAvatarFallback,
  AvatarImage as UserAvatarImage,
} from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for every comment surface — margin cards, the
 * anchored popover, and the comments panel — and for both comments and
 * suggested edits. Style a comment here once rather than per surface.
 */

export interface CommentMentionLike {
  name?: string | null;
}

function commentMentionSpans(
  mentions: CommentMentionLike[],
): InlineMarkdownProtectedSpan[] {
  const labels = Array.from(
    new Set(mentions.map((m) => m.name).filter((n): n is string => !!n)),
  ).sort((a, b) => b.length - a.length);
  return labels.map((label) => ({
    source: `@${label}`,
    label: `@${label}`,
    className: "comment-mention",
  }));
}

/**
 * Render a comment body, styling any `@mention` tokens that match the
 * comment's stored mentions. Raw HTML is never interpreted.
 */
export function renderCommentBody(
  content: string,
  mentions: CommentMentionLike[],
) {
  return (
    <InlineMarkdown
      content={content}
      inline
      protectedSpans={commentMentionSpans(mentions)}
      renderLink={(href, children, className) =>
        href.startsWith("/page/") ? (
          <Link to={href} className={className}>
            {children}
          </Link>
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
          >
            {children}
          </a>
        )
      }
    />
  );
}

function emailToInitial(email: string) {
  return (email.split("@")[0]?.[0] ?? "?").toUpperCase();
}

export function CommentAvatar({
  email,
  name,
  className,
}: {
  email?: string | null;
  name?: string | null;
  className?: string;
}) {
  const avatarUrl = useAvatarUrl(email);
  const label = name ?? email ?? "";
  return (
    <UserAvatar className={cn("size-7 shrink-0", className)} title={label}>
      {avatarUrl ? <UserAvatarImage src={avatarUrl} alt={label} /> : null}
      <UserAvatarFallback
        className="text-xs font-medium text-primary-foreground"
        style={{ backgroundColor: emailToColor(email ?? "user") }}
      >
        {emailToInitial(label)}
      </UserAvatarFallback>
    </UserAvatar>
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "3d ago" for recent activity, a short date beyond a few weeks. Every comment
 * surface is a column of about 320px, where the long form ("7 minutes ago")
 * clipped beside a name and its actions; `title` keeps the full date.
 */
export function useCommentTimestamp() {
  const formatters = useFormatters();
  const formatDate = (
    value: Date,
    options: Intl.DateTimeFormatOptions,
  ): string => formatters.formatDate(value, options);
  // Older host shells expose only formatDate; fall back to the platform.
  const formatRelativeTime = (
    amount: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string =>
    formatters.formatRelativeTime
      ? formatters.formatRelativeTime(amount, unit, options)
      : new Intl.RelativeTimeFormat(undefined, options).format(amount, unit);
  return (value: string | number | Date) => {
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    if (Number.isNaN(time)) return { label: "", title: "" };
    const title = formatDate(date, { dateStyle: "medium", timeStyle: "short" });
    const elapsed = Date.now() - time;
    const narrow = { style: "narrow" } as const;
    const numeric = { ...narrow, numeric: "auto" } as const;
    let label: string;
    if (elapsed < MINUTE) label = formatRelativeTime(0, "second", numeric);
    else if (elapsed < HOUR)
      label = formatRelativeTime(
        -Math.floor(elapsed / MINUTE),
        "minute",
        narrow,
      );
    else if (elapsed < DAY)
      label = formatRelativeTime(-Math.floor(elapsed / HOUR), "hour", narrow);
    else if (elapsed < 7 * DAY)
      label = formatRelativeTime(-Math.floor(elapsed / DAY), "day", numeric);
    else if (elapsed < 28 * DAY)
      label = formatRelativeTime(
        -Math.floor(elapsed / (7 * DAY)),
        "week",
        narrow,
      );
    else
      label = formatDate(date, {
        month: "short",
        day: "numeric",
        ...(date.getFullYear() !== new Date().getFullYear()
          ? { year: "numeric" }
          : {}),
      });
    return { label, title };
  };
}

/**
 * The outlined "Agent" pill beside an author name. Its tooltip carries the
 * accountable person and the submission channel, because an agent comment is
 * posted on someone's behalf rather than by an independent account.
 */
export function CommentAgentBadge({
  details,
  ariaLabel,
}: {
  details: ReactNode;
  ariaLabel: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
          className="pointer-events-auto inline-flex h-5 shrink-0 items-center rounded-md border border-border bg-background px-1.5 text-xs font-medium leading-none text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-comment-agent-badge
        >
          {t("comments.agentBadge")}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" sideOffset={6}>
        {details}
      </TooltipContent>
    </Tooltip>
  );
}

/** Round, quiet icon button used for every comment header action. */
export const CommentIconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function CommentIconButton({ className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
});

/**
 * One comment: avatar, author line, body, and an optional footer for
 * reactions, AI progress, or save status. `actions` sits at the end of the
 * author line; `revealActions="hover"` keeps reply rows quiet until focused.
 *
 * The author line wraps instead of clipping: the name keeps the first line and
 * the badge, time, and status move below it when the column is too narrow.
 * Hover-revealed actions keep their width while hidden, because a header that
 * re-wraps on hover changes the card height the margin rail stacks by.
 */
export function CommentRow({
  avatar,
  name,
  badge,
  timestamp,
  status,
  actions,
  revealActions = "always",
  children,
  footer,
  className,
  headerClassName,
  ...rest
}: {
  avatar: ReactNode;
  name: ReactNode;
  badge?: ReactNode;
  timestamp?: { label: string; title: string; dateTime?: string };
  status?: ReactNode;
  actions?: ReactNode;
  revealActions?: "always" | "hover";
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerClassName?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  return (
    <div className={cn("group/comment flex gap-2.5", className)} {...rest}>
      <div className="flex h-7 w-7 shrink-0 items-center">{avatar}</div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "flex min-h-7 min-w-0 items-start gap-1.5",
            headerClassName,
          )}
        >
          <div
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 py-1"
            data-comment-row-identity
          >
            <span className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground">
              {name}
            </span>
            {badge}
            {timestamp?.label ? (
              <time
                className="min-w-0 truncate whitespace-nowrap text-sm text-muted-foreground"
                title={timestamp.title}
                dateTime={timestamp.dateTime}
              >
                {timestamp.label}
              </time>
            ) : null}
            {status ? (
              <span className="flex min-w-0 gap-1 truncate text-xs text-muted-foreground">
                {status}
              </span>
            ) : null}
          </div>
          {actions ? (
            <div
              className={cn(
                "-me-1 flex shrink-0 items-center gap-0.5",
                revealActions === "hover" &&
                  "invisible focus-within:visible group-hover/comment:visible group-focus-within/comment:visible has-[[data-state=open]]:visible pointer-coarse:visible",
              )}
              data-comment-row-actions
            >
              {actions}
            </div>
          ) : null}
        </div>
        {children !== undefined && children !== null ? (
          <div className="min-w-0 break-words text-sm leading-normal text-foreground">
            {children}
          </div>
        ) : null}
        {footer ? <div className="mt-1.5 min-w-0">{footer}</div> : null}
      </div>
    </div>
  );
}
