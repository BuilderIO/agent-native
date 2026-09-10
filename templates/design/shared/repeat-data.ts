// Unreadable data returns an `unsupported` reason, never an empty list: a
// repeat shown with no data is indistinguishable from one over an empty array.

export interface RepeatSpan {
  start: number;
  end: number;
}

export type RepeatScalar = string | number | boolean | null;

export interface RepeatDataField {
  key: string;
  value: RepeatScalar;
  /** Span of the value only, so a write replaces the value and nothing else. */
  valueSpan: RepeatSpan;
}

export type RepeatDataItem =
  | { kind: "scalar"; value: RepeatScalar; span: RepeatSpan }
  | { kind: "object"; fields: RepeatDataField[]; span: RepeatSpan };

export type RepeatDataRead =
  | {
      status: "read";
      collection: string;
      items: RepeatDataItem[];
      arraySpan: RepeatSpan;
    }
  | { status: "not-found"; collection: string; reason: string }
  | { status: "unsupported"; collection: string; reason: string };

/**
 * `(stat, i) in stats` → `stats`. Returns null when the right-hand side is not
 * a bare identifier path, since only those can be located as a literal.
 */
export function repeatCollectionExpression(xFor: string): string | null {
  const right = xFor
    .split(/\s+in\s+/)
    .slice(1)
    .join(" in ")
    .trim();
  if (!right) return null;
  return /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(right)
    ? right
    : null;
}

function scriptRegions(html: string): RepeatSpan[] {
  const regions: RepeatSpan[] = [];
  const open = /<script\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = open.exec(html))) {
    const start = match.index + match[0].length;
    const closeAt = html.toLowerCase().indexOf("</script", start);
    const end = closeAt === -1 ? html.length : closeAt;
    regions.push({ start, end });
    open.lastIndex = end;
  }
  const xData = /\sx-data\s*=\s*"([^"]*)"/gi;
  while ((match = xData.exec(html))) {
    const start = match.index + match[0].indexOf(match[1]!);
    regions.push({ start, end: start + match[1]!.length });
  }
  return regions;
}

/** Index of the matching `]`, honouring nesting and string literals. */
function matchBracket(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i]!;
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

type ArrayLiteralLookup =
  | { status: "found"; span: RepeatSpan }
  | { status: "absent" }
  /** A name that cannot be resolved to one array without guessing. */
  | { status: "ambiguous"; reason: string };

/**
 * Locate the one array literal a collection names. A dotted path
 * (`column.cards`) is refused rather than matched by its leaf: several objects
 * can own a `cards` array, and picking the first writes a different collection
 * while reporting success.
 */
function locateArrayLiteral(
  html: string,
  collection: string,
): ArrayLiteralLookup {
  if (collection.includes(".")) {
    return {
      status: "ambiguous",
      reason: `"${collection}" is nested inside another collection, so it cannot be located without guessing which one.`,
    };
  }
  const leaf = collection;
  const pattern = new RegExp(
    `(?:^|[^A-Za-z0-9_$.])${leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:=]\\s*\\[`,
    "g",
  );
  const spans: RepeatSpan[] = [];
  for (const region of scriptRegions(html)) {
    const body = html.slice(region.start, region.end);
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body))) {
      const openIndex = body.indexOf("[", match.index);
      if (openIndex === -1) continue;
      const closeIndex = matchBracket(body, openIndex);
      if (closeIndex === -1) continue;
      spans.push({
        start: region.start + openIndex,
        end: region.start + closeIndex + 1,
      });
    }
  }
  if (spans.length === 0) return { status: "absent" };
  if (spans.length > 1) {
    return {
      status: "ambiguous",
      reason: `"${collection}" is declared ${spans.length} times in this document.`,
    };
  }
  return { status: "found", span: spans[0]! };
}

interface Cursor {
  source: string;
  at: number;
}

function skipTrivia(cursor: Cursor): void {
  while (cursor.at < cursor.source.length) {
    const char = cursor.source[cursor.at]!;
    if (/\s/.test(char)) {
      cursor.at += 1;
      continue;
    }
    if (char === "/" && cursor.source[cursor.at + 1] === "/") {
      const nl = cursor.source.indexOf("\n", cursor.at);
      cursor.at = nl === -1 ? cursor.source.length : nl;
      continue;
    }
    if (char === "/" && cursor.source[cursor.at + 1] === "*") {
      const close = cursor.source.indexOf("*/", cursor.at);
      cursor.at = close === -1 ? cursor.source.length : close + 2;
      continue;
    }
    return;
  }
}

function readScalar(
  cursor: Cursor,
): { value: RepeatScalar; span: RepeatSpan } | null {
  skipTrivia(cursor);
  const start = cursor.at;
  const char = cursor.source[start];
  if (char === '"' || char === "'") {
    let i = start + 1;
    let value = "";
    while (i < cursor.source.length) {
      const current = cursor.source[i]!;
      if (current === "\\") {
        value += cursor.source[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (current === char) {
        cursor.at = i + 1;
        return { value, span: { start, end: cursor.at } };
      }
      value += current;
      i += 1;
    }
    return null;
  }
  const rest = cursor.source.slice(start);
  const word = /^(true|false|null)(?![A-Za-z0-9_$])/.exec(rest);
  if (word) {
    cursor.at = start + word[0].length;
    const value = word[1] === "null" ? null : word[1] === "true";
    return { value, span: { start, end: cursor.at } };
  }
  const number = /^-?\d+(\.\d+)?(e[+-]?\d+)?/i.exec(rest);
  if (number) {
    cursor.at = start + number[0].length;
    return {
      value: Number(number[0]),
      span: { start, end: cursor.at },
    };
  }
  return null;
}

function readObject(
  cursor: Cursor,
): { fields: RepeatDataField[]; span: RepeatSpan } | null {
  skipTrivia(cursor);
  const start = cursor.at;
  if (cursor.source[start] !== "{") return null;
  cursor.at = start + 1;
  const fields: RepeatDataField[] = [];
  for (;;) {
    skipTrivia(cursor);
    if (cursor.source[cursor.at] === "}") {
      cursor.at += 1;
      return { fields, span: { start, end: cursor.at } };
    }
    const keyStart = cursor.at;
    const keyChar = cursor.source[keyStart];
    let key: string | null = null;
    if (keyChar === '"' || keyChar === "'") {
      const quoted = readScalar(cursor);
      key = typeof quoted?.value === "string" ? quoted.value : null;
    } else {
      const ident = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(
        cursor.source.slice(keyStart),
      );
      if (ident) {
        key = ident[0];
        cursor.at = keyStart + ident[0].length;
      }
    }
    if (!key) return null;
    skipTrivia(cursor);
    if (cursor.source[cursor.at] !== ":") return null;
    cursor.at += 1;
    const value = readScalar(cursor);
    if (!value) return null;
    fields.push({ key, value: value.value, valueSpan: value.span });
    skipTrivia(cursor);
    if (cursor.source[cursor.at] === ",") {
      cursor.at += 1;
      continue;
    }
    if (cursor.source[cursor.at] === "}") continue;
    return null;
  }
}

/**
 * Read the data behind one `x-for`. `html` must be the whole document: the
 * array lives in a `<script>` or `x-data`, not in the template body.
 */
export function readRepeatData(html: string, xFor: string): RepeatDataRead {
  const collection = repeatCollectionExpression(xFor);
  if (!collection) {
    return {
      status: "unsupported",
      collection: xFor,
      reason: "The iterated expression is not a plain identifier.",
    };
  }
  const lookup = locateArrayLiteral(html, collection);
  if (lookup.status === "ambiguous") {
    return { status: "unsupported", collection, reason: lookup.reason };
  }
  if (lookup.status === "absent") {
    return {
      status: "not-found",
      collection,
      reason: `No array literal named "${collection}" is declared in this document.`,
    };
  }
  const arraySpan = lookup.span;
  const inner = html.slice(arraySpan.start + 1, arraySpan.end - 1);
  const cursor: Cursor = { source: inner, at: 0 };
  const items: RepeatDataItem[] = [];
  const offset = arraySpan.start + 1;
  for (;;) {
    skipTrivia(cursor);
    if (cursor.at >= inner.length) break;
    if (inner[cursor.at] === ",") {
      cursor.at += 1;
      continue;
    }
    if (inner[cursor.at] === "{") {
      const object = readObject(cursor);
      if (!object) {
        return {
          status: "unsupported",
          collection,
          reason: "An item is not a flat object of literal values.",
        };
      }
      items.push({
        kind: "object",
        fields: object.fields.map((field) => ({
          ...field,
          valueSpan: {
            start: field.valueSpan.start + offset,
            end: field.valueSpan.end + offset,
          },
        })),
        span: {
          start: object.span.start + offset,
          end: object.span.end + offset,
        },
      });
      continue;
    }
    const scalar = readScalar(cursor);
    if (!scalar) {
      return {
        status: "unsupported",
        collection,
        reason: "An item is not a literal value.",
      };
    }
    items.push({
      kind: "scalar",
      value: scalar.value,
      span: {
        start: scalar.span.start + offset,
        end: scalar.span.end + offset,
      },
    });
  }
  return { status: "read", collection, items, arraySpan };
}

/**
 * Label for one data row. Prefers the field an author would recognise over the
 * index, matching how the panel names every other layer.
 */
/**
 * The field whose value labels this item, and so the field a rename writes.
 * Undefined when the label is not backed by a writable string field.
 */
export function repeatDataLabelField(
  item: RepeatDataItem,
  keyExpression?: string,
): string | undefined {
  if (item.kind !== "object") return undefined;
  const keyField = keyExpression?.split(".").pop();
  const keyed = item.fields.find((field) => field.key === keyField);
  if (keyed && typeof keyed.value === "string" && keyed.value) return keyed.key;
  return item.fields.find(
    (field) => typeof field.value === "string" && field.value,
  )?.key;
}

export function repeatDataItemLabel(
  item: RepeatDataItem,
  keyExpression?: string,
): string {
  if (item.kind === "scalar") return String(item.value);
  const keyField = keyExpression?.split(".").pop();
  const keyed = item.fields.find((field) => field.key === keyField);
  if (keyed && typeof keyed.value === "string" && keyed.value) {
    return keyed.value;
  }
  const firstString = item.fields.find(
    (field) => typeof field.value === "string" && field.value,
  );
  if (firstString) return String(firstString.value);
  const first = item.fields[0];
  return first ? `${first.key}: ${String(first.value)}` : "Item";
}

/** `(d, idx) in departures` → `d`. The name bindings inside the body use. */
export function repeatItemVariable(xFor: string): string | null {
  const left = xFor.split(/\s+in\s+/)[0]?.trim() ?? "";
  const bare = /^[A-Za-z_$][A-Za-z0-9_$]*$/.exec(left);
  if (bare) return bare[0];
  const grouped = /^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/.exec(left);
  return grouped?.[1] ?? null;
}

export type RepeatKeyLookup =
  | { status: "found"; field: RepeatDataField }
  | { status: "absent" }
  | { status: "ambiguous"; matches: number };

/**
 * Find the one item in the document whose key field holds `keyValue`, wherever
 * it lives. A derived collection (`filteredTasks`) has no literal to index, so
 * identity is the only safe way to reach the item a rendered row came from —
 * its position in the filtered list says nothing about its position in the
 * array behind it.
 */
export function findRepeatItemFieldByKey(
  html: string,
  keyField: string,
  keyValue: string,
  field: string,
): RepeatKeyLookup {
  const matches: RepeatDataField[] = [];
  const arrayStart = /(?:^|[^A-Za-z0-9_$.])[A-Za-z_$][A-Za-z0-9_$]*\s*[:=]\s*\[/g;
  for (const region of scriptRegions(html)) {
    const body = html.slice(region.start, region.end);
    arrayStart.lastIndex = 0;
    let hit: RegExpExecArray | null;
    while ((hit = arrayStart.exec(body))) {
      const openIndex = body.indexOf("[", hit.index);
      if (openIndex === -1) continue;
      const closeIndex = matchBracket(body, openIndex);
      if (closeIndex === -1) continue;
      const offset = region.start + openIndex + 1;
      const cursor: Cursor = {
        source: body.slice(openIndex + 1, closeIndex),
        at: 0,
      };
      for (;;) {
        skipTrivia(cursor);
        if (cursor.at >= cursor.source.length) break;
        if (cursor.source[cursor.at] === ",") {
          cursor.at += 1;
          continue;
        }
        if (cursor.source[cursor.at] !== "{") break;
        const object = readObject(cursor);
        if (!object) break;
        const keyed = object.fields.find(
          (candidate) => candidate.key === keyField,
        );
        if (!keyed || String(keyed.value) !== keyValue) continue;
        const target = object.fields.find(
          (candidate) => candidate.key === field,
        );
        if (!target) continue;
        matches.push({
          ...target,
          valueSpan: {
            start: target.valueSpan.start + offset,
            end: target.valueSpan.end + offset,
          },
        });
      }
      arrayStart.lastIndex = closeIndex;
    }
  }
  if (matches.length === 0) return { status: "absent" };
  if (matches.length > 1) {
    return { status: "ambiguous", matches: matches.length };
  }
  return { status: "found", field: matches[0]! };
}

export type RepeatBindingTarget =
  | { kind: "item" }
  | { kind: "field"; field: string };

/**
 * The part of an item a binding writes back to. `null` for anything that is
 * not a plain member read: a computed expression has no single value to write.
 */
export function repeatBindingTarget(
  expression: string,
  itemVariable: string,
): RepeatBindingTarget | null {
  const trimmed = expression.trim();
  if (trimmed === itemVariable) return { kind: "item" };
  const member = new RegExp(
    `^${itemVariable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.([A-Za-z_$][A-Za-z0-9_$]*)$`,
  ).exec(trimmed);
  return member ? { kind: "field", field: member[1]! } : null;
}

/**
 * Resolve `d.route` (or bare `h`) against one item. Returns undefined for any
 * expression that is not a plain member read, so a caller shows the binding
 * rather than a value it guessed.
 */
export function resolveRepeatBinding(
  expression: string,
  itemVariable: string,
  item: RepeatDataItem,
): RepeatScalar | undefined {
  const trimmed = expression.trim();
  if (trimmed === itemVariable) {
    return item.kind === "scalar" ? item.value : undefined;
  }
  const member = new RegExp(
    `^${itemVariable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.([A-Za-z_$][A-Za-z0-9_$]*)$`,
  ).exec(trimmed);
  if (!member || item.kind !== "object") return undefined;
  return item.fields.find((field) => field.key === member[1])?.value;
}
