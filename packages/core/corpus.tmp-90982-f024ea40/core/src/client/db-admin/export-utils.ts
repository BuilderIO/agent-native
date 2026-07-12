/**
 * Serialization + download helpers for exporting SQL editor results.
 *
 * Kept dependency-free and SSR-safe: `downloadFile` no-ops outside the browser.
 */

function cellToCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str: string;
  if (typeof value === "object") {
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  } else {
    str = String(value);
  }
  // Spreadsheet apps treat leading =, +, -, and @ as formulas. Prefix with an
  // apostrophe so exported CSV opens as literal text instead of executing.
  if (/^[=+\-@]/.test(str)) str = `'${str}`;
  // Quote when the value contains a comma, quote, CR, or LF. Escape embedded
  // double-quotes by doubling them (RFC 4180).
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Render a matrix as RFC-4180-style CSV with a header row. */
export function toCSVTable(headers: string[], rows: unknown[][]): string {
  const header = headers.map(cellToCSV).join(",");
  const body = rows.map((row) => row.map(cellToCSV).join(","));
  return [header, ...body].join("\r\n");
}

/** Render rows as RFC-4180-style CSV with a header row of the given columns. */
export function toCSV(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  return toCSVTable(
    columns,
    rows.map((row) => columns.map((col) => row[col])),
  );
}

/** Render rows as a pretty-printed JSON array. */
export function toJSON(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

/**
 * Trigger a client-side download of `content` as a file named `name` with the
 * given MIME type. No-ops during SSR.
 */
export function downloadFile(
  name: string,
  mime: string,
  content: string,
): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Revoke on the next tick so the click has a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {
    // Best-effort — nothing actionable if the browser blocks the download.
  }
}
