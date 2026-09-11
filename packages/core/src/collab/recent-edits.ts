/**
 * Recent-edit attribution for collaborative documents.
 *
 * Every participant (human or agent) may publish a short ring of recent edits
 * in its awareness state under the `recentEdits` key. Clients render these as
 * lingering, fading highlights ("Google Docs / Figma collaborator just edited
 * this") for a few seconds after the edit lands, with the editor's name and
 * color next to the highlighted region.
 *
 * The descriptor is intentionally open-ended — each app publishes whatever its
 * surfaces can resolve back to a DOM rect:
 *   - `{ kind: "text", quote }`         rich-text apps resolve by text search
 *   - `{ kind: "selector", selector }`  canvas/DOM apps resolve by querySelector
 *   - `{ kind: "paths", paths }`        structured apps resolve JSON paths
 *     (e.g. `slides.3.content`) to their rendered element
 *   - `{ kind: "doc" }`                 whole-document change (no region)
 */

import {
  RECENT_EDITS_MAX,
  RECENT_EDIT_TTL_MS,
  type AttributedRecentEdit,
  type RecentEdit,
  type RecentEditDescriptor,
} from "@agent-native/toolkit/collab-ui";
import { useEffect, useRef, useState } from "react";

import type { OtherPresence } from "./presence.js";

export {
  RECENT_EDITS_MAX,
  RECENT_EDIT_TTL_MS,
  type AttributedRecentEdit,
  type RecentEdit,
  type RecentEditDescriptor,
} from "@agent-native/toolkit/collab-ui";

/**
 * Hard cap on any single string carried in a recentEdits entry (quote,
 * selector, path segment, label). Callers are expected to pass short
 * excerpts already (existing call sites trim to 80–120 chars for a "what
 * changed" snippet), but this is the ring's own size ceiling — a caller that
 * forgets to trim (e.g. passing a whole paragraph/document as `quote`) must
 * not blow up the awareness payload every connected client receives on the
 * fast-push path, nor the `_collab_awareness` SQL row it gets mirrored into.
 */
const RECENT_EDIT_STRING_MAX = 500;

function truncateString(value: string): string {
  return value.length > RECENT_EDIT_STRING_MAX
    ? value.slice(0, RECENT_EDIT_STRING_MAX)
    : value;
}

function truncateDescriptor(
  descriptor: RecentEditDescriptor,
): RecentEditDescriptor {
  // The union's last member (`{ kind: string; [key: string]: unknown }`) is an
  // open-ended catch-all whose `kind` is a plain `string`, so a `switch` on
  // `descriptor.kind` can't discriminate it away from the literal-kind
  // members for the compiler — every property still type-checks as
  // `unknown`. Read/write through an untyped view instead and lean on
  // runtime checks; the return value is cast back to the real type below.
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
  // Open-ended shape — trim any string-valued fields defensively without
  // knowing their names.
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(d)) {
    trimmed[key] = typeof value === "string" ? truncateString(value) : value;
  }
  return trimmed as RecentEditDescriptor;
}

/**
 * Append an edit to a recentEdits ring, keeping the newest
 * {@link RECENT_EDITS_MAX} entries. Pure — returns a new array. Descriptor
 * strings and the label are truncated to {@link RECENT_EDIT_STRING_MAX}
 * characters as a defensive cap on the awareness payload size.
 */
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

/**
 * Flatten non-expired recent edits from remote participants, newest last.
 * Pure — exported for tests and non-React consumers.
 */
export function collectRecentEdits(
  others: OtherPresence[],
  ttlMs: number,
  now: number,
): AttributedRecentEdit[] {
  const result: AttributedRecentEdit[] = [];
  for (const other of others) {
    const ring = other.presence["recentEdits"];
    if (!Array.isArray(ring)) continue;
    for (const raw of ring) {
      const edit = raw as RecentEdit;
      if (!edit || typeof edit.at !== "number" || !edit.descriptor) continue;
      if (now - edit.at > ttlMs) continue;
      result.push({
        ...edit,
        clientId: other.clientId,
        user: other.user,
        isAgent: other.isAgent,
      });
    }
  }
  result.sort((a, b) => a.at - b.at);
  return result;
}

export interface UseRecentEditsOptions {
  /** How long a highlight lingers after the edit. Default 6000ms. */
  ttlMs?: number;
}

/**
 * Reactive list of remote participants' recent edits that haven't expired.
 * Ticks internally (~500ms) while any highlight is visible so consumers can
 * render a smooth fade-out without wiring their own timers.
 */
export function useRecentEdits(
  others: OtherPresence[],
  options?: UseRecentEditsOptions,
): AttributedRecentEdit[] {
  const ttlMs = options?.ttlMs ?? RECENT_EDIT_TTL_MS;
  const [edits, setEdits] = useState<AttributedRecentEdit[]>([]);
  const othersRef = useRef(others);
  othersRef.current = others;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function tick() {
      const next = collectRecentEdits(othersRef.current, ttlMs, Date.now());
      setEdits((prev) => (recentEditsEqual(prev, next) ? prev : next));
      if (next.length > 0) {
        timer = setTimeout(tick, 500);
      } else {
        timer = null;
      }
    }

    tick();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [others, ttlMs]);

  return edits;
}

/**
 * Publish a local edit into this client's awareness ring so peers render a
 * lingering highlight for it. Call from app mutation paths (throttled by the
 * ring size + TTL; safe to call per committed edit, not per keystroke).
 */
export function publishRecentEdit(
  awareness: {
    getLocalState: () => Record<string, unknown> | null;
    setLocalStateField: (field: string, value: unknown) => void;
  },
  edit: Omit<RecentEdit, "at"> & { at?: number },
): void {
  const local = awareness.getLocalState();
  const existing = local?.["recentEdits"] as RecentEdit[] | undefined;
  awareness.setLocalStateField(
    "recentEdits",
    appendRecentEdit(existing, { ...edit, at: edit.at ?? Date.now() }),
  );
}

function recentEditsEqual(
  a: AttributedRecentEdit[],
  b: AttributedRecentEdit[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].clientId !== b[i].clientId || a[i].at !== b[i].at) return false;
  }
  return true;
}
