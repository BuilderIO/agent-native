import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconAlertCircle, IconClock } from "@tabler/icons-react";

interface NotificationData {
  type: "calendar" | "adhoc";
  title: string;
  subtitle: string;
  meetingId: string;
  joinUrl?: string | null;
}

interface StartRecordingPayload {
  meetingId: string;
  joinUrl?: string | null;
}

const STORAGE_KEY = "clips:server-url";
const DEFAULT_DISMISS_MS = 30_000;
const SNOOZE_MS = 5 * 60_000;

function getServerUrl(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v.trim()) return v.replace(/\/+$/, "");
  } catch {
    // ignore
  }
  return null;
}

/**
 * Call the start-meeting-recording action and surface a useful error if it
 * fails. Returns null on success, or a short user-visible error string on
 * failure (so the banner can render it).
 */
async function callStartMeetingRecording(
  meetingId: string,
): Promise<string | null> {
  const base = getServerUrl();
  if (!base) {
    return "No server configured";
  }
  try {
    const resp = await fetch(
      `${base}/_agent-native/actions/start-meeting-recording`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return resp.status === 401
        ? "Sign in to record meetings"
        : `Couldn't start recording (${resp.status})${text ? `: ${text.slice(0, 120)}` : ""}`;
    }
    return null;
  } catch (err) {
    console.error("[clips-tray] start-meeting-recording fetch failed:", err);
    return "Network error — couldn't reach server";
  }
}

/**
 * Open a meeting join URL via the Tauri shell plugin. Centralized here so
 * both the notification's "Take Notes" and the watcher's
 * `meetings:start-recording` event use the same path.
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
 *     "Take Notes" + "Snooze 5 min" buttons.
 *   - Ad-hoc call: dashed left bar (slate), "Call detected", app name,
 *     same controls.
 *
 * Data arrives via Tauri event `meetings:show-notification`. Auto-dismisses
 * after 30s by default. Hover pauses the auto-dismiss timer. Errors from
 * `start-meeting-recording` surface inline beneath the title so the user
 * isn't left wondering why nothing happened.
 */
export function MeetingNotification() {
  const [data, setData] = useState<NotificationData | null>(null);
  const [showClose, setShowClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef<NotificationData | null>(null);

  // Keep a ref to the latest data so the snooze timer (which runs after a
  // 5-min sleep) can re-emit the original payload even if the component
  // re-renders in between.
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

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
        setData(ev.payload);
        setError(null);
        setPending(false);
        scheduleDismiss(DEFAULT_DISMISS_MS);
      }),
    );

    // The Rust meetings_watcher (and the notifications module) fire
    // `meetings:start-recording` when the user accepts a meeting reminder.
    // Wire it directly to the start-meeting-recording action, surface any
    // error, and open the join URL via tauri-plugin-shell.
    trackListen(
      listen<StartRecordingPayload>("meetings:start-recording", (ev) => {
        const { meetingId, joinUrl } = ev.payload;
        if (!meetingId) return;
        callStartMeetingRecording(meetingId).then((err) => {
          if (err) setError(err);
        });
        invoke("recording_pill_show", {
          meetingId,
          mode: "meeting",
        }).catch(() => {});
        if (joinUrl) {
          openJoinUrl(joinUrl);
          // Keep the legacy event around for any other listeners that
          // care about it (host integrations, analytics, etc.).
          emit("meetings:open-join-url", { joinUrl }).catch(() => {});
        }
      }),
    );

    return () => {
      stopped = true;
      clearDismiss();
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

  function clearDismiss() {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }

  function scheduleDismiss(ms: number) {
    clearDismiss();
    dismissTimerRef.current = setTimeout(() => dismiss(), ms);
  }

  function dismiss() {
    clearDismiss();
    getCurrentWindow()
      .close()
      .catch(() => {});
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
    emit("meetings:take-notes", { meetingId: data.meetingId }).catch(() => {});
    invoke("recording_pill_show", {
      meetingId: data.meetingId,
      mode: "meeting",
    }).catch(() => {});
    const err = await callStartMeetingRecording(data.meetingId);
    setPending(false);
    if (err) {
      setError(err);
      // Keep the banner up so the user can see the error — re-arm with a
      // longer auto-dismiss so they have time to read it.
      scheduleDismiss(15_000);
      return;
    }
    dismiss();
  }

  function snooze() {
    if (!data) return;
    const payload = data;
    // Hide the current banner and re-fire the same payload after the snooze
    // delay. We re-emit through Tauri so the in-app banner overlay window
    // (which is what hosts this React component) can rerender with a fresh
    // dismiss timer.
    emit("meetings:show-notification", {
      ...payload,
      subtitle: `${payload.subtitle} (snoozed)`,
    } as NotificationData).catch(() => {});
    // We use a setTimeout in the watcher process by going through the
    // backend — but since the renderer owns this banner, do it here too as
    // a safety net.
    setTimeout(() => {
      const latest = dataRef.current;
      if (latest && latest.meetingId === payload.meetingId) return;
      emit("meetings:show-notification", payload).catch(() => {});
    }, SNOOZE_MS);
    dismiss();
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
        clearDismiss();
      }}
      onMouseLeave={() => {
        setShowClose(false);
        // Resume the auto-dismiss timer with the remaining-ish budget.
        // Cheap approximation: just restart the full timer on leave.
        scheduleDismiss(DEFAULT_DISMISS_MS);
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
            {pending ? "Starting…" : "Take Notes"}
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
            onClick={dismiss}
            aria-label="Dismiss"
            data-no-drag
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M1 1L9 9M9 1L1 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}
