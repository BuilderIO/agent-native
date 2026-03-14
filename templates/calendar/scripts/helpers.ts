import { parseArgs as coreParseArgs } from "@agent-native/core";

export { coreParseArgs as parseArgs };

/**
 * Format an ISO date string to a human-readable date.
 * e.g. "2026-03-14T10:00:00Z" → "Mar 14, 2026"
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format an ISO date string to a human-readable time.
 * e.g. "2026-03-14T10:00:00Z" → "10:00 AM"
 */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Format a date range for display.
 * e.g. "Mar 14, 2026  10:00 AM – 11:00 AM"
 */
export function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)}  ${formatTime(start)} – ${formatTime(end)}`;
}

/**
 * Get the start of a day as an ISO string (midnight local time).
 */
export function startOfDay(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of a day as an ISO string (23:59:59 local time).
 */
export function endOfDay(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Pad a number to 2 digits.
 */
export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Format minutes since midnight to "HH:MM AM/PM".
 */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${pad2(m)} ${period}`;
}
