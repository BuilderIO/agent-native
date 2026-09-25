/**
 * Formatting + presentation helpers for the uptime monitoring UI. Pure
 * functions only so they can be reused across the list, detail, and dialog.
 */
import { fmt } from "./i18n";
import type { Assertion, MonitorStatus, StatusMatcher } from "./types";

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Derive a friendly default monitor name from a URL: the host without a leading
 * `www.` (e.g. `example.com` from `https://www.example.com/health`). Falls back
 * to a best-effort parse for partial input so it still works while typing.
 */
export function deriveMonitorName(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host.replace(/^www\./i, "") || raw;
  } catch {
    return (
      raw
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
        .replace(/^www\./i, "")
        .split(/[/?#]/, 1)[0]
        ?.trim() ?? ""
    );
  }
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function formatRelativeTime(value: string | null): string | null {
  if (!value) return null;
  const then = Date.parse(value);
  if (!Number.isFinite(then)) return null;
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return diff >= 0 ? `${mins}m ago` : `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return diff >= 0 ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return diff >= 0 ? `${days}d ago` : `in ${days}d`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatUptime(pct: number | null): string {
  if (pct == null) return "—";
  if (pct >= 99.995) return "100%";
  return `${pct.toFixed(pct >= 99.9 ? 2 : 1)}%`;
}

/** Health bucket for coloring: 3 states surfaced in the UI. */
export type HealthTone = "up" | "down" | "degraded" | "neutral";

export function statusTone(status: MonitorStatus | null): HealthTone {
  switch (status) {
    case "up":
      return "up";
    case "down":
    case "error":
      return "down";
    case "degraded":
      return "degraded";
    default:
      return "neutral";
  }
}

export function toneDotClass(tone: HealthTone): string {
  switch (tone) {
    case "up":
      return "bg-emerald-500";
    case "down":
      return "bg-red-500";
    case "degraded":
      return "bg-amber-500";
    default:
      return "bg-muted-foreground/40";
  }
}

export function toneTextClass(tone: HealthTone): string {
  switch (tone) {
    case "up":
      return "text-emerald-500";
    case "down":
      return "text-red-500";
    case "degraded":
      return "text-amber-500";
    default:
      return "text-muted-foreground";
  }
}

export function statusLabel(
  status: MonitorStatus | null,
  t: {
    statusUp: string;
    statusDown: string;
    statusDegraded: string;
    statusError: string;
    statusRunning: string;
    statusUnknown: string;
  },
): string {
  switch (status) {
    case "up":
      return t.statusUp;
    case "down":
      return t.statusDown;
    case "degraded":
      return t.statusDegraded;
    case "error":
      return t.statusError;
    case "running":
      return t.statusRunning;
    default:
      return t.statusUnknown;
  }
}

export function describeMatcher(
  matcher: StatusMatcher,
  t: { matcherClass: string; matcherList: string; matcherRange: string },
): string {
  if (matcher.mode === "class") {
    return fmt(t.matcherClass, {
      classes: matcher.classes.join(", ").toUpperCase(),
    });
  }
  if (matcher.mode === "list") {
    return fmt(t.matcherList, { codes: matcher.codes.join(", ") });
  }
  return fmt(t.matcherRange, { min: matcher.min, max: matcher.max });
}

export function describeAssertion(
  assertion: Assertion,
  t: {
    assertBodyContains: string;
    assertBodyAbsent: string;
    assertHeaderContains: string;
    assertHeaderEquals: string;
    assertMaxLatency: string;
  },
): string {
  const value = String(assertion.value);
  const header = assertion.header ?? "";
  switch (assertion.type) {
    case "body_contains":
      return fmt(t.assertBodyContains, { value });
    case "body_absent":
      return fmt(t.assertBodyAbsent, { value });
    case "header_contains":
      return fmt(t.assertHeaderContains, { header, value });
    case "header_equals":
      return fmt(t.assertHeaderEquals, { header, value });
    case "max_latency_ms":
      return fmt(t.assertMaxLatency, { value });
    default:
      return value;
  }
}
