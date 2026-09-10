import {
  readRepeatData,
  type RepeatDataItem,
  type RepeatScalar,
  type RepeatSpan,
} from "./repeat-data.js";

// Every span here indexes the html passed in, so a write invalidates every
// span the caller still holds. Re-read after each edit; never batch two.
export type RepeatWrite =
  | { status: "written"; html: string }
  | { status: "refused"; reason: string };

function refuse(reason: string): RepeatWrite {
  return { status: "refused", reason };
}

/** Re-serialize a value using the quote style already in the document. */
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

/**
 * Replace one value: a scalar item, or one field of an object item.
 * `field` is required for object items and rejected for scalars.
 */
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

/** Reorder one item. This is what dragging a repeated row means. */
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
}): RepeatWrite {
  const found = itemsFor(args.html, args.xFor);
  if ("reason" in found) return refuse(found.reason);
  const { items } = found;
  const item = items[args.index];
  if (!item) return refuse(`No item at index ${args.index}.`);
  const texts = items.map((candidate) =>
    args.html.slice(candidate.span.start, candidate.span.end),
  );
  texts.splice(args.index + 1, 0, texts[args.index]!);
  return { status: "written", html: rewriteItems(args.html, items, texts) };
}

/**
 * Rewrite the whole item region from the first item's start to the last item's
 * end. Writing each span in place cannot express insert or delete, and the
 * separator between items is not part of any item's span.
 */
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

/** Reuse the document's own separator so a rewrite keeps its formatting. */
function separatorBetween(
  html: string,
  items: RepeatDataItem[],
): string | null {
  if (items.length < 2) return null;
  const between = html.slice(items[0]!.span.end, items[1]!.span.start);
  return between.includes(",") ? between : null;
}
