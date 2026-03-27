import type { CalendarEvent } from "@shared/api";

// ─── Palette (dark-mode editor inspired) ─────────────────────────────────────

export const EVENT_CATEGORY_COLORS = {
  focus: "#7C9C6B", // sage — self-holds, focus time
  internal1on1: "#5B9BD5", // steel blue — internal 1:1
  internalGroup: "#B07CC6", // amethyst — internal group
  external1on1: "#D4A053", // amber — external 1:1
  externalGroup: "#CD6B6B", // coral — external group
  allDay: "#8B8FA3", // slate — all-day, OOO
  fallback: "#5B9BD5", // steel blue
} as const;

export type EventCategory = keyof typeof EVENT_CATEGORY_COLORS;

// ─── Free email providers (skip internal/external when user is on one) ───────

const FREE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
]);

function getDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

// ─── Classification ──────────────────────────────────────────────────────────

export function classifyEvent(event: CalendarEvent): EventCategory {
  // All-day events (OOO, travel, birthdays)
  if (event.allDay) return "allDay";

  const attendees = event.attendees;

  // No attendees data → focus time
  if (!attendees || attendees.length === 0) return "focus";

  // Filter out self to count "others"
  const others = attendees.filter((a) => !a.self);

  // Only self → focus time / self-hold
  if (others.length === 0) return "focus";

  // Determine user domain from accountEmail or self attendee
  const selfAttendee = attendees.find((a) => a.self);
  const userEmail = event.accountEmail || selfAttendee?.email || "";
  const userDomain = getDomain(userEmail);

  // If user is on a free provider, we can't distinguish internal/external
  // Fall back to count-based coloring
  if (!userDomain || FREE_DOMAINS.has(userDomain)) {
    return others.length === 1 ? "internal1on1" : "internalGroup";
  }

  // Check if all others are internal (same domain)
  const allInternal = others.every((a) => getDomain(a.email) === userDomain);
  const anyInternal = others.some((a) => getDomain(a.email) === userDomain);

  if (others.length === 1) {
    return allInternal ? "internal1on1" : "external1on1";
  }

  // Group meetings (3+ total = 2+ others)
  if (allInternal) return "internalGroup";
  if (!anyInternal) return "externalGroup"; // all external
  return "externalGroup"; // mixed = treat as external group
}

// ─── Main color function ─────────────────────────────────────────────────────

/**
 * Returns a hex color for a calendar event based on its meeting type.
 * Respects user-set colors and overlay colors first.
 * For local (non-Google) events without a color, returns CSS var.
 */
export function getEventAutoColor(event: CalendarEvent): string {
  // User/Google-set color takes priority
  if (event.color) return event.color;

  // Overlay events keep their overlay-assigned color
  if (event.overlayEmail) return EVENT_CATEGORY_COLORS.fallback;

  // Local events without a color use the theme primary
  if (event.source !== "google") return "hsl(var(--primary))";

  // Auto-classify Google events
  const category = classifyEvent(event);
  return EVENT_CATEGORY_COLORS[category];
}
