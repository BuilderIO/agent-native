import type {
  DocumentEditorIconRow,
  DocumentEditorShape,
} from "@/components/editor/document-editor-layout";

// Before a page loads, nothing says what it will draw: whether it has an icon,
// whether this person can edit it, whether it is a collection, or whether its
// open comments hold the review margin open. What this browser last drew for a
// page lets its placeholder hold the same boxes. Only page ids and these flags
// are kept, and only for pages that differ from the default.
const PAGE_ICON_ROWS_STORAGE_KEY = "content-page-icon-rows-v1";
const PAGE_SHAPES_STORAGE_KEY = "content-page-shapes-v1";
const MAX_REMEMBERED_PAGES = 200;

export const STARTUP_PAGE_ICON_ROW_ATTRIBUTE = "data-content-page-icon-row";
export const STARTUP_PAGE_SHAPE_ATTRIBUTE = "data-content-page-shape";

const REMEMBERED_SHAPES = [
  "review",
  "database",
  "database-constrained",
] as const satisfies readonly DocumentEditorShape[];

function readStoredHints(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // coercion-ok: an unreadable hint only means the page may move once.
    return {};
  }
}

function rememberHint(
  key: string,
  documentId: string,
  value: string,
  defaultValue: string,
) {
  const hints = readStoredHints(key);
  if ((hints[documentId] ?? defaultValue) === value) return;
  delete hints[documentId];
  if (value !== defaultValue) hints[documentId] = value;
  const ids = Object.keys(hints);
  const overflow = Math.max(0, ids.length - MAX_REMEMBERED_PAGES);
  for (const id of ids.slice(0, overflow)) delete hints[id];
  try {
    localStorage.setItem(key, JSON.stringify(hints));
  } catch {
    // coercion-ok: without storage the next load holds the default boxes.
  }
}

export function readPageIconRowHint(documentId: string): DocumentEditorIconRow {
  const row = readStoredHints(PAGE_ICON_ROWS_STORAGE_KEY)[documentId];
  return row === "icon" || row === "none" ? row : "add";
}

export function rememberPageIconRow(
  documentId: string,
  row: DocumentEditorIconRow,
) {
  rememberHint(PAGE_ICON_ROWS_STORAGE_KEY, documentId, row, "add");
}

export function readPageShapeHint(documentId: string): DocumentEditorShape {
  const shape = readStoredHints(PAGE_SHAPES_STORAGE_KEY)[documentId];
  return REMEMBERED_SHAPES.find((remembered) => remembered === shape) ?? "page";
}

// A loaded page knows whether it is a collection; the hint still says which
// boxes it last drew below the title.
export function readDocumentShapeHint(document: {
  id: string;
  database?: unknown;
}): DocumentEditorShape {
  const shape = readPageShapeHint(document.id);
  if (document.database) {
    return shape === "database-constrained" ? shape : "database";
  }
  return shape === "review" ? shape : "page";
}

export function rememberPageShape(
  documentId: string,
  shape: DocumentEditorShape,
) {
  rememberHint(PAGE_SHAPES_STORAGE_KEY, documentId, shape, "page");
}

// Runs in <head> before the first paint, so the server-rendered placeholder
// for a page holds the boxes that page last drew. The app may sit under a base
// path, so the id is the segment after `page` wherever it appears.
// coercion-ok: an unreadable hint only means the page may move once.
export const CONTENT_STARTUP_PAGE_HINTS_SCRIPT = `(function(){try{var p=location.pathname.split("/"),i=p.indexOf("page");if(i<0||!p[i+1])return;var d=document.documentElement,id=decodeURIComponent(p[i+1]);function h(k){try{return JSON.parse(localStorage.getItem(k)||"{}")[id]}catch(e){}}var r=h(${JSON.stringify(
  PAGE_ICON_ROWS_STORAGE_KEY,
)}),s=h(${JSON.stringify(PAGE_SHAPES_STORAGE_KEY)});if(r==="icon"||r==="none")d.setAttribute(${JSON.stringify(
  STARTUP_PAGE_ICON_ROW_ATTRIBUTE,
)},r);if(${JSON.stringify(REMEMBERED_SHAPES)}.indexOf(s)>=0)d.setAttribute(${JSON.stringify(
  STARTUP_PAGE_SHAPE_ATTRIBUTE,
)},s)}catch(e){}})();`; // coercion-ok: without storage the shell holds the default boxes.
