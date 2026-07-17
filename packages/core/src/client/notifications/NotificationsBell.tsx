import {
  IconArrowLeft,
  IconBell,
  IconBellRinging,
  IconCheck,
  IconLoader2,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { PersonalNotificationRouting } from "../../notifications/routing.js";
import type {
  Notification as NotificationDto,
  NotificationSeverity,
} from "../../notifications/types.js";
import { appPath } from "../api-path.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { usePausingInterval } from "../use-pausing-interval.js";
import {
  countClientUnreadNotifications,
  dismissClientNotification,
  getPersonalNotificationRouting,
  listClientNotifications,
  markAllClientNotificationsRead,
  markClientNotificationRead,
  updatePersonalNotificationRouting,
} from "./api.js";

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
  /** Empty-state title shown when there are no notifications. */
  emptyTitle?: string;
  /** Optional empty-state detail text. */
  emptyDescription?: string;
  /** Optional notification for parent shells that need to coordinate overlays. */
  onOpenChange?: (open: boolean) => void;
  /** Optional host-rendered settings for the resource currently in view. */
  contextualSettings?: ReactNode;
}

const POLL_MS_DEFAULT = 10_000;
const SUPPORTS_NOTIFICATION =
  typeof window !== "undefined" && "Notification" in window;
const DEFAULT_ROUTING: PersonalNotificationRouting = {
  inbox: true,
  browser: true,
  email: false,
  personalSlack: false,
  personalSlackWebhookKey: null,
};

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
  emptyTitle = "No app notifications yet.",
  emptyDescription,
  onOpenChange,
  contextualSettings,
}: NotificationsBellProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [routing, setRouting] =
    useState<PersonalNotificationRouting>(DEFAULT_ROUTING);
  const [routingDraft, setRoutingDraft] =
    useState<PersonalNotificationRouting>(DEFAULT_ROUTING);
  const [showRouting, setShowRouting] = useState(false);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);
  // Init to "default" unconditionally so server and client render the same
  // HTML — reading Notification.permission at init would diverge between SSR
  // ("denied", no API) and hydration ("default"/"granted"), causing a mismatch
  // in templates that mount the bell outside a ClientOnly boundary. We sync
  // to the real value in a useEffect below.
  const [permission, setPermission] =
    useState<NotificationPermission>("default");

  useEffect(() => {
    if (SUPPORTS_NOTIFICATION) setPermission(Notification.permission);
    getPersonalNotificationRouting()
      .then((next) => {
        setRouting(next);
        setRoutingDraft(next);
      })
      .catch(() => {});
  }, []);
  // Ids already popped as browser notifications. Seeded on first run so
  // existing unread don't pop retroactively on page load.
  const seenIdsRef = useRef<Set<string> | null>(null);

  const loadItems = useCallback(async () => {
    try {
      const rows = await listClientNotifications({ limit: 20 });
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
    if (browserNotifications && routing.browser) {
      try {
        const rows = await listClientNotifications({
          unreadOnly: true,
          limit: 20,
        });
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
      setUnreadCount(await countClientUnreadNotifications());
    } catch {
      // best-effort
    }
  }, [browserNotifications, routing.browser]);

  usePausingInterval(
    refresh,
    pollMs,
    /* pauseWhenHidden */ !browserNotifications,
  );

  useEffect(() => {
    if (!open) return;
    loadItems();
  }, [open, loadItems]);

  const markRead = async (id: string) => {
    try {
      // `keepalive: true` lets the request survive page navigation —
      // without it, clicking a notification with a link aborts this
      // request mid-flight and the row stays unread.
      await markClientNotificationRead(id);
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

  // Reject any URL that isn't http(s) or a same-origin relative path. Blocks
  // `javascript:` execution, `data:` URIs, and absolute redirects to phishing
  // sites. Relative paths starting with `/` are routed through `appPath()` so
  // the link works in mounted deployments (e.g. /mail subdirectory).
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
      await markAllClientNotificationsRead();
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
      await dismissClientNotification(id);
      setItems((prev) => (prev ? prev.filter((n) => n.id !== id) : prev));
      refresh();
    } catch {
      // best-effort
    }
  };

  const hasUnread = unreadCount > 0;
  const Icon = hasUnread ? IconBellRinging : IconBell;
  const setOpenAndNotify = (value: boolean) => {
    setOpen(value);
    if (!value) {
      setShowRouting(false);
      setRoutingDraft(routing);
      setRoutingError(null);
    }
    onOpenChange?.(value);
  };

  const saveRouting = async () => {
    setRoutingSaving(true);
    setRoutingError(null);
    try {
      const saved = await updatePersonalNotificationRouting(routingDraft);
      setRouting(saved);
      setRoutingDraft(saved);
      setShowRouting(false);
    } catch (error) {
      setRoutingError(
        error instanceof Error ? error.message : "Could not save routing.",
      );
    } finally {
      setRoutingSaving(false);
    }
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
          <div className="flex min-w-0 items-center gap-1.5">
            {showRouting ? (
              <button
                type="button"
                aria-label="Back to notifications"
                onClick={() => {
                  setShowRouting(false);
                  setRoutingDraft(routing);
                  setRoutingError(null);
                }}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <IconArrowLeft size={14} aria-hidden />
              </button>
            ) : null}
            <span>{showRouting ? "Delivery settings" : "Notifications"}</span>
          </div>
          {!showRouting ? (
            <div className="flex items-center gap-1.5">
              {hasUnread ? (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-xs text-primary hover:underline"
                >
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Notification delivery settings"
                onClick={() => {
                  setRoutingDraft(routing);
                  setShowRouting(true);
                }}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <IconSettings size={14} aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
        {showRouting ? (
          <NotificationRoutingEditor
            value={routingDraft}
            saving={routingSaving}
            error={routingError}
            onChange={setRoutingDraft}
            onSave={() => void saveRouting()}
          />
        ) : (
          <>
            {browserNotifications &&
            routing.browser &&
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
                    typeof n.metadata?.link === "string"
                      ? n.metadata.link
                      : null;
                  const link = rawLink ? safeNotificationLink(rawLink) : null;
                  const onItemClick = () => {
                    if (!n.readAt) void markRead(n.id);
                    if (link) {
                      setOpenAndNotify(false);
                      window.location.assign(link);
                    }
                  };
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
                        className={
                          "flex w-full flex-col items-start gap-0.5 px-3 py-2 pe-8 text-start" +
                          (link ? " cursor-pointer" : "")
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
            {contextualSettings ? (
              <div className="border-t border-border">{contextualSettings}</div>
            ) : null}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationRoutingEditor({
  value,
  saving,
  error,
  onChange,
  onSave,
}: {
  value: PersonalNotificationRouting;
  saving: boolean;
  error: string | null;
  onChange: (value: PersonalNotificationRouting) => void;
  onSave: () => void;
}) {
  const slackKeyMissing =
    value.personalSlack && !value.personalSlackWebhookKey?.trim();
  return (
    <div className="flex max-h-[28rem] flex-col">
      <div className="overflow-y-auto p-3">
        <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
          Choose where notifications meant for you should arrive.
        </p>
        <div className="divide-y divide-border">
          <RoutingToggle
            label="In-app inbox"
            description="Bell, unread count, and notification history"
            checked={value.inbox}
            onCheckedChange={(inbox) =>
              onChange({
                ...value,
                inbox,
                browser: inbox ? value.browser : false,
              })
            }
          />
          <RoutingToggle
            label="Browser alerts"
            description={
              value.inbox
                ? "System popups when this app is in the background"
                : "Requires the in-app inbox"
            }
            checked={value.browser}
            disabled={!value.inbox}
            onCheckedChange={(browser) => onChange({ ...value, browser })}
          />
          <RoutingToggle
            label="Email"
            description="Send to your signed-in email address"
            checked={value.email}
            onCheckedChange={(email) => onChange({ ...value, email })}
          />
          <div>
            <RoutingToggle
              label="Personal Slack"
              description="Your private destination, separate from team-channel hooks"
              checked={value.personalSlack}
              onCheckedChange={(personalSlack) =>
                onChange({ ...value, personalSlack })
              }
            />
            {value.personalSlack ? (
              <div className="pb-3 ps-0.5">
                <label
                  htmlFor="personal-slack-webhook-key"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Webhook secret key name
                </label>
                <input
                  id="personal-slack-webhook-key"
                  value={value.personalSlackWebhookKey ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      personalSlackWebhookKey:
                        event.currentTarget.value.toUpperCase() || null,
                    })
                  }
                  placeholder="PERSONAL_SLACK_WEBHOOK"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={slackKeyMissing}
                  aria-describedby="personal-slack-webhook-key-help"
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
                />
                <p
                  id="personal-slack-webhook-key-help"
                  className="mt-1 text-[11px] leading-relaxed text-muted-foreground"
                >
                  Enter only the key name. Store its webhook URL in Secrets.
                </p>
              </div>
            ) : null}
          </div>
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-2 text-xs leading-relaxed text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-end border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || slackKeyMissing}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {saving ? (
            <IconLoader2 size={13} className="animate-spin" aria-hidden />
          ) : (
            <IconCheck size={13} aria-hidden />
          )}
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function RoutingToggle({
  label,
  description,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ease-out disabled:opacity-40 ${
          checked ? "bg-primary" : "bg-muted-foreground/30"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-transform duration-150 ease-out ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
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
