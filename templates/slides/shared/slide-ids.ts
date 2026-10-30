import { nanoid } from "nanoid";

import { hashSlideContent } from "./slide-fit.js";

export function ensureUniqueSlideIds<T extends { id?: unknown }>(
  slides: readonly T[],
  createId: (index: number, attempt: number) => string = () =>
    `slide-${nanoid(8)}`,
): {
  slides: T[];
  changed: boolean;
  originalIds: Array<string | null>;
} {
  const used = new Set<string>();
  // A replacement must not claim an ID a later slide still holds, or that
  // slide is renamed in turn. Derived IDs make this reachable: a slide keeps
  // the ID an earlier repair gave its old position after a reorder.
  const held = new Set(
    (slides as readonly unknown[]).flatMap((slide) =>
      slide &&
      typeof slide === "object" &&
      "id" in slide &&
      typeof slide.id === "string"
        ? [slide.id]
        : [],
    ),
  );
  let changed = false;
  const originalIds: Array<string | null> = [];
  const repaired = slides.map((slide, index) => {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
      throw new Error(`Slide ${index + 1} must be an object.`);
    }
    const id = typeof slide.id === "string" ? slide.id : "";
    originalIds.push(id || null);
    if (id && !used.has(id)) {
      used.add(id);
      return slide;
    }

    let attempt = 0;
    let nextId = createId(index, attempt);
    while (used.has(nextId) || held.has(nextId)) {
      nextId = createId(index, ++attempt);
    }
    used.add(nextId);
    changed = true;
    return { ...slide, id: nextId } as T;
  });

  return { slides: repaired, changed, originalIds };
}

export function rebindCreativeContextSlideLabels<T extends { id?: unknown }>(
  slides: readonly T[],
  originalIds: readonly (string | null)[],
): T[] {
  return slides.map((slide, index) => {
    const originalId = originalIds[index];
    const nextId = typeof slide.id === "string" ? slide.id : null;
    if (!originalId || !nextId || originalId === nextId) return slide;

    const labels = (slide as unknown as Record<string, unknown>)
      .creativeContextReuseLabels;
    if (!Array.isArray(labels)) return slide;

    return {
      ...slide,
      creativeContextReuseLabels: labels.map((label) => {
        if (!label || typeof label !== "object" || Array.isArray(label)) {
          return label;
        }
        const record = label as Record<string, unknown>;
        return record.elementId === originalId
          ? { ...record, elementId: nextId }
          : label;
      }),
    } as T;
  });
}

export function repairDeckSlideReferences<T extends { id?: unknown }>(
  data: unknown,
  slides: readonly T[],
  originalIds: readonly (string | null)[],
): Record<string, unknown> {
  const repairedSlides = rebindCreativeContextSlideLabels(slides, originalIds);
  const repairedData: Record<string, unknown> = {
    ...(data && typeof data === "object" && !Array.isArray(data) ? data : {}),
    slides: repairedSlides,
  };

  const sourceImport = repairedData.sourceImport;
  if (
    !sourceImport ||
    typeof sourceImport !== "object" ||
    Array.isArray(sourceImport)
  ) {
    return repairedData;
  }

  const sourceImportRecord = sourceImport as Record<string, unknown>;
  const idsByOriginalId = new Map<string, string[]>();
  for (const [index, originalId] of originalIds.entries()) {
    const nextId = repairedSlides[index]?.id;
    if (!originalId || typeof nextId !== "string") continue;
    const ids = idsByOriginalId.get(originalId) ?? [];
    ids.push(nextId);
    idsByOriginalId.set(originalId, ids);
  }

  const mapOccurrences = (
    values: readonly unknown[],
    getId: (value: unknown) => unknown,
    replace: (value: unknown, id: string) => unknown,
  ) => {
    const occurrenceById = new Map<string, number>();
    return values.map((value) => {
      const originalId = getId(value);
      if (typeof originalId !== "string") return value;
      const ids = idsByOriginalId.get(originalId);
      if (!ids) return value;
      const occurrence = occurrenceById.get(originalId) ?? 0;
      occurrenceById.set(originalId, occurrence + 1);
      const nextId = ids[occurrence];
      return nextId ? replace(value, nextId) : value;
    });
  };

  const repairedSourceImport = { ...sourceImportRecord };
  if (Array.isArray(sourceImportRecord.slideIds)) {
    repairedSourceImport.slideIds = mapOccurrences(
      sourceImportRecord.slideIds,
      (value) => value,
      (_value, id) => id,
    );
  }
  if (Array.isArray(sourceImportRecord.slides)) {
    repairedSourceImport.slides = mapOccurrences(
      sourceImportRecord.slides,
      (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>).id
          : undefined,
      (value, id) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? { ...(value as Record<string, unknown>), id }
          : value,
    );
  }
  repairedData.sourceImport = repairedSourceImport;
  return repairedData;
}

/**
 * A replacement ID derived from the deck and the slide's position, so every
 * reader and writer of a deck whose repair is not saved yet agrees on it, and
 * the saved repair keeps the IDs an agent read before it.
 */
export function repairedSlideId(
  deckId: string,
  index: number,
  attempt: number,
): string {
  return `slide-${hashSlideContent(`${deckId}:${index}:${attempt}`).slice(0, 8)}`;
}

/**
 * The stored deck with duplicate or missing slide IDs replaced the way
 * get-deck reports them. Actions that find a slide by ID read the deck through
 * this, so an ID from a read that could not save the repair still names its
 * slide, and a write saves the repair along with its edit.
 */
export function withUniqueSlideIds<T>(deckId: string, deck: T): T {
  const slides = (deck as { slides?: unknown } | null)?.slides;
  if (!Array.isArray(slides)) return deck;
  const normalized = ensureUniqueSlideIds(
    slides as Array<{ id?: unknown }>,
    (index, attempt) => repairedSlideId(deckId, index, attempt),
  );
  if (!normalized.changed) return deck;
  return repairDeckSlideReferences(
    deck,
    normalized.slides,
    normalized.originalIds,
  ) as T;
}
