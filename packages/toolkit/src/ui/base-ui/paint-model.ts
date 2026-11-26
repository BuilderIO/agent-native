import { requireItem } from "./indexed-item.js";
import {
  resolvePropertyToken,
  type PropertyBinding,
  type PropertyToken,
} from "./property-token-model.js";

export type PaintColor = PropertyBinding<string>;
export type PaintToken = PropertyToken<string>;

export interface PaintStop {
  id: string;
  offset: number;
  color: PaintColor;
}

interface PaintBase {
  id: string;
  visible: boolean;
  opacity: number;
}
export type Paint =
  | (PaintBase & { kind: "solid"; color: PaintColor })
  | (PaintBase & {
      kind: "linear";
      angle: number;
      stops: readonly PaintStop[];
    });

function sameColor(a: PaintColor, b: PaintColor) {
  return a === b || (a.value === b.value && a.token === b.token);
}

/** Compare the authored fills in stacking order, independently of document-local IDs. */
export function equalPaintStacks(
  a: readonly Paint[],
  b: readonly Paint[],
): boolean {
  if (a === b) return true;
  return (
    a.length === b.length &&
    a.every((paint, i) => {
      const other = requireItem(b, i);
      if (paint === other) return true;
      if (paint.visible !== other.visible || paint.opacity !== other.opacity)
        return false;
      if (paint.kind === "solid")
        return other.kind === "solid" && sameColor(paint.color, other.color);
      return (
        other.kind === "linear" &&
        paint.angle === other.angle &&
        paint.stops.length === other.stops.length &&
        paint.stops.every((stop, j) => {
          const corresponding = requireItem(other.stops, j);
          return (
            stop.offset === corresponding.offset &&
            sameColor(stop.color, corresponding.color)
          );
        })
      );
    })
  );
}

function editParts<T extends { id: string }>(
  source: readonly T[],
  next: readonly T[],
  prepare: (part: T, original: T) => (local: T) => T,
) {
  const indices = new Map(
    source.map((part, index) => [part.id, { index, original: part }]),
  );
  const edits = next.map((part) => {
    const match = indices.get(part.id);
    if (!match) return { part };
    const { index, original } = match;
    return {
      part,
      index,
      update: part === original ? undefined : prepare(part, original),
    };
  });
  return (target: readonly T[] = source): readonly T[] => {
    if (target === source) return next;
    if (source === next) return target;
    let reserved: Set<string> | undefined;
    return edits.map(({ part, index, update }) => {
      const local = index === undefined ? undefined : target[index];
      if (local) return update ? update(local) : local;
      reserved ??= new Set(target.map((part) => part.id));
      let id = part.id;
      for (let suffix = 1; reserved.has(id); suffix++)
        id = part.id + "-" + suffix;
      reserved.add(id);
      return id === part.id ? part : { ...part, id };
    });
  };
}

/** Prepare a shared edit once, then apply it to each layer's original, corresponding fills. */
export function createPaintStackEdit(
  source: readonly Paint[],
  next: readonly Paint[],
) {
  return editParts(source, next, (paint, original) => {
    if (paint.kind === "linear" && original.kind === "linear") {
      const stops = editParts(
        original.stops,
        paint.stops,
        (stop) => (local) => ({ ...stop, id: local.id }),
      );
      return (local) => ({
        ...paint,
        id: local.id,
        stops: local.kind === "linear" ? stops(local.stops) : paint.stops,
      });
    }
    return (local) => ({ ...paint, id: local.id });
  });
}

export function paintColor(color: PaintColor, tokens: readonly PaintToken[]) {
  return resolvePropertyToken(color, tokens);
}

/** Fills follow CSS stacking order, with the first paint nearest the viewer. */
export function paintBackground(
  paints: readonly Paint[],
  tokens: readonly PaintToken[],
) {
  const images = paints
    .filter((paint) => paint.visible)
    .map((paint) => {
      const css = (color: PaintColor) => {
        const value = paintColor(color, tokens);
        return paint.opacity === 100
          ? value
          : `color-mix(in srgb, ${value} ${paint.opacity}%, transparent)`;
      };
      if (paint.kind === "solid")
        return `linear-gradient(${css(paint.color)}, ${css(paint.color)})`;
      const stops = paint.stops
        .map((stop) => `${css(stop.color)} ${stop.offset}%`)
        .join(", ");
      return `linear-gradient(${paint.angle}deg, ${stops})`;
    });
  return images.length ? images.join(", ") : "none";
}
