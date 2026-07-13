import {
  IconAlertCircle,
  IconChevronDown,
  IconNotes,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEffect, useRef, useState } from "react";

import { resolveDesktopMeetingJoinUrl } from "../lib/meeting-join-url";
import {
  detectMeetingJoinProvider,
  joinProviderLabel,
  meetingNotificationAutoHideMs,
  type MeetingJoinProvider,
} from "../lib/meeting-notification-timing";

interface NotificationData {
  type: "calendar" | "adhoc";
  title: string;
  subtitle: string;
  meetingId: string;
  joinUrl?: string | null;
  platform?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  autoStart?: boolean;
}

interface TranscriptionStatusPayload {
  meetingId: string;
  error?: string;
}

const SNOOZE_MS = 5 * 60_000;
const FALLBACK_AUTO_HIDE_MS = 6 * 60_000;
// Card is up to 440px wide; the extra width leaves room for the drop shadow
// (~32px each side) so it isn't clipped by the transparent window edges.
const NOTIFICATION_WINDOW_WIDTH = 504;
const NOTIFICATION_COLLAPSED_HEIGHT = 120;
const NOTIFICATION_MENU_HEIGHT = 224;

/**
 * Open a meeting join URL via its native desktop app when supported.
 */
async function openJoinUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;
  try {
    await openExternal(resolveDesktopMeetingJoinUrl(url));
  } catch (err) {
    console.error("[clips-tray] openJoinUrl failed:", err);
  }
}

function resizeNotificationWindow(expanded: boolean) {
  const height = expanded
    ? NOTIFICATION_MENU_HEIGHT
    : NOTIFICATION_COLLAPSED_HEIGHT;
  getCurrentWindow()
    .setSize(new LogicalSize(NOTIFICATION_WINDOW_WIDTH, height))
    .catch((err) => {
      console.warn("[clips-meeting-notif] resize failed", err);
    });
}

function ProviderGlyph({ provider }: { provider: MeetingJoinProvider }) {
  // Lightweight glyphs — keep the overlay free of extra assets. Zoom blue
  // camera / Meet green / Teams purple, otherwise a generic video icon.
  if (provider === "zoom") {
    return (
      <span
        className="meeting-notification-provider meeting-notification-provider-zoom"
        aria-hidden
      >
        <IconVideo size={14} stroke={2.2} />
      </span>
    );
  }
  if (provider === "meet") {
    return (
      <span
        className="meeting-notification-provider meeting-notification-provider-meet"
        aria-hidden
      >
        <IconVideo size={14} stroke={2.2} />
      </span>
    );
  }
  if (provider === "teams") {
    return (
      <span
        className="meeting-notification-provider meeting-notification-provider-teams"
        aria-hidden
      >
        <IconVideo size={14} stroke={2.2} />
      </span>
    );
  }
  return (
    <span
      className="meeting-notification-provider meeting-notification-provider-other"
      aria-hidden
    >
      <IconNotes size={14} stroke={2.2} />
    </span>
  );
}

/**
 * Granola-style meeting notification — small card in the top-right corner.
 *
 * Primary split button: join the call and open Clips notes in one click.
 * Chevron exposes secondary actions (join only / notes only / snooze).
 *
 * Data arrives via Tauri event `meetings:show-notification`. Visibility holds
 * from 1 minute before start until 5 minutes after, unless dismissed.
 */
export function MeetingNotification() {
  const [data, setData] = useState<NotificationData | null>(null);
  const [showClose, setShowClose] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef<NotificationData | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    resizeNotificationWindow(Boolean(data && menuOpen));
  }, [data, menuOpen]);

  useEffect(() => {
    return () => resizeNotificationWindow(false);
  }, []);

  useEffect(() => {
    const win = getCurrentWindow();
    if (data) {
      win.show().catch(() => {});
    } else {
      win.hide().catch(() => {});
    }
  }, [data]);

  function showNotification(
    payload: NotificationData,
    options?: { hydrated?: boolean },
  ) {
    setData(payload);
    setError(null);
    setMenuOpen(false);
    setPending(!!payload.autoStart && !options?.hydrated);
    const startMs = payload.scheduledStart
      ? Date.parse(payload.scheduledStart)
      : NaN;
    const hideMs = Number.isFinite(startMs)
      ? meetingNotificationAutoHideMs(startMs)
      : FALLBACK_AUTO_HIDE_MS;
    scheduleAutoHide(hideMs);
  }

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let stopped = false;

    const trackListen = (p: Promise<() => void>) => {
      p.then((u) => {
        if (stopped) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {});
    };

    trackListen(
      listen<NotificationData>("meetings:show-notification", (ev) => {
        showNotification(ev.payload);
      }),
    );

    // Cold overlay boot: hydrate any payload stored before this webview
    // mounted (calendar or adhoc).
    invoke<NotificationData | null>("take_pending_meeting_notification")
      .then((pending) => {
        if (stopped || !pending) return;
        showNotification(pending, { hydrated: true });
      })
      .catch(() => {});

    trackListen(
      listen<TranscriptionStatusPayload>("meetings:hide-notification", (ev) => {
        if (ev.payload.meetingId !== dataRef.current?.meetingId) return;
        hideNotification();
      }),
    );
    trackListen(
      listen<TranscriptionStatusPayload>(
        "meetings:transcription-error",
        (ev) => {
          if (ev.payload.meetingId !== dataRef.current?.meetingId) return;
          setPending(false);
          setError(ev.payload.error || "Could not start notes.");
          scheduleAutoHide(15_000);
        },
      ),
    );

    return () => {
      stopped = true;
      clearAutoHide();
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      unlistens.length = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearAutoHide() {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  }

  function scheduleAutoHide(ms: number) {
    clearAutoHide();
    if (ms <= 0) {
      hideNotification();
      return;
    }
    autoHideTimerRef.current = setTimeout(() => hideNotification(), ms);
  }

  function resumeAutoHide() {
    const current = dataRef.current;
    const startMs = current?.scheduledStart
      ? Date.parse(current.scheduledStart)
      : NaN;
    const hideMs = Number.isFinite(startMs)
      ? meetingNotificationAutoHideMs(startMs)
      : FALLBACK_AUTO_HIDE_MS;
    scheduleAutoHide(hideMs);
  }

  function hideNotification() {
    clearAutoHide();
    setData(null);
    setError(null);
    setPending(false);
    setMenuOpen(false);
    dataRef.current = null;
  }

  async function takeNotes() {
    if (!data || pending) return;
    setPending(true);
    setError(null);
    setMenuOpen(false);
    emit("meetings:start-transcription", {
      meetingId: data.meetingId,
      joinUrl: data.joinUrl,
      reason: "user",
    }).catch((err) => {
      setPending(false);
      setError((err as Error)?.message ?? "Could not start notes.");
    });
  }

  async function joinMeeting() {
    if (!data?.joinUrl) return;
    setMenuOpen(false);
    await openJoinUrl(data.joinUrl);
  }

  /** Granola primary: join the call and start Clips notes together. */
  async function joinAndOpenClips() {
    if (!data || pending) return;
    setMenuOpen(false);
    if (data.joinUrl) {
      await openJoinUrl(data.joinUrl);
    }
    await takeNotes();
  }

  function snooze() {
    if (!data) return;
    setMenuOpen(false);
    invoke("meetings_snooze", {
      meetingId: data.meetingId,
      minutes: Math.round(SNOOZE_MS / 60_000),
    }).catch(() => {});
    hideNotification();
  }

  if (!data) {
    return <div className="meeting-notification-root" />;
  }

  const isCalendar = data.type === "calendar";
  const hasJoin = Boolean(data.joinUrl);
  const provider = detectMeetingJoinProvider(data.joinUrl, data.platform);
  const providerName = joinProviderLabel(provider);
  const primaryLabel = hasJoin
    ? provider === "other"
      ? "Join meeting"
      : `Join ${providerName}`
    : "Start notes";
  const secondaryLabel = hasJoin ? "& open Clips" : null;

  return (
    <div className="meeting-notification-root">
      <div
        className="meeting-notification"
        onMouseEnter={() => {
          setShowClose(true);
          clearAutoHide();
        }}
        onMouseLeave={() => {
          setShowClose(false);
          setMenuOpen(false);
          resumeAutoHide();
        }}
      >
        <div
          className={`meeting-notification-bar ${isCalendar ? "meeting-notification-bar-calendar" : "meeting-notification-bar-adhoc"}`}
        />
        <div className="meeting-notification-content">
          <div className="meeting-notification-title">{data.title}</div>
          <div className="meeting-notification-subtitle">{data.subtitle}</div>
          {error ? (
            <div className="meeting-notification-error" role="alert">
              <IconAlertCircle size={12} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>
        <div className="meeting-notification-split">
          <button
            className="meeting-notification-split-main"
            onClick={hasJoin ? joinAndOpenClips : takeNotes}
            disabled={pending}
            data-no-drag
          >
            <ProviderGlyph provider={provider} />
            <span className="meeting-notification-split-copy">
              <span className="meeting-notification-split-primary">
                {pending ? "Starting…" : primaryLabel}
              </span>
              {secondaryLabel && !pending ? (
                <span className="meeting-notification-split-secondary">
                  {secondaryLabel}
                </span>
              ) : null}
            </span>
          </button>
          <button
            className="meeting-notification-split-chevron"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="More actions"
            aria-expanded={menuOpen}
            data-no-drag
          >
            <IconChevronDown size={14} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div className="meeting-notification-menu" role="menu">
              {hasJoin ? (
                <button
                  role="menuitem"
                  className="meeting-notification-menu-item"
                  onClick={joinMeeting}
                  data-no-drag
                >
                  Join only
                </button>
              ) : null}
              <button
                role="menuitem"
                className="meeting-notification-menu-item"
                onClick={takeNotes}
                disabled={pending}
                data-no-drag
              >
                Start notes only
              </button>
              <button
                role="menuitem"
                className="meeting-notification-menu-item"
                onClick={snooze}
                data-no-drag
              >
                Snooze 5 min
              </button>
            </div>
          ) : null}
        </div>
        {showClose ? (
          <button
            className="meeting-notification-close"
            onClick={hideNotification}
            aria-label="Dismiss"
            data-no-drag
          >
            <IconX size={10} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
