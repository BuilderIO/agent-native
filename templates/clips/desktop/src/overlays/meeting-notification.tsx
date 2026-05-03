import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

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

function getServerUrl(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v.trim()) return v.replace(/\/+$/, "");
  } catch {
    // ignore
  }
  return null;
}

async function callStartMeetingRecording(meetingId: string): Promise<void> {
  const base = getServerUrl();
  if (!base) {
    return;
  }
  try {
    await fetch(`${base}/_agent-native/actions/start-meeting-recording`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId }),
    });
  } catch (err) {
    console.error("[clips-tray] start-meeting-recording fetch failed:", err);
  }
}

/**
 * Granola-style meeting notification — small card (320x80 logical px) in the
 * top-right corner. Two visual variants:
 *
 *   - Calendar event: solid left bar (green), meeting title, time,
 *     "Take Notes" button.
 *   - Ad-hoc call: dashed left bar (slate), "Call detected", app name,
 *     "Take Notes" button.
 *
 * Data arrives via Tauri event `meetings:show-notification`. Auto-dismisses
 * after 30 seconds. Close button (X) on hover.
 */
export function MeetingNotification() {
  const [data, setData] = useState<NotificationData | null>(null);
  const [showClose, setShowClose] = useState(false);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let stopped = false;
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;

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

        // Auto-dismiss after 30 seconds.
        if (dismissTimer) clearTimeout(dismissTimer);
        dismissTimer = setTimeout(() => {
          dismiss();
        }, 30_000);
      }),
    );

    // The Rust meetings_watcher (and the notifications module) fire
    // `meetings:start-recording` when the user accepts a meeting reminder
    // — wire it directly to the start-meeting-recording action and
    // surface the recording pill.
    trackListen(
      listen<StartRecordingPayload>("meetings:start-recording", (ev) => {
        const { meetingId, joinUrl } = ev.payload;
        if (!meetingId) return;
        callStartMeetingRecording(meetingId).catch(() => {});
        invoke("recording_pill_show", {
          meetingId,
          mode: "meeting",
        }).catch(() => {});
        if (joinUrl) {
          // Opening the join URL is a separate side effect — leave it to
          // the host integration so it can use tauri-plugin-shell with
          // the right capabilities.
          emit("meetings:open-join-url", { joinUrl }).catch(() => {});
        }
      }),
    );

    return () => {
      stopped = true;
      if (dismissTimer) clearTimeout(dismissTimer);
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      unlistens.length = 0;
    };
  }, []);

  function dismiss() {
    getCurrentWindow()
      .close()
      .catch(() => {});
  }

  function takeNotes() {
    if (!data) return;
    emit("meetings:take-notes", { meetingId: data.meetingId }).catch(() => {});
    callStartMeetingRecording(data.meetingId).catch(() => {});
    invoke("recording_pill_show", {
      meetingId: data.meetingId,
      mode: "meeting",
    }).catch(() => {});
    dismiss();
  }

  if (!data) {
    return <div className="meeting-notification-root" />;
  }

  const isCalendar = data.type === "calendar";

  return (
    <div
      className="meeting-notification-root"
      onMouseEnter={() => setShowClose(true)}
      onMouseLeave={() => setShowClose(false)}
    >
      <div className="meeting-notification">
        <div
          className={`meeting-notification-bar ${isCalendar ? "meeting-notification-bar-calendar" : "meeting-notification-bar-adhoc"}`}
        />
        <div className="meeting-notification-content">
          <div className="meeting-notification-title">{data.title}</div>
          <div className="meeting-notification-subtitle">{data.subtitle}</div>
        </div>
        <button
          className="meeting-notification-btn"
          onClick={takeNotes}
          data-no-drag
        >
          Take Notes
        </button>
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
