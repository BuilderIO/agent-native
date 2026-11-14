import { absolutePositionToRelativePosition } from "@tiptap/y-tiptap";
import * as Y from "yjs";

/** A Yjs item ID: the writer's client number and its clock. */
export interface YjsItemId {
  client: number;
  clock: number;
}

/** A Yjs relative position in the serialized form Yjs reads back. */
export interface YjsRelativePosition {
  type?: YjsItemId;
  item?: YjsItemId;
  assoc?: number;
}

/**
 * Where the reviewing editor showed a suggestion's words when it was
 * accepted, in the live copy. `from` sticks to the first character and `to`
 * to the last, so typing beside the words stays outside the range.
 */
export interface SuggestionPlacement {
  from: YjsRelativePosition;
  to: YjsRelativePosition;
}

/**
 * A letter, digit or combining mark. One typed onto either end of the placed
 * words makes a different word than was reviewed.
 */
export const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;

function itemId(value: unknown): YjsItemId | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { client, clock, ...rest } = value as Record<string, unknown>;
  return Object.keys(rest).length === 0 &&
    Number.isSafeInteger(client) &&
    Number.isSafeInteger(clock) &&
    (client as number) >= 0 &&
    (clock as number) >= 0
    ? { client: client as number, clock: clock as number }
    : null;
}

function relativePosition(value: unknown): YjsRelativePosition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  // No root type names: resolving one creates that root in the live copy.
  const { type, item, assoc, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length) return null;
  const position: YjsRelativePosition = {};
  if (type !== undefined) {
    const id = itemId(type);
    if (!id) return null;
    position.type = id;
  }
  if (item !== undefined) {
    const id = itemId(item);
    if (!id) return null;
    position.item = id;
  }
  if (!position.type && !position.item) return null;
  if (assoc !== undefined) {
    if (assoc !== -1 && assoc !== 0 && assoc !== 1) return null;
    position.assoc = assoc;
  }
  return position;
}

/** The placement an editor sent, or null when it isn't one. */
export function parseSuggestionPlacement(
  value: unknown,
): SuggestionPlacement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { from, to, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length) return null;
  const start = relativePosition(from);
  const end = relativePosition(to);
  return start && end ? { from: start, to: end } : null;
}

/** What an editor's Yjs binding holds: the live copy and its node mapping. */
export interface SuggestionPlacementBinding {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: Parameters<typeof absolutePositionToRelativePosition>[2];
}

/** The placement for a range of the editor's Page, or null without one. */
export function suggestionPlacementForRange(
  binding: SuggestionPlacementBinding,
  range: { from: number; to: number },
): SuggestionPlacement | null {
  try {
    const end = absolutePositionToRelativePosition(
      range.to,
      binding.type,
      binding.mapping,
    );
    const left = absolutePositionToRelativePosition(
      range.from,
      binding.type,
      binding.mapping,
    );
    // Stick to the first character rather than the one before it, so typing
    // right before the words stays outside them.
    const start = Y.createAbsolutePositionFromRelativePosition(
      left,
      binding.doc,
    );
    const from =
      start?.type instanceof Y.XmlText && start.index < start.type.length
        ? Y.createRelativePositionFromTypeIndex(start.type, start.index, 0)
        : left;
    return parseSuggestionPlacement({
      from: Y.relativePositionToJSON(from),
      to: Y.relativePositionToJSON(end),
    });
  } catch {
    // coercion-ok: without a placement the server places the accept itself.
    return null;
  }
}
