import { nanoid } from "nanoid";

export function ensureUniqueSlideIds<T extends { id?: unknown }>(
  slides: readonly T[],
): { slides: T[]; changed: boolean } {
  const used = new Set<string>();
  let changed = false;
  const repaired = slides.map((slide) => {
    const id = typeof slide.id === "string" ? slide.id : "";
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

  return { slides: repaired, changed };
}
