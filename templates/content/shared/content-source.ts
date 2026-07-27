export const CONTENT_SOURCE_ROOT = "content";
export const CONTENT_SOURCE_EXTENSIONS = [".md", ".mdx"] as const;

export interface ContentSourceDocument {
  id: string;
  parentId: string | null;
  title: string;
  content: string;
  description?: string;
  icon: string | null;
  position: number;
  isFavorite: boolean;
  hideFromSearch: boolean;
  visibility?: "private" | "org" | "public";
  updatedAt?: string;
}

export interface ContentSourceFile {
  path: string;
  document: ContentSourceDocument;
}

export interface ContentSourceBundle {
  root: typeof CONTENT_SOURCE_ROOT;
  exportedAt: string;
  files: Record<string, string>;
}

export interface ParsedContentSourceFile {
  path: string;
  id?: string;
  parentId?: string | null;
  title: string;
  content: string;
  description?: string;
  icon?: string | null;
  position?: number;
  isFavorite?: boolean;
  hideFromSearch?: boolean;
  errors?: string[];
}

const FRONTMATTER_RE =
  /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n\r?\n|\r?\n|$)/;
const VALID_SOURCE_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

function basename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function stripExtension(name: string): string {
  return name.replace(/\.(mdx?|markdown)$/i, "");
}

function titleFromPath(filePath: string): string {
  return stripExtension(basename(filePath))
    .replace(/--[A-Za-z0-9_-]{4,128}$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

function parseFrontmatterValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.replace(/^['"]|['"]$/g, "");
  }
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = parseFrontmatterValue(match[2] ?? "");
  }
  return data;
}

function hasOwn(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function frontmatterLine(key: string, value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return `${key}: null`;
  if (typeof value === "boolean" || typeof value === "number") {
    return `${key}: ${String(value)}`;
  }
  return `${key}: ${JSON.stringify(String(value))}`;
}

function normalizeSourcePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return normalized;
}

export function isContentSourcePath(filePath: string): boolean {
  const normalized = normalizeSourcePath(filePath);
  if (!normalized) return false;
  if (isBuilderMdxSourcePath(normalized)) return false;
  return CONTENT_SOURCE_EXTENSIONS.some((ext) =>
    normalized.toLowerCase().endsWith(ext),
  );
}

export function isBuilderMdxSourcePath(filePath: string): boolean {
  const normalized = normalizeSourcePath(filePath);
  return !!normalized && normalized.toLowerCase().endsWith(".builder.mdx");
}

export function isValidContentSourceId(id: string | null | undefined): boolean {
  return !!id && VALID_SOURCE_ID_RE.test(id);
}

export function contentSourcePathForDocument(
  doc: Pick<ContentSourceDocument, "id" | "title">,
): string {
  return `${CONTENT_SOURCE_ROOT}/${slugifyTitle(doc.title)}--${doc.id}.mdx`;
}

export function serializeContentSourceDocument(
  doc: ContentSourceDocument,
): string {
  const frontmatter = [
    frontmatterLine("id", doc.id),
    frontmatterLine("title", doc.title || "Untitled"),
    frontmatterLine("description", doc.description),
    frontmatterLine("parentId", doc.parentId),
    frontmatterLine("icon", doc.icon),
    frontmatterLine("position", doc.position),
    frontmatterLine("isFavorite", doc.isFavorite),
    frontmatterLine("hideFromSearch", doc.hideFromSearch),
    frontmatterLine("visibility", doc.visibility),
    frontmatterLine("updatedAt", doc.updatedAt),
  ].filter(Boolean);
  return `---\n${frontmatter.join("\n")}\n---\n\n${doc.content ?? ""}`;
}

export function parseContentSourceFile(
  filePath: string,
  source: string,
): ParsedContentSourceFile {
  const match = source.match(FRONTMATTER_RE);
  const metadata = match ? parseFrontmatter(match[1]) : {};
  const content = match ? source.slice(match[0].length) : source;
  const errors: string[] = [];
  const rawId = typeof metadata.id === "string" ? metadata.id : undefined;
  const id = isValidContentSourceId(rawId) ? rawId : undefined;
  let parentId: string | null | undefined;
  if (hasOwn(metadata, "parentId")) {
    if (metadata.parentId === null) {
      parentId = null;
    } else if (
      typeof metadata.parentId === "string" &&
      isValidContentSourceId(metadata.parentId)
    ) {
      parentId = metadata.parentId;
    } else {
      errors.push("Invalid parentId frontmatter.");
    }
  }
  const rawTitle = typeof metadata.title === "string" ? metadata.title : "";
  const title = rawTitle.trim() || titleFromPath(filePath) || "Untitled";
  const rawPosition = metadata.position;

  return {
    path: filePath,
    id,
    parentId,
    title,
    content,
    description:
      typeof metadata.description === "string"
        ? metadata.description
        : undefined,
    icon: hasOwn(metadata, "icon")
      ? typeof metadata.icon === "string"
        ? metadata.icon
        : null
      : undefined,
    position:
      typeof rawPosition === "number" && Number.isFinite(rawPosition)
        ? rawPosition
        : undefined,
    isFavorite:
      typeof metadata.isFavorite === "boolean"
        ? metadata.isFavorite
        : undefined,
    hideFromSearch:
      typeof metadata.hideFromSearch === "boolean"
        ? metadata.hideFromSearch
        : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export function buildContentSourceBundle(
  documents: ContentSourceDocument[],
): ContentSourceBundle {
  const files: Record<string, string> = {};
  const usedPaths = new Set<string>();

  for (const doc of documents) {
    let filePath = contentSourcePathForDocument(doc);
    if (usedPaths.has(filePath)) {
      filePath = `${CONTENT_SOURCE_ROOT}/${slugifyTitle(doc.title)}--${doc.id}.mdx`;
    }
    usedPaths.add(filePath);
    files[filePath] = serializeContentSourceDocument(doc);
  }

  return {
    root: CONTENT_SOURCE_ROOT,
    exportedAt: new Date().toISOString(),
    files,
  };
}
