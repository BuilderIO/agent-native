
function cellToCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str: string;
  if (typeof value === "object") {
    try {
      str = JSON.stringify(value) ?? "";
    } catch {
      str = "";
    }
  } else {
    str = String(value as string | number | bigint | boolean | symbol);
  }
  if (/^[=+\-@]/.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCSVTable(headers: string[], rows: unknown[][]): string {
  const header = headers.map(cellToCSV).join(",");
  const body = rows.map((row) => row.map(cellToCSV).join(","));
  return [header, ...body].join("\r\n");
}

export function toCSV(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  return toCSVTable(
    columns,
    rows.map((row) => columns.map((col) => row[col])),
  );
}

export function toJSON(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

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
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {
    // Best-effort — nothing actionable if the browser blocks the download.
  }
}
