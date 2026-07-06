import { useFormatters, useT } from "@agent-native/core/client";
import { Avatar, AvatarFallback } from "@agent-native/toolkit/ui/avatar";
import {
  IconMessage,
  IconMoodSmile,
  IconShare,
  IconAt,
  IconBell,
} from "@tabler/icons-react";
import { Link } from "react-router";

export type NotificationKind = "comment" | "reaction" | "mention" | "share";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  recordingId: string;
  recordingTitle: string;
  authorEmail: string | null;
  preview: string;
  createdAt: string;
}

interface NotificationsListProps {
  items: NotificationItem[];
  onReply?: (item: NotificationItem) => void;
}

function initials(email: string | null): string {
  if (!email) return "??";
  const [name] = email.split("@");
  return (name || email).slice(0, 2).toUpperCase();
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
  const { formatDate, formatRelativeTime } = useFormatters();
  if (!items.length) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        <IconBell className="size-10 mx-auto mb-3 text-muted-foreground/50" />
        {t("clipsFinalRaw.allCaughtUp")}
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li key={item.id} className="py-3 flex items-start gap-3">
          <Avatar className="h-9 w-9 flex-shrink-0">
            <AvatarFallback className="text-xs bg-primary text-primary-foreground">
              {initials(item.authorEmail)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm">
              <KindIcon kind={item.kind} />
              <span className="font-medium truncate">
                {item.authorEmail ?? t("clipsFinalRaw.someone")}
              </span>
              <span className="text-muted-foreground">
                {labelFor(item.kind, t)}
              </span>
              <span className="text-muted-foreground truncate">
                {item.recordingTitle}
              </span>
              <span className="text-muted-foreground/70 ml-auto flex-shrink-0">
                {formatNotificationTime(
                  item.createdAt,
                  formatDate,
                  formatRelativeTime,
                )}
              </span>
            </div>
            {item.preview ? (
              <div className="mt-1 text-sm text-muted-foreground line-clamp-2">
                {item.preview}
              </div>
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
      ))}
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
