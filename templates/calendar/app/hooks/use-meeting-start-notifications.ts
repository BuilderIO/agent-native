import { useEffect, useRef } from "react";
import type { CalendarEvent } from "@shared/api";

const STORAGE_KEY = "calendar:meeting-start-notifications:sent";
const LOOKAHEAD_MS = 2 * 60 * 1000;
const GRACE_MS = 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const MAX_SENT_KEYS = 200;

function supportsNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

function loadSentKeys(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

function saveSentKeys(keys: string[]) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(keys.slice(-MAX_SENT_KEYS)),
    );
  } catch {
    // Best effort. Losing the local dedupe cache should not break the calendar.
  }
}

function notificationKey(event: CalendarEvent) {
  return `${event.id}:${event.start}`;
}

function isNotificationCandidate(event: CalendarEvent, now: number) {
  if (event.allDay) return false;
  if (event.status === "cancelled") return false;
  if (event.responseStatus === "declined") return false;
  if (event.transparency === "transparent") return false;

  const start = Date.parse(event.start);
  if (!Number.isFinite(start)) return false;

  return start >= now - GRACE_MS && start <= now + LOOKAHEAD_MS;
}

function formatStartTime(startIso: string, now: number) {
  const startsIn = Date.parse(startIso) - now;
  if (startsIn <= 30_000) return "Starts now";

  const minutes = Math.max(1, Math.round(startsIn / 60_000));
  return `Starts in ${minutes} min`;
}

function notifyEvent(event: CalendarEvent, now: number) {
  const title = event.title.trim() || "Meeting starting";
  const location = event.location.trim();
  const body = location
    ? `${formatStartTime(event.start, now)} - ${location}`
    : formatStartTime(event.start, now);

  const notification = new Notification(title, {
    body,
    tag: `calendar-meeting-start:${event.id}:${event.start}`,
  });

  notification.onclick = () => {
    window.focus();
  };
}

export function useMeetingStartNotifications(events: CalendarEvent[]) {
  const eventsRef = useRef(events);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    if (!supportsNotifications()) return;

    let stopped = false;

    const checkEvents = () => {
      if (stopped) return;
      if (Notification.permission !== "granted") return;

      const now = Date.now();
      const sent = new Set(loadSentKeys());
      let changed = false;

      for (const event of eventsRef.current) {
        const key = notificationKey(event);
        if (sent.has(key)) continue;
        if (!isNotificationCandidate(event, now)) continue;

        try {
          notifyEvent(event, now);
          sent.add(key);
          changed = true;
        } catch {
          // Safari and restricted contexts can still throw after permission.
        }
      }

      if (changed) saveSentKeys([...sent]);
    };

    checkEvents();
    const interval = window.setInterval(checkEvents, CHECK_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, []);
}
