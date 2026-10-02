import type { DocumentEditorIconRow } from "@/components/editor/document-editor-layout";
import { LAST_LOCATION_HINT_STORAGE_KEY } from "@/lib/last-location-hint";

// Before a page loads, nothing says whether it has an icon or whether this
// person can edit it, and each draws a different row above the title. The row
// this browser last drew for a page lets its placeholder hold that row. Only
// page ids are kept, and only for rows other than the default "Add icon".
const PAGE_ICON_ROWS_STORAGE_KEY = "content-page-icon-rows-v1";
const MAX_REMEMBERED_PAGES = 200;

export const STARTUP_PAGE_ICON_ROW_ATTRIBUTE = "data-content-page-icon-row";

function readStoredRows(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PAGE_ICON_ROWS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // coercion-ok: an unreadable hint only means the title may move once.
    return {};
  }
}

export function readPageIconRowHint(documentId: string): DocumentEditorIconRow {
  const row = readStoredRows()[documentId];
  return row === "icon" || row === "none" ? row : "add";
}

export function rememberPageIconRow(
  documentId: string,
  row: DocumentEditorIconRow,
) {
  const rows = readStoredRows();
  if ((rows[documentId] ?? "add") === row) return;
  delete rows[documentId];
  if (row !== "add") rows[documentId] = row;
  const ids = Object.keys(rows);
  const overflow = Math.max(0, ids.length - MAX_REMEMBERED_PAGES);
  for (const id of ids.slice(0, overflow)) delete rows[id];
  try {
    localStorage.setItem(PAGE_ICON_ROWS_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // coercion-ok: without storage the next load holds the "Add icon" row.
  }
}

// Runs in <head> before the first paint, so the server-rendered placeholder
// for a page holds the row that page last drew. The app may sit under a base
// path, so the id is the segment after `page` wherever it appears. On /home it
// is the page this browser last opened. Who is signed in is unknown this
// early, so another account in the same browser may see that row move once.
export const CONTENT_STARTUP_PAGE_ICON_ROW_SCRIPT = `(function(){try{var p=location.pathname.split("/").filter(Boolean),i=p.indexOf("page"),id=i>=0&&p[i+1]?decodeURIComponent(p[i+1]):null;if(!id&&p[p.length-1]==="home"&&!/[?&]spaceId=/.test(location.search))id=(JSON.parse(localStorage.getItem(${JSON.stringify(
  LAST_LOCATION_HINT_STORAGE_KEY,
)})||"null")||{}).documentId;if(typeof id!=="string"||!id)return;var r=JSON.parse(localStorage.getItem(${JSON.stringify(
  PAGE_ICON_ROWS_STORAGE_KEY,
)})||"{}")[id];if(r==="icon"||r==="none")document.documentElement.setAttribute(${JSON.stringify(
  STARTUP_PAGE_ICON_ROW_ATTRIBUTE,
)},r)}catch(e){}})();`; // coercion-ok: without storage the shell holds the "Add icon" row.
