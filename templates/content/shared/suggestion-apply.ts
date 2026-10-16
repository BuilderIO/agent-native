import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import {
  SUPPORTED_SUGGESTION_MARKS,
  suggestionFrameShape,
  suggestionNodeRole,
} from "../app/components/editor/suggestions/model.js";
import { createContentEditorStructuralSchema } from "./content-editor-structural-schema.js";
import { nfmToDoc } from "./nfm.js";
import { resolveMarkdownSuggestionRange } from "./suggestion-rebase.js";

// Placing and checking one Markdown suggestion. The server adapter and the
// live-copy accept task both use these, so they must stay free of database
// and server imports: the task runs in a bounded worker.

export type MarkdownOperationPayload = {
  markdown: string;
  changedText?: string;
};

export type MarkdownRange = { from: number; to: number };

export type MarkdownOperationAnchor = MarkdownRange & {
  prefix: string;
  suffix: string;
  siblingRanges?: MarkdownRange[];
};

export type MarkdownSuggestionOperationLike = {
  kind: string;
  before?: unknown;
  after?: unknown;
  anchor?: unknown;
};

export function markdownPayload(
  value: unknown,
  label: "before" | "after",
): MarkdownOperationPayload {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { markdown?: unknown }).markdown !== "string"
  ) {
    throw new Error(
      `Content suggestions require ${label} as an object like {"markdown": "<the full current page Markdown>", "changedText": "<just the changed segment>"} — received ${value === null ? "null" : typeof value === "string" ? "a string; pass the object itself, not a JSON-encoded string" : typeof value}.`,
    );
  }
  const payload = value as MarkdownOperationPayload;
  if (payload.markdown.length > 1_000_000) {
    throw new Error("Content suggestion payload is too large");
  }
  return payload;
}

export function operationAnchor(operation: MarkdownSuggestionOperationLike) {
  const anchor = operation.anchor as Partial<MarkdownOperationAnchor> | null;
  if (
    !anchor ||
    !Number.isInteger(anchor.from) ||
    !Number.isInteger(anchor.to) ||
    typeof anchor.prefix !== "string" ||
    typeof anchor.suffix !== "string"
  ) {
    throw new Error(
      `Content suggestions require anchor as an object like {"from": <number>, "to": <number>, "prefix": "<text before the change>", "suffix": "<text after the change>"} — received ${anchor === null || anchor === undefined ? "no anchor" : typeof anchor === "string" ? "a string; pass the object itself, not a JSON-encoded string" : typeof anchor}.`,
    );
  }
  return anchor as MarkdownOperationAnchor;
}

/** Where the suggestion lands on `currentMarkdown`, or null when it can't. */
export function placeMarkdownSuggestion(
  currentMarkdown: string,
  operation: MarkdownSuggestionOperationLike,
): { from: number; to: number; changedText: string } | null {
  const before = markdownPayload(operation.before, "before");
  const after = markdownPayload(operation.after, "after");
  if (
    typeof before.changedText !== "string" ||
    typeof after.changedText !== "string"
  ) {
    return null;
  }
  operationAnchor(operation);
  const range = resolveMarkdownSuggestionRange(currentMarkdown, operation);
  return range ? { ...range, changedText: after.changedText } : null;
}

export function applyMarkdownSuggestionOperation(
  currentMarkdown: string,
  operation: MarkdownSuggestionOperationLike,
) {
  const before = markdownPayload(operation.before, "before");
  const after = markdownPayload(operation.after, "after");
  if (currentMarkdown === before.markdown) return after.markdown;
  const placed = placeMarkdownSuggestion(currentMarkdown, operation);
  if (!placed) return null;
  return `${currentMarkdown.slice(0, placed.from)}${placed.changedText}${currentMarkdown.slice(placed.to)}`;
}

export function withSiblingRanges<T extends MarkdownSuggestionOperationLike>(
  operation: T,
  ranges: MarkdownRange[],
): T {
  const anchor = operationAnchor(operation);
  const merged: MarkdownRange[] = [];
  for (const range of [...(anchor.siblingRanges ?? []), ...ranges].sort(
    (left, right) => left.from - right.from || left.to - right.to,
  )) {
    const last = merged[merged.length - 1];
    if (last && range.from < last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return { ...operation, anchor: { ...anchor, siblingRanges: merged } };
}

/**
 * The suggestion placed on `currentMarkdown`, retrying with the ranges of
 * accepted suggestions saved from the same text when the context it was
 * anchored to has since been rewritten by one of them.
 */
export function applyMarkdownSuggestionWithSiblings(
  currentMarkdown: string,
  operation: MarkdownSuggestionOperationLike,
  acceptedSiblingRanges: MarkdownRange[],
): string | null {
  const direct = applyMarkdownSuggestionOperation(currentMarkdown, operation);
  // Saved as a whole before and after, it applies only to that before-state.
  if (
    direct !== null ||
    !acceptedSiblingRanges.length ||
    operation.anchor == null
  )
    return direct;
  return applyMarkdownSuggestionOperation(
    currentMarkdown,
    withSiblingRanges(operation, acceptedSiblingRanges),
  );
}

let contentEditorSchema:
  | ReturnType<typeof createContentEditorStructuralSchema>
  | undefined;

export function suggestionEditorSchema() {
  contentEditorSchema ??= createContentEditorStructuralSchema();
  return contentEditorSchema;
}

type SuggestionDocumentJson = {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: SuggestionDocumentJson[];
};

function unsupportedNotionSpanAttrs(
  attrs: Record<string, unknown> | undefined,
) {
  const { underline: _underline, ...remaining } = attrs ?? {};
  const unsupported = Object.fromEntries(
    Object.entries(remaining).filter(
      ([name, value]) =>
        value !== null && (name !== "attrsJson" || value !== "{}"),
    ),
  );
  return Object.keys(unsupported).length ? unsupported : null;
}

function unsupportedRawNotionSpanAttrs(markdown: string) {
  return Array.from(markdown.matchAll(/<span\b([^>]*)>/gi)).flatMap(
    ([, source]) => {
      const attrs = Object.fromEntries(
        Array.from(
          source!.matchAll(
            /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
          ),
        )
          .map(([, name, doubleQuoted, singleQuoted, unquoted]) => [
            name!.toLowerCase(),
            doubleQuoted ?? singleQuoted ?? unquoted ?? "",
          ])
          .filter(
            ([name]) =>
              !["color", "bg_color", "underline", "href"].includes(name),
          ),
      );
      return Object.keys(attrs).length ? [attrs] : [];
    },
  );
}

export function parseSuggestionMarkdown(markdown: string) {
  return suggestionEditorSchema().nodeFromJSON(nfmToDoc(markdown));
}

function unsupportedSuggestionStructure(
  node: SuggestionDocumentJson,
  path: string[] = [],
  result: unknown[] = [],
): unknown[] {
  if (node.type === "text") {
    for (const mark of node.marks ?? []) {
      if (mark.type === "notionSpan") {
        const attrs = unsupportedNotionSpanAttrs(mark.attrs);
        if (attrs) result.push({ path, mark: { type: mark.type, attrs } });
        continue;
      }
      if (
        !SUPPORTED_SUGGESTION_MARKS.has(
          mark.type as Parameters<typeof SUPPORTED_SUGGESTION_MARKS.has>[0],
        )
      ) {
        result.push({ path, mark: { type: mark.type, attrs: mark.attrs } });
      }
    }
    return result;
  }
  const role = suggestionNodeRole(node.type ?? "");
  if (role === "frozen") {
    result.push({ path, node });
    return result;
  }
  if (role === "frame") {
    result.push({
      path,
      frame: suggestionFrameShape(
        node.type ?? "",
        node.attrs,
        (node.content ?? []).map((child) => child.type ?? ""),
      ),
    });
  }
  for (const child of node.content ?? []) {
    unsupportedSuggestionStructure(child, [...path, node.type ?? ""], result);
  }
  return result;
}

function unchangedSurround(before: string, after: string): string {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  const maxSuffix = Math.min(before.length, after.length) - prefix;
  while (
    suffix < maxSuffix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1;
  }
  return `${before.slice(0, prefix)}${before.slice(before.length - suffix)}`;
}

function unsupportedStructureKey(doc: ProseMirrorNode): string {
  return JSON.stringify(
    unsupportedSuggestionStructure(doc.toJSON() as SuggestionDocumentJson),
  );
}

// The formatted text each frame holds, split at every frame edge. A change can
// keep every frame's shape and still move, rewrite, or format text on both
// sides of a cell or frame edge; it then changes two of these runs.
function frameTextRuns(doc: ProseMirrorNode): string[] {
  const runs = [""];
  const visit = (node: ProseMirrorNode) => {
    const frame = suggestionNodeRole(node.type.name) === "frame";
    if (frame) runs.push("");
    if (node.isText) runs[runs.length - 1] += JSON.stringify(node.toJSON());
    else if (node.isLeaf) runs[runs.length - 1] += "\n";
    node.forEach(visit);
    if (node.isBlock) runs[runs.length - 1] += "\n";
    if (frame) runs.push("");
  };
  visit(doc);
  return runs;
}

/**
 * The parsed `afterMarkdown` when the change keeps every structure
 * suggestions can't review (frames, frozen blocks, unsupported marks), or
 * null when it would change one.
 */
export function supportedSuggestionStructure(
  beforeMarkdown: string,
  afterMarkdown: string,
): ProseMirrorNode | null {
  const before = parseSuggestionMarkdown(beforeMarkdown);
  const after = parseSuggestionMarkdown(afterMarkdown);
  const surround = unsupportedStructureKey(
    parseSuggestionMarkdown(unchangedSurround(beforeMarkdown, afterMarkdown)),
  );
  const afterRuns = frameTextRuns(after);
  if (
    unsupportedStructureKey(before) !== surround ||
    unsupportedStructureKey(after) !== surround ||
    frameTextRuns(before).filter((run, index) => run !== afterRuns[index])
      .length > 1 ||
    JSON.stringify(unsupportedRawNotionSpanAttrs(beforeMarkdown)) !==
      JSON.stringify(unsupportedRawNotionSpanAttrs(afterMarkdown))
  ) {
    return null;
  }
  return after;
}
