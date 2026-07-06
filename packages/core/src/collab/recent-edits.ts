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
 * Append an edit to a recentEdits ring, keeping the newest
 * {@link RECENT_EDITS_MAX} entries. Pure — returns a new array.
 */
export function appendRecentEdit(
  existing: RecentEdit[] | undefined,
  edit: RecentEdit,
): RecentEdit[] {
  const ring = Array.isArray(existing) ? existing.slice() : [];
  ring.push(edit);
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
