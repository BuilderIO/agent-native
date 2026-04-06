/**
 * Parse CLI-style arguments (--key value or --flag).
 * Replaces the broken @agent-native/core parseArgs import.
 */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  // Skip the first two entries if they look like node + script path
  const args =
    argv[0]?.startsWith("/") || argv[0] === "node" ? argv.slice(2) : argv;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values[key] = next;
        i++;
      } else {
        values[key] = true;
      }
    }
  }
  return values;
}

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
 * Parse a natural language or ISO date string into a Date.
 *
 * Supports: "today", "tomorrow", "yesterday", "next week", "next month",
 * "this weekend", day names ("monday", "fri"), partial prefixes ("tom" → tomorrow,
 * "next" → next week), and ISO dates ("2026-03-30").
 */
export function parseDate(input: string): Date {
  const s = input.trim().toLowerCase();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Exact and prefix matches for common natural language dates
  if ("today".startsWith(s) && s.length >= 3) return today;
  if ("tomorrow".startsWith(s) && s.length >= 3) return addDays(today, 1);
  if ("yesterday".startsWith(s) && s.length >= 3) return addDays(today, -1);

  // "next ..." phrases (also match bare "next" → next week)
  if (
    s === "next" ||
    s === "next week" ||
    ("next week".startsWith(s) && s.length >= 4)
  ) {
    // Next Monday
    const day = today.getDay(); // 0=Sun
    const daysUntilMon = (1 - day + 7) % 7 || 7;
    return addDays(today, daysUntilMon);
  }
  if (
    s === "next month" ||
    ("next month".startsWith(s) && s.startsWith("next m"))
  ) {
    return new Date(today.getFullYear(), today.getMonth() + 1, 1);
  }

  // "this weekend" → next Saturday
  if (
    s === "this weekend" ||
    ("this weekend".startsWith(s) && s.length >= 5 && s.startsWith("this"))
  ) {
    const day = today.getDay();
    const daysUntilSat = (6 - day + 7) % 7 || 7;
    return addDays(today, daysUntilSat);
  }

  // Day names: "monday", "mon", "tuesday", "tue", etc.
  const dayNames = [
    { names: ["sunday", "sun"], dow: 0 },
    { names: ["monday", "mon"], dow: 1 },
    { names: ["tuesday", "tue", "tues"], dow: 2 },
    { names: ["wednesday", "wed"], dow: 3 },
    { names: ["thursday", "thu", "thur", "thurs"], dow: 4 },
    { names: ["friday", "fri"], dow: 5 },
    { names: ["saturday", "sat"], dow: 6 },
  ];
  for (const { names, dow } of dayNames) {
    if (
      names.some((n) => n.startsWith(s) && s.length >= 3) ||
      names.includes(s)
    ) {
      const currentDow = today.getDay();
      const daysAhead = (dow - currentDow + 7) % 7 || 7;
      return addDays(today, daysAhead);
    }
  }

  // Fall back to Date constructor (handles ISO dates like "2026-03-30")
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) return parsed;

  // Give up — return today
  console.warn(`Could not parse date "${input}", using today`);
  return today;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
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
