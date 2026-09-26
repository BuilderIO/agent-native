
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
  ttlMs?: number;
}

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
