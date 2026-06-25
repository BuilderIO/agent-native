import { IconAlertCircle, IconClock, IconX } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEffect, useRef, useState } from "react";

interface NotificationData {
  type: "calendar" | "adhoc";
  title: string;
  subtitle: string;
  meetingId: string;
  joinUrl?: string | null;
  autoStart?: boolean;
}

interface TranscriptionStatusPayload {
  meetingId: string;
  error?: string;
}

const DEFAULT_AUTO_HIDE_MS = 30_000;
const SNOOZE_MS = 5 * 60_000;

/**
 * Open a meeting join URL via the Tauri shell plugin. Centralized here so
 * both the notification's "Take Notes" and the watcher's
 * `meetings:start-transcription` event use the same path.
 */
async function openJoinUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;
  try {
    await openExternal(url);
  } catch (err) {
    console.error("[clips-tray] openJoinUrl failed:", err);
  }
}

/**
 * Granola-style meeting notification — small card in the top-right corner.
 * Variants:
 *
 *   - Calendar event: solid left bar (green), meeting title, time,
 *     "Start notes" + "Snooze 5 min" buttons.
 *   - Ad-hoc call: dashed left bar (slate), "Call detected", app name,
 *     same controls.
 *
 * Data arrives via Tauri event `meetings:show-notification`. Auto-hides
 * after 30s by default. Hover pauses the auto-hide timer. Errors from the
 * persistent popover transcription session surface inline beneath the title
 * so the user isn't left wondering why nothing happened.
 */
export function MeetingNotification() {
  const [data, setData] = useState<NotificationData | null>(null);
  const [showClose, setShowClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef<NotificationData | null>(null);

  // Keep a ref to the latest data so the transcription-status listeners can
  // match incoming events against the meeting currently on screen without
  // re-subscribing on every render.
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // The notification window is a single persistent overlay (created once at
  // startup so it can receive `meetings:show-notification` events). Drive its
  // OS-level visibility from React state: a shown-but-empty transparent window
  // would otherwise sit at the top of the screen swallowing clicks. Visible
  // only while there's a notification on screen.
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
    setPending(!!payload.autoStart && !options?.hydrated);
    scheduleAutoHide(DEFAULT_AUTO_HIDE_MS);
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
    autoHideTimerRef.current = setTimeout(() => hideNotification(), ms);
  }

  function hideNotification() {
    clearAutoHide();
    setData(null);
    setError(null);
    setPending(false);
    dataRef.current = null;
  }

  async function takeNotes() {
    if (!data || pending) return;
    setPending(true);
    setError(null);
    // Open the join URL right away so the user feels the click — the
    // recording action runs in parallel.
    if (data.joinUrl) {
      openJoinUrl(data.joinUrl);
    }
    emit("meetings:start-transcription", {
      meetingId: data.meetingId,
      joinUrl: data.joinUrl,
      reason: "user",
    }).catch((err) => {
      setPending(false);
      setError((err as Error)?.message ?? "Could not start notes.");
    });
  }

  function snooze() {
    if (!data) return;
    // Hand the snooze to the Rust watcher so the reminder re-fires after the
    // delay even though this overlay window closes right away. A setTimeout
    // here would be torn down with the window and never fire, and re-emitting
    // immediately (as before) just re-showed the same banner instantly.
    invoke("meetings_snooze", {
      meetingId: data.meetingId,
      minutes: Math.round(SNOOZE_MS / 60_000),
    }).catch(() => {});
    const payload = data;
    // Hide the current banner and re-fire the same payload after the snooze
    // delay. We re-emit through Tauri so the in-app banner overlay window
    // (which is what hosts this React component) can rerender with a fresh
    // auto-hide timer.
    emit("meetings:show-notification", {
      ...payload,
      subtitle: `${payload.subtitle} (snoozed)`,
    } as NotificationData).catch(() => {});
    hideNotification();
  }

  if (!data) {
    return <div className="meeting-notification-root" />;
  }

  const isCalendar = data.type === "calendar";

  return (
    <div
      className="meeting-notification-root"
      onMouseEnter={() => {
        setShowClose(true);
        clearAutoHide();
      }}
      onMouseLeave={() => {
        setShowClose(false);
        // Resume the auto-hide timer with the remaining-ish budget.
        // Cheap approximation: just restart the full timer on leave.
        scheduleAutoHide(DEFAULT_AUTO_HIDE_MS);
      }}
    >
      <div className="meeting-notification">
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
        <div className="meeting-notification-actions">
          <button
            className="meeting-notification-btn"
            onClick={takeNotes}
            disabled={pending}
            data-no-drag
          >
            {pending ? "Starting…" : "Start notes"}
          </button>
          <button
            className="meeting-notification-btn meeting-notification-btn-secondary"
            onClick={snooze}
            data-no-drag
            aria-label="Snooze 5 minutes"
            title="Snooze 5 min"
          >
            <IconClock size={12} aria-hidden="true" />
            <span>5m</span>
          </button>
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
