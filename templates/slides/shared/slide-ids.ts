import { nanoid } from "nanoid";

export function ensureUniqueSlideIds<T extends { id?: unknown }>(
  slides: readonly T[],
): {
  slides: T[];
  changed: boolean;
  originalIds: Array<string | null>;
} {
  const used = new Set<string>();
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

    let nextId = `slide-${nanoid(8)}`;
    while (used.has(nextId)) nextId = `slide-${nanoid(8)}`;
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
