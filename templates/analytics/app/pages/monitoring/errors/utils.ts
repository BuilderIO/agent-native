import { useErrorsT } from "./i18n";
import type { ExceptionLevel, IssueStatus } from "./types";

/** Compact "x ago" relative time; falls back to a short date for old items. */
export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: day > 300 ? "numeric" : undefined,
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(
    value || 0,
  );
}

/** Tailwind classes for the small level pill (dark analytics aesthetic). */
export function levelBadgeClass(level: ExceptionLevel): string {
  switch (level) {
    case "fatal":
      return "bg-red-500/15 text-red-400 border-red-500/25";
    case "error":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "warning":
      return "bg-amber-500/15 text-amber-400 border-amber-500/25";
    case "info":
      return "bg-sky-500/15 text-sky-400 border-sky-500/25";
    case "debug":
    default:
      return "bg-muted text-muted-foreground border-border/60";
  }
}

/** A vertical accent color that echoes the severity on each list row. */
export function levelAccentClass(level: ExceptionLevel): string {
  switch (level) {
    case "fatal":
    case "error":
      return "bg-red-500/70";
    case "warning":
      return "bg-amber-500/70";
    case "info":
      return "bg-sky-500/70";
    case "debug":
    default:
      return "bg-muted-foreground/40";
  }
}

export function statusBadgeClass(status: IssueStatus): string {
  switch (status) {
    case "resolved":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
    case "ignored":
      return "bg-muted text-muted-foreground border-border/60";
    case "unresolved":
    default:
      return "bg-orange-500/15 text-orange-400 border-orange-500/25";
  }
}

export function useLevelLabel() {
  const t = useErrorsT();
  return (level: ExceptionLevel): string => {
    switch (level) {
      case "fatal":
        return t.levelFatal;
      case "warning":
        return t.levelWarning;
      case "info":
        return t.levelInfo;
      case "debug":
        return t.levelDebug;
      case "error":
      default:
        return t.levelError;
    }
  };
}

export function useStatusLabel() {
  const t = useErrorsT();
  return (status: IssueStatus): string => {
    switch (status) {
      case "resolved":
        return t.statusResolved;
      case "ignored":
        return t.statusIgnored;
      case "unresolved":
      default:
        return t.statusUnresolved;
    }
  };
}

/** Shorten a stack-frame filename to a readable "…/dir/file.ts" tail. */
export function shortFrameFile(file: string | null): string {
  if (!file) return "<anonymous>";
  let out = file.replace(/[?#].*$/, "");
  const urlMatch = out.match(/^[a-z]+:\/\/[^/]+(\/.*)$/i);
  if (urlMatch) out = urlMatch[1];
  const parts = out.split("/").filter(Boolean);
  if (parts.length <= 2) return out;
  return `…/${parts.slice(-2).join("/")}`;
}
