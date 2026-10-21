import { validatePath } from "./engine.js";

/** One step into a value: a key, or an index into a list. */
type PathSegment = string | number;

/** A field a drop can write: a path field takes the whole path, a template field takes a `{{ path }}` hole. */
export type MapKind = "path" | "template";

/** The kind of value a drag carries. `unknown` is a preview field: no run has produced its value yet. */
export type SourceKind =
  | "text"
  | "number"
  | "boolean"
  | "list"
  | "object"
  | "empty"
  | "unknown";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The path to a value under `root`, or null when the path grammar cannot spell
 * it. The grammar has no quoted keys, so a key with a space, a dot or a quote
 * is not spellable, and neither are the blocked names. The grammar's own
 * validator makes the final call, so nothing unreadable is returned.
 */
function spell(root: string, segments: readonly PathSegment[]): string | null {
  let path = root;
  for (const segment of segments) {
    if (typeof segment === "number") path += `[${segment}]`;
    else if (IDENTIFIER.test(segment)) path += `.${segment}`;
    else return null;
  }
  return validatePath(path).ok ? path : null;
}

/** `item.<segments>`: a value in the item this step receives, such as `item.extras.tags[0]`. */
export function itemPath(segments: readonly PathSegment[]): string | null {
  return spell("item", segments);
}

/** `nodes.<identifier>.<segments>`: a value in another node's stored result. The identifier is the node's name, never its label. */
export function nodePath(
  identifier: string,
  segments: readonly PathSegment[],
): string | null {
  return IDENTIFIER.test(identifier)
    ? spell(`nodes.${identifier}`, segments)
    : null;
}

/**
 * What a drop writes into a field. A path field takes the path. A template
 * field gets the hole, after a space when it already has text, and a space the
 * text already ends with is not doubled.
 */
export function mappedValue(
  kind: MapKind,
  current: string,
  path: string,
): string {
  if (kind === "path") return path;
  const hole = `{{ ${path} }}`;
  if (current === "") return hole;
  return current.endsWith(" ") ? `${current}${hole}` : `${current} ${hole}`;
}

/**
 * A template renders plain values only: text, numbers, and true or false. A
 * list, an object, or a null fails when the workflow runs, so it is refused.
 * An unknown kind passes, because its value is not known until the run.
 */
export function canDropOnTemplate(source: SourceKind): boolean {
  return (
    source === "text" ||
    source === "number" ||
    source === "boolean" ||
    source === "unknown"
  );
}

/** Whether a field of this kind takes a drop of this source. A path field takes every kind. */
export function canDrop(target: MapKind, source: SourceKind): boolean {
  return target === "path" || canDropOnTemplate(source);
}
