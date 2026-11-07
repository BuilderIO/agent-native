import { memoizeByContent } from "./memoize-by-content";
import { commonPrefixLength, commonSuffixLength } from "./string-diff.js";

export type SourceEdit =
  | {
      kind: "full-replace";
      content: string;
    }
  | {
      kind: "exact-replace";
      search: string;
      replace: string;
    };

export type SourceInputErrorCode =
  | "source_path_required"
  | "source_path_invalid"
  | "search_text_required"
  | "search_text_not_found"
  | "search_text_ambiguous";

/**
 * A source path or edit that cannot apply as written. This module ships to the
 * browser, so it cannot throw the action runtime's typed failure itself;
 * server callers convert it with `failOnSourceInputError`.
 */
export class SourceInputError extends Error {
  readonly code: SourceInputErrorCode;

  constructor(code: SourceInputErrorCode, message: string) {
    super(message);
    this.name = "SourceInputError";
    this.code = code;
  }
}

function hashSourceContent(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${content.length}:${hash.toString(36)}`;
}

const memoizedSourceContentHash = memoizeByContent(64, hashSourceContent);

export function sourceContentHash(content: string): string {
  return memoizedSourceContentHash(content);
}

/** One splice that turns a known base document into `resultHash`'s content. */
export interface SourceContentPatch {
  start: number;
  deleteCount: number;
  text: string;
  resultHash: string;
}

export function sourceContentPatch(
  base: string,
  next: string,
): SourceContentPatch {
  const start = commonPrefixLength(base, next);
  const suffix = commonSuffixLength(
    base,
    next,
    Math.min(base.length, next.length) - start,
  );
  return {
    start,
    deleteCount: base.length - start - suffix,
    text: next.slice(start, next.length - suffix),
    resultHash: sourceContentHash(next),
  };
}

export function applySourceContentPatch(
  base: string,
  patch: SourceContentPatch,
): string {
  return (
    base.slice(0, patch.start) +
    patch.text +
    base.slice(patch.start + patch.deleteCount)
  );
}

export function normalizeInlineSourcePath(path: string): string {
  const normalized = path.trim().replace(/^\/+/, "");
  if (!normalized) {
    throw new SourceInputError(
      "source_path_required",
      "Source path is required.",
    );
  }
  if (
    normalized.includes("..") ||
    normalized.startsWith("~") ||
    normalized.includes("\\")
  ) {
    throw new SourceInputError("source_path_invalid", "Invalid source path.");
  }
  return normalized;
}

export function languageForSourcePath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".jsx")) return "javascriptreact";
  if (lower.endsWith(".tsx")) return "typescriptreact";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
  return "plaintext";
}

export function applySourceEdit(
  content: string,
  edit: SourceEdit,
): {
  content: string;
  changed: boolean;
  editsApplied: number;
} {
  if (edit.kind === "full-replace") {
    return {
      content: edit.content,
      changed: edit.content !== content,
      editsApplied: edit.content === content ? 0 : 1,
    };
  }

  if (!edit.search) {
    throw new SourceInputError(
      "search_text_required",
      "exact-replace requires non-empty search text.",
    );
  }
  const firstIndex = content.indexOf(edit.search);
  if (firstIndex === -1) {
    throw new SourceInputError(
      "search_text_not_found",
      "Search text was not found in the source file.",
    );
  }
  const secondIndex = content.indexOf(edit.search, firstIndex + 1);
  if (secondIndex !== -1) {
    throw new SourceInputError(
      "search_text_ambiguous",
      "Search text matched more than once. Add more surrounding context.",
    );
  }
  const nextContent =
    content.slice(0, firstIndex) +
    edit.replace +
    content.slice(firstIndex + edit.search.length);
  return {
    content: nextContent,
    changed: nextContent !== content,
    editsApplied: nextContent === content ? 0 : 1,
  };
}

function lineNumberAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function excerpt(value: string, max = 1200): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...`;
}

export function previewSourceDiff(before: string, after: string) {
  if (before === after) {
    return {
      changed: false,
      lineStart: null,
      lineEnd: null,
      bytesBefore: before.length,
      bytesAfter: after.length,
      beforeExcerpt: "",
      afterExcerpt: "",
    };
  }

  const prefix = commonPrefixLength(before, after);
  const suffix = commonSuffixLength(
    before,
    after,
    Math.min(before.length, after.length) - prefix,
  );
  const beforeEnd = before.length - suffix;
  const afterEnd = after.length - suffix;
  const lineStart = lineNumberAtOffset(before, prefix);
  const lineEnd = lineNumberAtOffset(before, beforeEnd);

  return {
    changed: true,
    lineStart,
    lineEnd,
    bytesBefore: before.length,
    bytesAfter: after.length,
    beforeExcerpt: excerpt(before.slice(prefix, beforeEnd)),
    afterExcerpt: excerpt(after.slice(prefix, afterEnd)),
  };
}
