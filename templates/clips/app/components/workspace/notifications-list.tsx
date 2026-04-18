import { Link } from "react-router";
import {
  IconMessage,
  IconMoodSmile,
  IconShare,
  IconAt,
  IconBell,
} from "@tabler/icons-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const delta = (now - d.getTime()) / 1000;
    if (delta < 60) return "just now";
    if (delta < 60 * 60) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 60 * 60 * 24) return `${Math.floor(delta / 3600)}h ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
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
  if (!items.length) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        <IconBell className="size-10 mx-auto mb-3 text-muted-foreground/50" />
        You're all caught up.
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
                {item.authorEmail ?? "Someone"}
              </span>
              <span className="text-muted-foreground">
                {labelFor(item.kind)}
              </span>
              <span className="text-muted-foreground truncate">
                {item.recordingTitle}
              </span>
              <span className="text-muted-foreground/70 ml-auto flex-shrink-0">
                {formatTime(item.createdAt)}
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
                View
              </Link>
              {item.kind === "comment" && onReply ? (
                <button
                  className="text-primary hover:underline"
                  onClick={() => onReply(item)}
                >
                  Reply
                </button>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function labelFor(kind: NotificationKind): string {
  switch (kind) {
    case "comment":
      return "commented on";
    case "reaction":
      return "reacted to";
    case "mention":
      return "mentioned you in";
    case "share":
      return "shared";
    default:
      return "";
  }
}
