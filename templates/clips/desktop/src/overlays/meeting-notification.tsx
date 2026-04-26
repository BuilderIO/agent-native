import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface NotificationData {
  type: "calendar" | "adhoc";
  title: string;
  subtitle: string;
  meetingId: string;
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
