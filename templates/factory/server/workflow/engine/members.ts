import type { FlowItem } from "./types.js";

export const MEMBER_FIELDS = [
  "kind",
  "provider",
  "title",
  "url",
  "author",
  "occurredAt",
  "thread",
  "extras",
] as const;

/**
 * A short account of an item for a list: identity, title, link, who, when, and
 * where it came from. Text bodies and raw payloads are left out so a list of a
 * hundred items still fits a step.
 */
export function memberView(item: FlowItem): Record<string, unknown> {
  const view: Record<string, unknown> = { id: item.id };
  for (const key of MEMBER_FIELDS) {
    if (key in item.data) view[key] = item.data[key];
  }
  return view;
}

/** The inbox items a combined item stands for, so ending it ends them. */
export function collectMembers(items: readonly FlowItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.inbox) ids.add(item.id);
    for (const member of item.members ?? []) ids.add(member);
  }
  return [...ids];
}
