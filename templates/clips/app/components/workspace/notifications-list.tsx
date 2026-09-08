import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { InlineMarkdown } from "@agent-native/core/client/markdown";
import {
  IconMessage,
  IconMoodSmile,
  IconShare,
  IconAt,
  IconBell,
} from "@tabler/icons-react";
import { Link } from "react-router";

import { ClipsAvatar } from "@/components/clips-avatar";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export type NotificationKind = "comment" | "reaction" | "mention" | "share";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  recordingId: string;
  recordingTitle: string;
  authorEmail: string | null;
  authorName: string | null;
  preview: string;
  createdAt: string;
}

interface NotificationsListProps {
  items: NotificationItem[];
  onReply?: (item: NotificationItem) => void;
}

function initials(nameOrEmail: string | null): string {
  if (!nameOrEmail) return "??";
  return nameOrEmail
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function KindIcon({ kind }: { kind: NotificationKind }) {
  const base = "size-4";
  if (kind === "comment")
    return <IconMessage className={`${base} text-blue-500`} />;
  if (kind === "reaction")
    return <IconMoodSmile className={`${base} text-amber-500`} />;
  if (kind === "mention") return <IconAt className={`${base} text-primary`} />;
  if (kind === "share")
    return <IconShare className={`${base} text-green-500`} />;
  return <IconBell className={`${base} text-muted-foreground`} />;
}

export function NotificationsList({ items, onReply }: NotificationsListProps) {
  const t = useT();
  const formatters = useFormatters();
  const formatDate = (date: Date) => formatters.formatDate(date);
  const formatRelativeTime = (
    value: number,
    unit: Parameters<typeof formatters.formatRelativeTime>[1],
  ) => formatters.formatRelativeTime(value, unit);
  if (!items.length) {
    return (
      <Empty className="gap-3 rounded-none py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconBell />
          </EmptyMedia>
          <EmptyTitle className="text-sm font-medium text-muted-foreground">
            {t("clipsFinalRaw.allCaughtUp")}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="divide-y">
      {items.map((item) => {
        const displayName =
          item.authorName?.trim() ||
          item.authorEmail ||
          t("clipsFinalRaw.someone");
        return (
          <li key={item.id} className="flex items-start gap-3 py-3">
            <ClipsAvatar
              email={item.authorEmail}
              alt={displayName}
              fallback={initials(displayName)}
              className="h-9 w-9 flex-shrink-0"
              fallbackClassName="text-xs bg-primary text-primary-foreground"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm">
                <KindIcon kind={item.kind} />
                <span className="truncate font-medium">{displayName}</span>
                {displayName !== item.authorEmail && item.authorEmail ? (
                  <span className="truncate text-muted-foreground">
                    {item.authorEmail}
                  </span>
                ) : null}
                <span className="text-muted-foreground">
                  {labelFor(item.kind, t)}
                </span>
                <span className="truncate text-muted-foreground">
                  {item.recordingTitle}
                </span>
                <span className="ml-auto flex-shrink-0 text-muted-foreground/70">
                  {formatNotificationTime(
                    item.createdAt,
                    formatDate,
                    formatRelativeTime,
                  )}
                </span>
              </div>
              {item.preview ? (
                item.kind === "comment" || item.kind === "mention" ? (
                  <InlineMarkdown
                    content={item.preview}
                    className="mt-1 line-clamp-2 text-sm text-muted-foreground"
                  />
                ) : (
                  <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {item.preview}
                  </div>
                )
              ) : null}
              <div className="mt-1.5 flex items-center gap-3 text-xs">
                <Link
                  to={`/r/${item.recordingId}`}
                  className="text-primary hover:underline"
                >
                  {t("clipsFinalRaw.view")}
                </Link>
                {item.kind === "comment" && onReply ? (
                  <button
                    className="text-primary hover:underline"
                    onClick={() => onReply(item)}
                  >
                    {t("clipsFinalRaw.reply")}
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function labelFor(kind: NotificationKind, t: ReturnType<typeof useT>): string {
  switch (kind) {
    case "comment":
      return t("clipsFinalRaw.commentedOn");
    case "reaction":
      return t("clipsFinalRaw.reactedTo");
    case "mention":
      return t("clipsFinalRaw.mentionedYouIn");
    case "share":
      return t("clipsFinalRaw.shared");
    default:
      return "";
  }
}

function formatNotificationTime(
  iso: string,
  formatDate: ReturnType<typeof useFormatters>["formatDate"],
  formatRelativeTime: ReturnType<typeof useFormatters>["formatRelativeTime"],
): string {
  try {
    const date = new Date(iso);
    const delta = (date.getTime() - Date.now()) / 1000;
    const abs = Math.abs(delta);
    if (abs < 60) return formatRelativeTime(Math.round(delta), "second");
    if (abs < 3600) return formatRelativeTime(Math.round(delta / 60), "minute");
    if (abs < 86400)
      return formatRelativeTime(Math.round(delta / 3600), "hour");
    return formatDate(date);
  } catch {
    return iso;
  }
}
