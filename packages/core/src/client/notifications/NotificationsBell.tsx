import React, { useCallback, useEffect, useRef, useState } from "react";
import { IconBell, IconBellRinging, IconLoader2 } from "@tabler/icons-react";
import { usePausingInterval } from "../use-pausing-interval.js";
import type {
  Notification as NotificationDto,
  NotificationSeverity,
} from "../../notifications/types.js";

interface NotificationsBellProps {
  /** Poll interval in ms. Set to 0 to disable polling. Default: 10000. */
  pollMs?: number;
  /** Optional className for the outer container. */
  className?: string;
  /**
   * When true, fires a system-level `new Notification(...)` popup for each
   * new unread notification — handy when the tab is in the background.
   * Renders an "Enable browser notifications" prompt in the dropdown until
   * the user grants permission. Silently no-ops on denied or unsupported.
   */
  browserNotifications?: boolean;
}

const POLL_MS_DEFAULT = 10_000;
const SUPPORTS_NOTIFICATION =
  typeof window !== "undefined" && "Notification" in window;

/**
 * Header-bar bell that shows the unread-notification count and a dropdown of
 * recent entries. Polling keeps it in sync (the framework poll loop already
 * bumps a version counter so notifications ride on that signal, but we poll
 * the count endpoint directly so the bell updates even outside an app-state
 * change).
 */
export function NotificationsBell({
  pollMs = POLL_MS_DEFAULT,
  className,
  browserNotifications = false,
}: NotificationsBellProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  // Init to "default" unconditionally so server and client render the same
  // HTML — reading Notification.permission at init would diverge between SSR
  // ("denied", no API) and hydration ("default"/"granted"), causing a mismatch
  // in templates that mount the bell outside a ClientOnly boundary. We sync
  // to the real value in a useEffect below.
  const [permission, setPermission] =
    useState<NotificationPermission>("default");

  useEffect(() => {
    if (SUPPORTS_NOTIFICATION) setPermission(Notification.permission);
  }, []);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Ids already popped as browser notifications. Seeded on first run so
  // existing unread don't pop retroactively on page load.
  const seenIdsRef = useRef<Set<string> | null>(null);

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/_agent-native/notifications?limit=20");
      if (!res.ok) return;
      const rows = (await res.json()) as NotificationDto[];
      setItems(rows);
    } catch {
      // best-effort
    }
  }, []);

  // One polling callback used by both paths. When browserNotifications is on
  // we fetch the unread list (source of truth for both the badge count AND
  // the popup loop — no second /count request), and pop Notification() for
  // any new ids. When off, we fetch just /count. The unread-list branch also
  // opts out of visibility pause so popups still fire for backgrounded tabs.
  const refresh = useCallback(async () => {
    if (browserNotifications) {
      try {
        const res = await fetch(
          "/_agent-native/notifications?unread=true&limit=20",
        );
        if (!res.ok) return;
        const rows = (await res.json()) as NotificationDto[];
        setUnreadCount(rows.length);
        // First run: treat everything as already seen so we don't pop
        // retroactively on page load. After that, rebuild from the current
        // unread list so ids for read/archived rows drop out — keeps the
        // set bounded to the unread fetch limit (~20).
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
            // Safari / restricted contexts may throw even when permission
            // claims to be granted — silent no-op.
          }
        }
        seenIdsRef.current = seen;
      } catch {
        // best-effort
      }
      return;
    }
    try {
      const res = await fetch("/_agent-native/notifications/count");
      if (!res.ok) return;
      const data = (await res.json()) as { count: number };
      setUnreadCount(data.count);
    } catch {
      // best-effort
    }
  }, [browserNotifications]);

  usePausingInterval(
    refresh,
    pollMs,
    /* pauseWhenHidden */ !browserNotifications,
  );

  useEffect(() => {
    if (!open) return;
    loadItems();
  }, [open, loadItems]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const markRead = async (id: string) => {
    try {
      await fetch(`/_agent-native/notifications/${id}/read`, {
        method: "POST",
      });
      setItems((prev) =>
        prev
          ? prev.map((n) =>
              n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
            )
          : prev,
      );
      refresh();
    } catch {
      // best-effort
    }
  };

  const markAllRead = async () => {
    try {
      await fetch(`/_agent-native/notifications/read-all`, { method: "POST" });
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

  const hasUnread = unreadCount > 0;
  const Icon = hasUnread ? IconBellRinging : IconBell;

  return (
    <div
      ref={menuRef}
      className={
        "an-notifications-bell relative inline-flex" +
        (className ? ` ${className}` : "")
      }
    >
      <button
        type="button"
        aria-label={
          hasUnread ? `${unreadCount} unread notifications` : "Notifications"
        }
        onClick={() => setOpen((v) => !v)}
        className="an-notifications-bell__trigger relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      >
        <Icon size={18} aria-hidden />
        {hasUnread ? (
          <span
            aria-hidden
            className="an-notifications-bell__badge absolute -right-0.5 -top-0.5 rounded-full bg-destructive px-1 text-[10px] leading-[14px] font-medium text-destructive-foreground"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="menu"
          className="an-notifications-bell__menu absolute right-0 top-full z-50 mt-2 w-80 rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
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
              items.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => (n.readAt ? undefined : markRead(n.id))}
                  className={
                    "flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-accent/40 " +
                    (n.readAt ? "opacity-60" : "")
                  }
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {n.title}
                    </span>
                    <SeverityBadge severity={n.severity} />
                  </div>
                  {n.body ? (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {n.body}
                    </span>
                  ) : null}
                  <span className="text-[10px] text-muted-foreground/70">
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                </button>
              ))
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                No notifications.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Severity color pairs — use /20 opacity backdrops that work against both
// light and dark theme backgrounds; text uses 700/300 so it stays readable
// in each mode (the `dark:` prefix is one of the few places where explicit
// variants are necessary since these are brand-color tokens, not semantic).
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
