// The recent-edits ring, without React: the server appends agent edits to it
// (agent-presence.ts), and importing the hooks below would pull React into the
// server's startup graph.
import {
  RECENT_EDITS_MAX,
  type RecentEdit,
  type RecentEditDescriptor,
} from "./types.js";

const RECENT_EDIT_STRING_MAX = 500;

function truncateString(value: string): string {
  return value.length > RECENT_EDIT_STRING_MAX
    ? value.slice(0, RECENT_EDIT_STRING_MAX)
    : value;
}

function truncateDescriptor(
  descriptor: RecentEditDescriptor,
): RecentEditDescriptor {
  const d = descriptor as Record<string, unknown> & { kind: string };
  if (d.kind === "text" && typeof d.quote === "string") {
    return { ...d, quote: truncateString(d.quote) } as RecentEditDescriptor;
  }
  if (d.kind === "selector" && typeof d.selector === "string") {
    return {
      ...d,
      selector: truncateString(d.selector),
    } as RecentEditDescriptor;
  }
  if (d.kind === "paths" && Array.isArray(d.paths)) {
    return {
      ...d,
      paths: d.paths.map((p) =>
        typeof p === "string" ? truncateString(p) : p,
      ),
    } as RecentEditDescriptor;
  }
  if (d.kind === "doc") {
    return descriptor;
  }
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(d)) {
    trimmed[key] = typeof value === "string" ? truncateString(value) : value;
  }
  return trimmed as RecentEditDescriptor;
}

export function appendRecentEdit(
  existing: RecentEdit[] | undefined,
  edit: RecentEdit,
): RecentEdit[] {
  const ring = Array.isArray(existing) ? existing.slice() : [];
  ring.push({
    ...edit,
    descriptor: truncateDescriptor(edit.descriptor),
    label: edit.label ? truncateString(edit.label) : edit.label,
  });
  if (ring.length > RECENT_EDITS_MAX) {
    ring.splice(0, ring.length - RECENT_EDITS_MAX);
  }
  return ring;
}
