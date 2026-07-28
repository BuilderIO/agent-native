/**
 * Client-side helpers for the Nomad compliance UI.
 */

import { countryName } from "../../shared/countries";
import type { Severity, StatusKey, Stay } from "../../shared/types";

/** Inline-style color for a traffic-light severity. */
export function severityColor(severity: Severity | "info"): string {
  switch (severity) {
    case "danger":
      return "hsl(var(--danger))";
    case "warn":
      return "hsl(var(--warn))";
    case "info":
      return "hsl(var(--info))";
    default:
      return "hsl(var(--safe))";
  }
}

export function severityBg(severity: Severity | "info"): string {
  switch (severity) {
    case "danger":
      return "hsl(var(--danger) / 0.1)";
    case "warn":
      return "hsl(var(--warn) / 0.1)";
    case "info":
      return "hsl(var(--info) / 0.08)";
    default:
      return "hsl(var(--safe) / 0.1)";
  }
}

export function severityBorder(severity: Severity | "info"): string {
  switch (severity) {
    case "danger":
      return "hsl(var(--danger) / 0.35)";
    case "warn":
      return "hsl(var(--warn) / 0.35)";
    case "info":
      return "hsl(var(--info) / 0.3)";
    default:
      return "hsl(var(--safe) / 0.35)";
  }
}

/** i18n key suffix for a rule/country status chip. */
export function statusLabelKey(statusKey: StatusKey): string {
  switch (statusKey) {
    case "over":
      return "nomad.status.over";
    case "at-risk":
      return "nomad.status.atRisk";
    case "close":
      return "nomad.status.close";
    case "met":
      return "nomad.status.met";
    default:
      return "nomad.status.onTrack";
  }
}

/** "Aug 8" style short date from YYYY-MM-DD, in the browser locale. */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(y !== new Date().getFullYear() ? { year: "numeric" } : {}),
  }).format(new Date(y, m - 1, d));
}

/** "Jun 9 – Jul 20" (or "Jun 9 →" for open stays). */
export function formatStayRange(
  stay: Pick<Stay, "entryDate" | "exitDate">,
): string {
  const from = formatShortDate(stay.entryDate);
  return stay.exitDate
    ? `${from} – ${formatShortDate(stay.exitDate)}`
    : `${from} →`;
}

/** Inclusive day-count of a stay (open stays counted through today). */
export function stayLengthDays(
  stay: Pick<Stay, "entryDate" | "exitDate">,
  today: string,
): number {
  const ms = 86_400_000;
  const toUTC = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const end = toUTC(stay.exitDate ?? today);
  return Math.max(0, Math.round((end - toUTC(stay.entryDate)) / ms) + 1);
}

/** Build and download the presence log as a CSV file. */
export function downloadPresenceCsv(stays: Stay[], filename: string): void {
  const header =
    "country_code,country,city,entry_date,exit_date,days,source,status,notes";
  const today = new Date().toISOString().slice(0, 10);
  const escape = (v: string | null) =>
    v === null || v === "" ? "" : `"${String(v).split('"').join('""')}"`;
  const lines = stays.map((s) =>
    [
      s.countryCode,
      escape(countryName(s.countryCode)),
      escape(s.city),
      s.entryDate,
      s.exitDate ?? "",
      stayLengthDays(s, today),
      s.source,
      s.status,
      escape(s.notes),
    ].join(","),
  );
  const blob = new Blob([[header, ...lines].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
