import {
  IconBell,
  IconBellOff,
  IconCheck,
  IconChevronDown,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { useState } from "react";

import { getCachedDateTimeFormat } from "@/lib/intl-cache";

import { Popover } from "./Popover";
import type {
  WorkspaceShellNotification,
  WorkspaceShellNotifications,
} from "./types";

type NotificationFilter = "all" | "unread";

const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function formatNotificationTime(label: string): {
  text: string;
  title?: string;
} {
  const trimmed = label.trim();
  if (!ISO_TIMESTAMP_RE.test(trimmed)) return { text: label };
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return { text: label };
  return {
    text: getCachedDateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(parsed)),
    title: trimmed,
  };
}

function NotificationRows({
  items,
  onOpenNotification,
}: {
  items: readonly WorkspaceShellNotification[];
  onOpenNotification:
    | ((notification: WorkspaceShellNotification) => void | Promise<void>)
    | undefined;
}) {
  return (
    <div className="ws-notification-list">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="ws-notification-row"
          disabled={!onOpenNotification}
          title={
            onOpenNotification
              ? undefined
              : "Opening notifications is not connected."
          }
          onClick={() => {
            void onOpenNotification?.(item);
          }}
        >
          <span
            className={`ws-notification-dot${item.read ? " is-read" : ""}`}
            aria-hidden="true"
          />
          <span className="ws-notification-body">
            <span className="ws-notification-title">{item.title}</span>
            {item.description ? (
              <span className="ws-notification-description">
                {item.description}
              </span>
            ) : null}
          </span>
          {item.createdAtLabel
            ? (() => {
                const formatted = formatNotificationTime(item.createdAtLabel);
                return (
                  <span
                    className="ws-notification-time"
                    title={formatted.title}
                  >
                    {formatted.text}
                  </span>
                );
              })()
            : null}
        </button>
      ))}
    </div>
  );
}

export function NotificationsMenu({
  notifications,
}: {
  notifications?: WorkspaceShellNotifications | undefined;
}) {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);

  const status = notifications?.status ?? "unbound";
  const ready = notifications?.status === "ready" ? notifications : undefined;
  const loading =
    notifications?.status === "loading" ? notifications : undefined;
  const failed = notifications?.status === "error" ? notifications : undefined;
  const unreadCount = ready
    ? (ready.unreadCount ?? ready.items.filter((item) => !item.read).length)
    : loading
      ? (loading.unreadCount ?? 0)
      : 0;
  const items = ready ? ready.items : [];
  const filteredItems =
    filter === "unread" ? items.filter((item) => !item.read) : items;
  const canMarkAllRead =
    ready !== undefined &&
    unreadCount > 0 &&
    !ready.pending &&
    Boolean(ready.onMarkAllRead);

  return (
    <Popover
      label="Notifications"
      role="dialog"
      minWidth={320}
      className="ws-notifications"
      trigger={(triggerProps) => (
        <button
          type="button"
          className="ws-icon-button ws-bell-button"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
          title="Notifications"
          {...triggerProps}
        >
          <IconBell size={16} aria-hidden="true" />
          {unreadCount > 0 ? (
            <span className="ws-bell-badge" aria-hidden="true">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      )}
    >
      <div
        className="ws-notifications-header"
        aria-busy={ready?.pending === true}
      >
        <h5 className="ws-notifications-title">Notifications</h5>
        <div className="ws-notifications-controls">
          <div className="ws-filter">
            <button
              type="button"
              className="ws-filter-button"
              aria-expanded={filterOpen}
              aria-haspopup="menu"
              onClick={() => setFilterOpen((value) => !value)}
            >
              {filter === "all" ? "All notifications" : "Unread only"}
              <IconChevronDown size={12} aria-hidden="true" />
            </button>
            {filterOpen ? (
              <div className="ws-filter-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={`ws-menu-item${filter === "all" ? " is-active" : ""}`}
                  onClick={() => {
                    setFilter("all");
                    setFilterOpen(false);
                  }}
                >
                  <span className="ws-menu-label">All notifications</span>
                  {filter === "all" ? (
                    <span className="ws-menu-trailing">
                      <IconCheck size={16} />
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`ws-menu-item${filter === "unread" ? " is-active" : ""}`}
                  onClick={() => {
                    setFilter("unread");
                    setFilterOpen(false);
                  }}
                >
                  <span className="ws-menu-label">Unread only</span>
                  {filter === "unread" ? (
                    <span className="ws-menu-trailing">
                      <IconCheck size={16} />
                    </span>
                  ) : null}
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="ws-notifications-mark"
            disabled={!canMarkAllRead}
            title={
              ready !== undefined && unreadCount > 0 && !ready.onMarkAllRead
                ? "Marking notifications read is not connected."
                : undefined
            }
            onClick={() => {
              void ready?.onMarkAllRead?.();
            }}
          >
            Mark all as read
          </button>
        </div>
      </div>
      {status === "unbound" ? (
        <div className="ws-notifications-empty">
          <IconBellOff size={24} aria-hidden="true" />
          <h4>Notifications are not connected.</h4>
          <p>Notification data has not been provided to this shell.</p>
        </div>
      ) : status === "loading" ? (
        <div className="ws-notifications-empty" aria-busy="true">
          <IconLoader2 className="ws-spinner" size={24} aria-hidden="true" />
          <p>Loading notifications...</p>
        </div>
      ) : status === "error" ? (
        <div className="ws-notifications-empty">
          <h4>Notifications could not be loaded.</h4>
          <p>{failed?.errorMessage ?? "Try again in a moment."}</p>
          {failed?.onRetry ? (
            <button
              type="button"
              className="ws-notifications-retry"
              onClick={() => {
                void failed.onRetry?.();
              }}
            >
              <IconRefresh size={14} aria-hidden="true" />
              Retry
            </button>
          ) : null}
        </div>
      ) : filteredItems.length > 0 ? (
        <NotificationRows
          items={filteredItems}
          onOpenNotification={ready?.onOpenNotification}
        />
      ) : filter === "unread" ? (
        <div className="ws-notifications-empty">
          <h4>All caught up</h4>
          <p>No unread notifications.</p>
        </div>
      ) : (
        <div className="ws-notifications-empty">
          <h4>Your notifications</h4>
          <div>
            <p>Get notified about comments, scheduled runs, and more.</p>
            <p>New notifications will show up here!</p>
          </div>
        </div>
      )}
    </Popover>
  );
}
