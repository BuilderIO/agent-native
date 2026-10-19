import { z } from "zod";

const focusItemSchema = z.object({
  objectId: z.string().max(200).optional(),
  selector: z.string().max(2000).optional(),
  runtimeSelector: z.string().max(2000).optional(),
  kind: z.string().max(40).optional(),
  tagName: z.string().max(40).optional(),
});

/** The slide and selected elements the user had open when they sent a chat message. */
export const slidesAgentFocusSchema = z.object({
  slideId: z.string().min(1).max(200).optional(),
  slideNumber: z.number().int().min(1).optional(),
  items: z.array(focusItemSchema).max(100),
});

export type SlidesAgentFocus = z.infer<typeof slidesAgentFocusSchema>;

export function selectionItemKey(item: unknown, index: number): string {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return `item-${index}`;
  }
  const record = item as Record<string, unknown>;
  for (const key of ["objectId", "selector", "runtimeSelector"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `item-${index}`;
}

export function focusItemFromSelectionItem(
  item: unknown,
): SlidesAgentFocus["items"][number] {
  if (!item || typeof item !== "object" || Array.isArray(item)) return {};
  const record = item as Record<string, unknown>;
  const focusItem: SlidesAgentFocus["items"][number] = {};
  for (const key of [
    "objectId",
    "selector",
    "runtimeSelector",
    "kind",
    "tagName",
  ] as const) {
    const value = record[key];
    if (typeof value === "string" && value) focusItem[key] = value;
  }
  return focusItem;
}
