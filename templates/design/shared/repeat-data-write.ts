import {
  findRepeatItemFieldByKey,
  readRepeatData,
  type RepeatDataItem,
  type RepeatScalar,
  type RepeatSpan,
} from "./repeat-data.js";

export type RepeatWrite =
  | { status: "written"; html: string }
  | { status: "refused"; reason: string };

function refuse(reason: string): RepeatWrite {
  return { status: "refused", reason };
}

function literalFor(value: RepeatScalar, existing: string): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "0";
  }
  const quote = existing.startsWith('"') ? '"' : "'";
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(new RegExp(quote, "g"), `\\${quote}`)
    .replace(/\n/g, "\\n");
  return `${quote}${escaped}${quote}`;
}

function splice(html: string, span: RepeatSpan, replacement: string): string {
  return html.slice(0, span.start) + replacement + html.slice(span.end);
}

function itemsFor(
  html: string,
  xFor: string,
): { items: RepeatDataItem[] } | { reason: string } {
  const read = readRepeatData(html, xFor);
  if (read.status !== "read") return { reason: read.reason };
  return { items: read.items };
}

export function writeRepeatValue(args: {
  html: string;
  xFor: string;
  index: number;
  field?: string;
  value: RepeatScalar;
}): RepeatWrite {
  const found = itemsFor(args.html, args.xFor);
  if ("reason" in found) return refuse(found.reason);
  const item = found.items[args.index];
  if (!item) {
    return refuse(`No item at index ${args.index}.`);
  }
  if (item.kind === "scalar") {
    if (args.field) {
      return refuse("This item is a plain value and has no fields.");
    }
    const existing = args.html.slice(item.span.start, item.span.end);
    return {
      status: "written",
      html: splice(args.html, item.span, literalFor(args.value, existing)),
    };
  }
  if (!args.field) {
    return refuse("This item is an object; name the field to write.");
  }
  const field = item.fields.find((candidate) => candidate.key === args.field);
  if (!field) {
    return refuse(`No field "${args.field}" on this item.`);
  }
  const existing = args.html.slice(field.valueSpan.start, field.valueSpan.end);
  return {
    status: "written",
    html: splice(args.html, field.valueSpan, literalFor(args.value, existing)),
  };
}

export function writeRepeatValueByKey(args: {
  html: string;
  keyField: string;
  keyValue: string;
  field: string;
  value: RepeatScalar;
}): RepeatWrite {
  const found = findRepeatItemFieldByKey(
    args.html,
    args.keyField,
    args.keyValue,
    args.field,
  );
  if (found.status === "absent") {
    return refuse(
      `No item with ${args.keyField} ${args.keyValue} has a "${args.field}" field.`,
    );
  }
  if (found.status === "ambiguous") {
    return refuse(
      `${found.matches} items share ${args.keyField} ${args.keyValue}, so the row cannot be identified.`,
    );
  }
  const existing = args.html.slice(
    found.field.valueSpan.start,
    found.field.valueSpan.end,
  );
  return {
    status: "written",
    html: splice(
      args.html,
      found.field.valueSpan,
      literalFor(args.value, existing),
    ),
  };
}

export function moveRepeatItem(args: {
  html: string;
  xFor: string;
  from: number;
  to: number;
}): RepeatWrite {
  const found = itemsFor(args.html, args.xFor);
  if ("reason" in found) return refuse(found.reason);
  const { items } = found;
  if (!items[args.from]) return refuse(`No item at index ${args.from}.`);
  if (args.to < 0 || args.to >= items.length) {
    return refuse(`Index ${args.to} is outside this list.`);
  }
  if (args.from === args.to) return { status: "written", html: args.html };

  const texts = items.map((item) =>
    args.html.slice(item.span.start, item.span.end),
  );
  const [moved] = texts.splice(args.from, 1);
  texts.splice(args.to, 0, moved!);
  return { status: "written", html: rewriteItems(args.html, items, texts) };
}

export function removeRepeatItem(args: {
  html: string;
  xFor: string;
  index: number;
}): RepeatWrite {
  const found = itemsFor(args.html, args.xFor);
  if ("reason" in found) return refuse(found.reason);
  const { items } = found;
  if (!items[args.index]) return refuse(`No item at index ${args.index}.`);
  const texts = items.map((item) =>
    args.html.slice(item.span.start, item.span.end),
  );
  texts.splice(args.index, 1);
  return { status: "written", html: rewriteItems(args.html, items, texts) };
}

export function duplicateRepeatItem(args: {
  html: string;
  xFor: string;
  index: number;
  keyField?: string;
}): RepeatWrite {
  const found = itemsFor(args.html, args.xFor);
  if ("reason" in found) return refuse(found.reason);
  const { items } = found;
  const item = items[args.index];
  if (!item) return refuse(`No item at index ${args.index}.`);
  const texts = items.map((candidate) =>
    args.html.slice(candidate.span.start, candidate.span.end),
  );
  let duplicate = texts[args.index]!;
  if (args.keyField) {
    if (item.kind !== "object") {
      return refuse("A keyed scalar item cannot be duplicated safely.");
    }
    const key = item.fields.find((field) => field.key === args.keyField);
    if (!key) {
      return refuse(`The duplicated item has no "${args.keyField}" key field.`);
    }
    const values = items.flatMap((candidate) =>
      candidate.kind === "object"
        ? candidate.fields
            .filter((field) => field.key === args.keyField)
            .map((field) => field.value)
        : [],
    );
    const nextKey = nextDuplicateKey(key.value, values);
    if (nextKey === undefined) {
      return refuse(
        `Could not create a unique string or safe-integer "${args.keyField}" key for the duplicate.`,
      );
    }
    const start = key.valueSpan.start - item.span.start;
    const end = key.valueSpan.end - item.span.start;
    duplicate = splice(
      duplicate,
      { start, end },
      literalFor(nextKey, duplicate.slice(start, end)),
    );
  }
  texts.splice(args.index + 1, 0, duplicate);
  return { status: "written", html: rewriteItems(args.html, items, texts) };
}

function nextDuplicateKey(
  value: RepeatScalar,
  keys: RepeatScalar[],
): string | number | undefined {
  const used = new Set(keys);
  if (typeof value === "number") {
    const max = Math.max(
      ...keys.filter((key): key is number => typeof key === "number"),
    );
    const candidate = Math.floor(max) + 1;
    return Number.isSafeInteger(candidate) &&
      candidate > max &&
      !used.has(candidate)
      ? candidate
      : undefined;
  }
  if (typeof value !== "string") return undefined;
  const base = `${value}-copy`;
  for (let suffix = 1; suffix <= used.size + 1; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return undefined;
}

function rewriteItems(
  html: string,
  items: RepeatDataItem[],
  texts: string[],
): string {
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const separator = separatorBetween(html, items) ?? ", ";
  return (
    html.slice(0, first.span.start) +
    texts.join(separator) +
    html.slice(last.span.end)
  );
}

function separatorBetween(
  html: string,
  items: RepeatDataItem[],
): string | null {
  if (items.length < 2) return null;
  const between = html.slice(items[0]!.span.end, items[1]!.span.start);
  return between.includes(",") ? between : null;
}
