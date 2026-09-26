import {
  IconBell,
  IconBellRinging,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  Notification as NotificationDto,
  NotificationSeverity,
} from "../../notifications/types.js";
import { agentNativePath, appPath } from "../api-path.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { usePollLoop } from "../use-poll-loop.js";

interface NotificationsBellProps {
  pollMs?: number;
  className?: string;
  browserNotifications?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onOpenChange?: (open: boolean) => void;
}

const POLL_MS_DEFAULT = 10_000;
const SUPPORTS_NOTIFICATION =
  typeof window !== "undefined" && "Notification" in window;

export function NotificationsBell({
  pollMs = POLL_MS_DEFAULT,
  className,
  browserNotifications = false,
  emptyTitle = "No app notifications yet.",
  emptyDescription,
  onOpenChange,
}: NotificationsBellProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // HTML — reading Notification.permission at init would diverge between SSR
  const [permission, setPermission] =
    useState<NotificationPermission>("default");

  useEffect(() => {
    if (SUPPORTS_NOTIFICATION) setPermission(Notification.permission);
  }, []);
  const seenIdsRef = useRef<Set<string> | null>(null);

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/notifications?limit=20"),
      );
      if (!res.ok) return;
      const rows = (await res.json()) as NotificationDto[];
      setItems(rows);
    } catch {
      // best-effort
    }
  }, []);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (browserNotifications) {
        try {
          const res = await fetch(
            agentNativePath(
              "/_agent-native/notifications?unread=true&limit=20",
            ),
            { signal },
          );
          if (!res.ok) return;
          const rows = (await res.json()) as NotificationDto[];
          setUnreadCount(rows.length);
          const prev = seenIdsRef.current;
          const seen = new Set<string>();
          for (const n of rows) {
            const alreadySeen = prev?.has(n.id) ?? true;
            seen.add(n.id);
            if (alreadySeen) continue;
            if (!SUPPORTS_NOTIFICATION) continue;
            if (Notification.permission !== "granted") continue;
            try {
              new Notification(n.title, { body: n.body, tag: n.id });
            } catch {
              // coercion-ok: Safari / restricted contexts may throw even when
              // permission claims to be granted; one failed OS notification
              // must not abort the unread sweep around it.
            }
          }
          seenIdsRef.current = seen;
        } catch {
          // coercion-ok: the bell renders from the rows it already has; a
          // failed sweep is retried by the next poll tick.
        }
        return;
      }
      try {
        const res = await fetch(
          agentNativePath("/_agent-native/notifications/count"),
          { signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        setUnreadCount(data.count);
      } catch {
        // best-effort
      }
    },
    [browserNotifications],
  );

  usePollLoop(refresh, {
    intervalMs: pollMs,
    enabled: pollMs > 0,
    pauseWhenHidden: !browserNotifications,
  });

  useEffect(() => {
    if (!open) return;
    void loadItems();
  }, [open, loadItems]);

  const markRead = async (id: string) => {
    try {
      await fetch(agentNativePath(`/_agent-native/notifications/${id}/read`), {
        method: "POST",
        keepalive: true,
      });
      setItems((prev) =>
        prev
          ? prev.map((n) =>
              n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
            )
          : prev,
      );
      void refresh();
    } catch {
      // best-effort
    }
  };

  const safeNotificationLink = (link: string): string | null => {
    if (link.startsWith("/") && !link.startsWith("//")) {
      return appPath(link);
    }
    try {
      const url = new URL(link, window.location.origin);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.toString();
      }
    } catch {
      // fallthrough
    }
    return null;
  };

  const markAllRead = async () => {
    try {
      await fetch(agentNativePath(`/_agent-native/notifications/read-all`), {
        method: "POST",
      });
      setItems((prev) =>
        prev
          ? prev.map((n) =>
              n.readAt ? n : { ...n, readAt: new Date().toISOString() },
            )
          : prev,
      );
      setUnreadCount(0);
    } catch {
      // best-effort
    }
  };

  const dismiss = async (id: string) => {
    try {
      await fetch(agentNativePath(`/_agent-native/notifications/${id}`), {
        method: "DELETE",
      });
      setItems((prev) => (prev ? prev.filter((n) => n.id !== id) : prev));
      void refresh();
    } catch {
      // best-effort
    }
  };

  const hasUnread = unreadCount > 0;
  const Icon = hasUnread ? IconBellRinging : IconBell;
  const setOpenAndNotify = (value: boolean) => {
    setOpen(value);
    if (!value) setExpandedId(null);
    onOpenChange?.(value);
  };

  return (
    <Popover open={open} onOpenChange={setOpenAndNotify}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            hasUnread ? `${unreadCount} unread notifications` : "Notifications"
          }
          className={
            "an-notifications-bell__trigger relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground" +
            (className ? ` ${className}` : "")
          }
        >
          <Icon size={18} aria-hidden />
          {hasUnread ? (
            <span
              aria-hidden
              className="an-notifications-bell__badge absolute -end-0.5 -top-0.5 rounded-full bg-destructive px-1 text-[10px] leading-[14px] font-medium text-destructive-foreground"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="an-notifications-bell__menu w-80 p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm font-medium">
          <span>Notifications</span>
          {hasUnread ? (
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs text-primary hover:underline"
            >
              Mark all read
            </button>
          ) : null}
        </div>
        {browserNotifications &&
        SUPPORTS_NOTIFICATION &&
        permission === "default" ? (
          <div className="flex items-center justify-between gap-2 border-b border-border bg-accent/40 px-3 py-2 text-xs text-foreground">
            <span>Get a system popup for new notifications.</span>
            <button
              type="button"
              onClick={async () => {
                const result = await Notification.requestPermission();
                setPermission(result);
              }}
              className="shrink-0 rounded bg-primary px-2 py-0.5 font-medium text-primary-foreground hover:bg-primary/90"
            >
              Enable
            </button>
          </div>
        ) : null}
        <div className="max-h-96 overflow-y-auto">
          {items === null ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <IconLoader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : items.length > 0 ? (
            items.map((n) => {
              const rawLink =
                typeof n.metadata?.link === "string" ? n.metadata.link : null;
              const link = rawLink ? safeNotificationLink(rawLink) : null;
              const onItemClick = () => {
                if (!n.readAt) void markRead(n.id);
                if (link) {
                  setOpenAndNotify(false);
                  window.location.assign(link);
                } else {
                  setExpandedId((current) => (current === n.id ? null : n.id));
                }
              };
              const expanded = expandedId === n.id;
              return (
                <div
                  key={n.id}
                  className={
                    "group relative border-b border-border last:border-b-0 hover:bg-accent/40 " +
                    (n.readAt ? "opacity-60" : "")
                  }
                >
                  <button
                    type="button"
                    onClick={onItemClick}
                    aria-expanded={link ? undefined : expanded}
                    className={
                      "flex w-full flex-col items-start gap-0.5 px-3 py-2 pe-8 text-start" +
                      (link ? " cursor-pointer" : "")
                    }
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span
                        className={`${expanded ? "break-words" : "truncate"} text-sm font-medium text-foreground`}
                      >
                        {n.title}
                      </span>
                      <SeverityBadge severity={n.severity} />
                    </div>
                    {n.body ? (
                      <span
                        className={`${expanded ? "whitespace-pre-wrap break-words" : "line-clamp-2"} text-xs text-muted-foreground`}
                      >
                        {n.body}
                      </span>
                    ) : null}
                    <span className="text-[10px] text-muted-foreground/70">
                      {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="Dismiss notification"
                    onClick={(e) => {
                      e.stopPropagation();
                      void dismiss(n.id);
                    }}
                    className="absolute end-2 top-2 hidden rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground group-hover:flex"
                  >
                    <IconX size={12} />
                  </button>
                </div>
              );
            })
          ) : (
            <div className="space-y-1 p-4 text-sm">
              <p className="font-medium text-foreground">{emptyTitle}</p>
              {emptyDescription ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {emptyDescription}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SeverityBadge({ severity }: { severity: NotificationSeverity }) {
  const color =
    severity === "critical"
      ? "bg-red-500/20 text-red-700 dark:text-red-300"
      : severity === "warning"
        ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {severity}
    </span>
  );
}
