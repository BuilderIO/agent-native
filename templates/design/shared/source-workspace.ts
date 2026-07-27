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

export function sourceContentHash(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${content.length}:${hash.toString(36)}`;
}

export function normalizeInlineSourcePath(path: string): string {
  const normalized = path.trim().replace(/^\/+/, "");
  if (!normalized) throw new Error("Source path is required.");
  if (
    normalized.includes("..") ||
    normalized.startsWith("~") ||
    normalized.includes("\\")
  ) {
    throw new Error("Invalid source path.");
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
    throw new Error("exact-replace requires non-empty search text.");
  }
  const firstIndex = content.indexOf(edit.search);
  if (firstIndex === -1) {
    throw new Error("Search text was not found in the source file.");
  }
  const secondIndex = content.indexOf(edit.search, firstIndex + 1);
  if (secondIndex !== -1) {
    throw new Error(
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

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) index += 1;
  return index;
}

function commonSuffixLength(
  a: string,
  b: string,
  prefixLength: number,
): number {
  const max = Math.min(a.length, b.length) - prefixLength;
  let index = 0;
  while (index < max && a[a.length - 1 - index] === b[b.length - 1 - index]) {
    index += 1;
  }
  return index;
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
  const suffix = commonSuffixLength(before, after, prefix);
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
