const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const SAFE_LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const MARKDOWN_FILE_RE = /\.(md|markdown|mdx)$/i;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

export type ImportReference =
  | { kind: "remote"; url: string }
  | { kind: "anchor"; url: string }
  | { kind: "data-url"; mediaType: string; url: string }
  | { kind: "relative"; path: string }
  /** A relative path that climbs above the import root. */
  | { kind: "outside"; reference: string }
  | { kind: "unsupported"; reference: string };

/**
 * Classifies a link or image reference written in an imported file, resolving
 * relative paths against the file's own folder inside the import.
 */
export function classifyImportReference(
  sourcePath: string,
  reference: string,
): ImportReference {
  const trimmed = reference.trim();
  // Browsers drop tabs, newlines, and leading control characters from a URL,
  // so `java\tscript:` would run as `javascript:` while reading as a path.
  if (!trimmed || CONTROL_CHARACTER_RE.test(trimmed)) {
    return { kind: "unsupported", reference };
  }
  if (trimmed.startsWith("#")) return { kind: "anchor", url: trimmed };
  if (trimmed.startsWith("//")) {
    return { kind: "remote", url: `https:${trimmed}` };
  }

  const scheme = SCHEME_RE.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme === "data") {
      const mediaType =
        /^data:([^;,]+)/i.exec(trimmed)?.[1]?.toLowerCase() ?? "";
      return { kind: "data-url", mediaType, url: trimmed };
    }
    // A Windows drive path (C:\notes\a.png) parses as a one-letter scheme.
    if (scheme.length > 1) {
      return SAFE_LINK_SCHEMES.has(scheme)
        ? { kind: "remote", url: trimmed }
        : { kind: "unsupported", reference: trimmed };
    }
  }

  const path = resolveImportPath(sourcePath, trimmed);
  return path === null
    ? { kind: "outside", reference: trimmed }
    : { kind: "relative", path };
}

/**
 * Resolves `reference` against the folder holding `sourcePath`. Both are
 * import-root-relative. Returns null when either climbs above the root.
 */
export function resolveImportPath(
  sourcePath: string,
  reference: string,
): string | null {
  const withoutSuffix = reference.replace(/[?#].*$/, "");
  const decoded = safeDecode(withoutSuffix).replace(/\\/g, "/");
  const folder = decoded.startsWith("/")
    ? []
    : walkSegments([], sourcePath.replace(/\\/g, "/"))?.slice(0, -1);
  if (!folder) return null;
  const segments = walkSegments(folder, decoded);
  return segments?.length ? segments.join("/") : null;
}

export function isMarkdownFilePath(path: string): boolean {
  return MARKDOWN_FILE_RE.test(path);
}

/** Follows `path` down from `start`, or null when it climbs above the root. */
function walkSegments(start: string[], path: string): string[] | null {
  const segments = [...start];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
