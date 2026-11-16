/**
 * "Fields to keep" on an API request: a list of dotted paths that cuts a
 * provider's JSON down to what later steps use, before any size budget looks at
 * it. One pull request is about 25 KB, so a list of three would otherwise lose
 * two to the cut. Both functions are pure: the list is checked once into a
 * `FieldsToKeep`, and the trim only ever removes data. It evaluates no code,
 * builds no pattern from the text, never changes its input, and walks with an
 * explicit stack so a deeply nested body cannot overflow it.
 */

export const MAX_KEEP_PATHS = 50;
export const MAX_KEEP_SEGMENTS = 8;
export const MAX_KEEP_SEGMENT_CHARS = 64;
// The names of a trimmed answer that matched nothing, as the report shows them.
export const MAX_MISSING_REPORT_CHARS = 1_200;
const MAX_SHOWN_PATH_CHARS = 80;

const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** A list that passed every rule: the paths as typed (trimmed) and each one's segments. */
export interface FieldsToKeep {
  readonly paths: readonly string[];
  readonly segments: readonly (readonly string[])[];
}

export type KeepCheck =
  | { ok: true; value: FieldsToKeep }
  | { ok: false; message: string };

function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function hasControl(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (isControl(text.charCodeAt(index))) return true;
  }
  return false;
}

/** A path as a refusal names it: control characters as `?`, cut at 80 characters. */
function shown(path: string): string {
  let out = "";
  for (let index = 0; index < path.length; index += 1) {
    if (out.length >= MAX_SHOWN_PATH_CHARS) return `${out}…`;
    out += isControl(path.charCodeAt(index)) ? "?" : path.charAt(index);
  }
  return out;
}

function refuse(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

/**
 * Checks the list a person typed. A refusal names the path that was wrong and
 * never any response data. Segments split on `.` and may hold anything else but
 * a control character (spaces, `$` and unicode are fine); the three names that
 * reach an object's prototype are refused outright.
 */
export function parseFieldsToKeep(value: unknown): KeepCheck {
  if (!Array.isArray(value)) {
    return refuse(
      `"fieldsToKeep" must be a list of dotted paths, such as ["number", "user.login"].`,
    );
  }
  if (value.length === 0) {
    return refuse(
      `"fieldsToKeep" is empty. Leave it out to keep the whole answer.`,
    );
  }
  if (value.length > MAX_KEEP_PATHS) {
    return refuse(`"fieldsToKeep" has more than ${MAX_KEEP_PATHS} paths.`);
  }
  const paths: string[] = [];
  const segments: string[][] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (typeof entry !== "string") {
      return refuse(`"fieldsToKeep" has an entry that is not text.`);
    }
    const path = entry.trim();
    const name = shown(path);
    if (hasControl(path)) {
      return refuse(`The path "${name}" has a control character.`);
    }
    const parts = path.split(".");
    if (parts.some((part) => part === "")) {
      return refuse(`The path "${name}" has an empty part.`);
    }
    if (parts.length > MAX_KEEP_SEGMENTS) {
      return refuse(
        `The path "${name}" has more than ${MAX_KEEP_SEGMENTS} parts.`,
      );
    }
    if (parts.some((part) => part.length > MAX_KEEP_SEGMENT_CHARS)) {
      return refuse(
        `The path "${name}" has a part longer than ${MAX_KEEP_SEGMENT_CHARS} characters.`,
      );
    }
    if (parts.some((part) => FORBIDDEN_SEGMENTS.has(part))) {
      return refuse(
        `The path "${name}" uses a name that cannot be kept (__proto__, constructor or prototype).`,
      );
    }
    if (seen.has(path)) {
      return refuse(`The path "${name}" is listed twice.`);
    }
    seen.add(path);
    paths.push(path);
    segments.push(parts);
  }
  return { ok: true, value: { paths, segments } };
}

interface KeepNode {
  readonly children: Map<string, KeepNode>;
  /** A path ends here: the whole value is kept, and anything below is moot. */
  whole: boolean;
  /** A value was found for it, so every path ending here or above counts as matched. */
  hit: boolean;
}

function newNode(): KeepNode {
  return { children: new Map(), whole: false, hit: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a walk of one value gives back: the kept part, and whether any path matched in it. */
type Outcome =
  | { kind: "dropped" }
  | { kind: "kept"; value: unknown; matched: boolean };

const DROPPED: Outcome = { kind: "dropped" };

interface Frame {
  readonly node: KeepNode;
  /** The list or the object this frame is cutting down. */
  readonly source: readonly unknown[] | Record<string, unknown>;
  /** An object's own keys, in the provider's order. */
  readonly keys: IterableIterator<string> | undefined;
  readonly out: unknown[] | Record<string, unknown>;
  /** The key the finished frame is written under in its parent object. */
  readonly slot: string | undefined;
  index: number;
  matched: boolean;
}

function frameFor(
  node: KeepNode,
  source: readonly unknown[] | Record<string, unknown>,
  slot: string | undefined,
): Frame {
  return {
    node,
    source,
    keys: Array.isArray(source) ? undefined : Object.keys(source).values(),
    out: Array.isArray(source) ? [] : {},
    slot,
    index: 0,
    matched: false,
  };
}

/** One value against one node: kept whole, dropped, or a frame to walk. */
function enter(
  node: KeepNode,
  value: unknown,
  slot: string | undefined,
): Outcome | Frame {
  if (node.whole) {
    node.hit = true;
    return { kind: "kept", value, matched: true };
  }
  if (Array.isArray(value) || isRecord(value)) {
    return frameFor(node, value, slot);
  }
  return DROPPED;
}

function isFrame(step: Outcome | Frame): step is Frame {
  return !("kind" in step);
}

/** The next unvisited child of a frame, or undefined when it has none left. */
function nextChild(
  frame: Frame,
): { value: unknown; node: KeepNode; slot: string | undefined } | undefined {
  const { source, keys } = frame;
  if (Array.isArray(source)) {
    if (frame.index >= source.length) return undefined;
    const value: unknown = source[frame.index];
    frame.index += 1;
    return { value, node: frame.node, slot: undefined };
  }
  if (!keys) return undefined;
  for (let next = keys.next(); !next.done; next = keys.next()) {
    const child = frame.node.children.get(next.value);
    if (child) {
      return {
        value: (source as Record<string, unknown>)[next.value],
        node: child,
        slot: next.value,
      };
    }
  }
  return undefined;
}

/** Writes a finished child into its parent. A list keeps what is a list or an object (a miss is `{}`); an object keeps only what matched. */
function absorb(parent: Frame, slot: string | undefined, outcome: Outcome) {
  if (outcome.kind === "dropped") return;
  if (outcome.matched) parent.matched = true;
  if (Array.isArray(parent.out)) {
    parent.out.push(outcome.value);
  } else if (outcome.matched && slot !== undefined) {
    parent.out[slot] = outcome.value;
  }
}

/** Runs the walk from the root. The parents wait in a list in the heap, so depth costs memory and never the call stack. */
function walk(
  root: readonly unknown[] | Record<string, unknown>,
  rootNode: KeepNode,
): unknown[] | Record<string, unknown> {
  const top = frameFor(rootNode, root, undefined);
  const parents: Frame[] = [];
  let frame = top;
  for (;;) {
    const child = nextChild(frame);
    if (child) {
      const step = enter(child.node, child.value, child.slot);
      if (isFrame(step)) {
        parents.push(frame);
        frame = step;
      } else {
        absorb(frame, child.slot, step);
      }
      continue;
    }
    const parent = parents.pop();
    if (!parent) return top.out;
    absorb(parent, frame.slot, {
      kind: "kept",
      value: frame.out,
      matched: frame.matched,
    });
    frame = parent;
  }
}

export interface KeptFields {
  /** The trimmed body. A body that is neither an object nor a list comes back as it was. */
  body: unknown;
  /** The paths, as typed, that matched nothing anywhere in the body. */
  missing: string[];
}

/**
 * Cuts `body` down to the listed paths. The nested shape stays (`user.login`
 * keeps `{"user":{"login":...}}`); a list is mapped over, and a top-level list
 * is treated the same way. A path that ends at a value keeps all of it, and a
 * broader path beats a longer one (`user` beats `user.login`). A scalar where an
 * object was expected drops that branch. Inside a list an object or list stays
 * in its place (empty when nothing matched in it) and a scalar is dropped; an
 * object keeps a key only when something matched under it. A path is missing
 * when it matched nothing anywhere in the body.
 */
export function keepFields(body: unknown, keep: FieldsToKeep): KeptFields {
  if (!Array.isArray(body) && !isRecord(body)) {
    return { body, missing: [...keep.paths] };
  }
  const root = newNode();
  const chains: KeepNode[][] = [];
  for (const parts of keep.segments) {
    const chain: KeepNode[] = [];
    let node = root;
    for (const part of parts) {
      let child = node.children.get(part);
      if (!child) {
        child = newNode();
        node.children.set(part, child);
      }
      chain.push(child);
      node = child;
    }
    node.whole = true;
    chains.push(chain);
  }
  // The walk keeps a node whole before it reaches the paths below it, so a broader path wins by never being asked.
  const kept = walk(body, root);
  const missing = keep.paths.filter(
    (_path, index) =>
      !(chains[index] ?? []).some((node) => node.whole && node.hit),
  );
  return { body: kept, missing };
}

export interface MissingReport {
  fieldsMissing: string[];
  /** How many more paths matched nothing than are listed; absent when all are. */
  fieldsMissingMore?: number;
}

/**
 * What the answer says about the paths that matched nothing, or undefined when
 * every path matched. Fifty long paths could fill the whole answer, so the list
 * stops at about 1,200 characters and counts the rest.
 */
export function reportMissing(
  missing: readonly string[],
): MissingReport | undefined {
  if (missing.length === 0) return undefined;
  const listed: string[] = [];
  let used = 2;
  for (const path of missing) {
    const cost = JSON.stringify(path).length + (listed.length > 0 ? 1 : 0);
    if (listed.length > 0 && used + cost > MAX_MISSING_REPORT_CHARS) break;
    listed.push(path);
    used += cost;
  }
  const more = missing.length - listed.length;
  return {
    fieldsMissing: listed,
    ...(more > 0 ? { fieldsMissingMore: more } : {}),
  };
}
