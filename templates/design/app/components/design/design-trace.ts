// Interaction trace, on by default in dev. From the top-frame console:
// `__DESIGN_TRACE = false` silences it; `__designTrace.dump()` prints the
// whole story to copy; `.clear()` and `.only("drop")` narrow it.
declare global {
  interface Window {
    __DESIGN_TRACE?: boolean;
    __designTrace?: {
      dump: () => string;
      clear: () => void;
      only: (area?: string) => void;
      entries: () => TraceEntry[];
    };
  }
}

export type TraceArea =
  | "tool"
  | "draw"
  | "screen"
  | "select"
  | "drag"
  | "drop"
  | "persist"
  | "structure"
  | "history";

export interface TraceEntry {
  t: number;
  area: TraceArea;
  event: string;
  data?: unknown;
}

const MAX_ENTRIES = 2000;
const entries: TraceEntry[] = [];
let areaFilter: string | undefined;
let startedAt = 0;

function enabled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__DESIGN_TRACE === false) return false;
  return window.__DESIGN_TRACE === true || import.meta.env?.DEV === true;
}

function ensureControls(): void {
  if (typeof window === "undefined" || window.__designTrace) return;
  window.__designTrace = {
    entries: () => entries.slice(),
    clear: () => {
      entries.length = 0;
      startedAt = 0;
    },
    only: (area?: string) => {
      areaFilter = area;
    },
    dump: () =>
      entries
        .map((e) => {
          const body = e.data === undefined ? "" : ` ${safeJson(e.data)}`;
          return `+${String(e.t).padStart(6)}ms [${e.area}:${e.event}]${body}`;
        })
        .join("\n"),
  };
}

/** Never let a circular ref or a DOM node break a gesture. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) =>
      v instanceof Element ? v.tagName.toLowerCase() : v,
    );
  } catch {
    return String(value);
  }
}

export function trace(area: TraceArea, event: string, data?: unknown): void {
  if (!enabled()) return;
  try {
    ensureControls();
    const now = Date.now();
    if (!startedAt) startedAt = now;
    const entry: TraceEntry = { t: now - startedAt, area, event, data };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    if (areaFilter && areaFilter !== area) return;
    const tag = `%c[${area}:${event}]`;
    const style = "font-weight:bold";
    if (data === undefined) console.log(tag, style);
    else console.log(tag, style, data);
    // coercion-ok: diagnostics must never break the interaction they observe
  } catch {}
}

/** Short, stable label for an element in a trace line. */
export function traceEl(el: Element | null | undefined): string | null {
  if (!el) return null;
  const id = el.getAttribute?.("data-agent-native-node-id");
  const name = el.getAttribute?.("data-agent-native-layer-name");
  const primitive = el.getAttribute?.("data-an-primitive");
  const tag = el.tagName?.toLowerCase() ?? "?";
  return [
    tag,
    primitive && `(${primitive})`,
    name && `"${name}"`,
    id && `#${id}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Compact geometry for a trace line. */
export function roundGeo(g: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string {
  return `${Math.round(g.x)},${Math.round(g.y)} ${Math.round(g.width)}x${Math.round(g.height)}`;
}
