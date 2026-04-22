import React, { useCallback, useEffect, useRef, useState } from "react";
import { IconBell, IconBellRinging, IconLoader2 } from "@tabler/icons-react";

interface NotificationDto {
  id: string;
  owner: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  deliveredChannels: string[];
  createdAt: string;
  readAt: string | null;
}

interface NotificationsBellProps {
  /** Poll interval in ms. Set to 0 to disable polling. Default: 10000. */
  pollMs?: number;
  /** Optional className for the outer container. */
  className?: string;
}

const POLL_MS_DEFAULT = 10_000;

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
}: NotificationsBellProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await fetch("/_agent-native/notifications/count");
      if (!res.ok) return;
      const data = (await res.json()) as { count: number };
      setUnreadCount(data.count);
    } catch {
      // best-effort
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/_agent-native/notifications?limit=20");
      if (!res.ok) return;
      const rows = (await res.json()) as NotificationDto[];
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCount();
    if (pollMs <= 0) return;
    const id = window.setInterval(refreshCount, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, refreshCount]);

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
      refreshCount();
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
        className="an-notifications-bell__trigger relative inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-black/5"
      >
        <Icon size={18} aria-hidden />
        {hasUnread ? (
          <span
            aria-hidden
            className="an-notifications-bell__badge absolute -right-0.5 -top-0.5 rounded-full bg-red-500 px-1 text-[10px] leading-[14px] text-white"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="menu"
          className="an-notifications-bell__menu absolute right-0 top-full z-50 mt-2 w-80 rounded-md border border-black/10 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-black/10 px-3 py-2 text-sm font-medium">
            <span>Notifications</span>
            {hasUnread ? (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-blue-600 hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && items === null ? (
              <div className="flex items-center gap-2 p-4 text-sm text-black/60">
                <IconLoader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : items && items.length > 0 ? (
              items.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => (n.readAt ? undefined : markRead(n.id))}
                  className={
                    "flex w-full flex-col items-start gap-0.5 border-b border-black/5 px-3 py-2 text-left last:border-b-0 hover:bg-black/5 " +
                    (n.readAt ? "opacity-60" : "")
                  }
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {n.title}
                    </span>
                    <SeverityBadge severity={n.severity} />
                  </div>
                  {n.body ? (
                    <span className="line-clamp-2 text-xs text-black/70">
                      {n.body}
                    </span>
                  ) : null}
                  <span className="text-[10px] text-black/50">
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                </button>
              ))
            ) : (
              <div className="p-4 text-sm text-black/60">No notifications.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: NotificationDto["severity"];
}) {
  const color =
    severity === "critical"
      ? "bg-red-100 text-red-800"
      : severity === "warning"
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-700";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {severity}
    </span>
  );
}
