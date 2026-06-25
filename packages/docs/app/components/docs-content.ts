/**
 * Loads all markdown doc files from @agent-native/core at build time via Vite glob import.
 * The source of truth for docs lives in packages/core/docs/content/.
 * Provides parsed frontmatter, raw markdown, and heading extraction for TOC + search.
 */

import {
  DEFAULT_DOCS_LOCALE,
  docsPathForSlug,
  isDocsLocale,
  type DocsLocale,
} from "./docs-locale";

// Import all .md files from core's docs as raw strings
const mdModules = import.meta.glob("../../../core/docs/content/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Optional locale-specific docs live under packages/core/docs/content/locales/.
// Keep these lazy. Translated Markdown should load per locale + route, not all
// at startup, so non-English docs do not bloat the initial docs bundle.
const localizedMdLoaders = import.meta.glob(
  "../../../core/docs/content/locales/*/*.md",
  {
    query: "?raw",
    import: "default",
  },
) as Record<string, () => Promise<string>>;

export interface DocEntry {
  slug: string;
  title: string;
  description: string;
  search: string;
  body: string; // markdown body (without frontmatter)
  headings: { id: string; label: string; level: number }[];
}

export interface SearchEntry {
  page: string;
  path: string;
  section: string;
  sectionId: string;
  text: string;
  keywords: string;
}

interface MarkdownLine {
  lineNumber: number;
  text: string;
}

function parseFrontmatter(raw: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };

  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (m) data[m[1]] = m[2];
  }
  return { data, body: match[2] };
}

function nonFencedMarkdownLines(body: string): MarkdownLine[] {
  const lines = body.split("\n");
  const result: MarkdownLine[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    if (/^\s*(?:```|~~~)/.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      result.push({ lineNumber: index + 1, text });
    }
  }

  return result;
}

function extractHeadings(
  body: string,
): { id: string; label: string; level: number }[] {
  const headings: { id: string; label: string; level: number }[] = [];
  const pattern = /^(#{2,4})\s+(.+?)(?:\s+\{#([\w-]+)\})?\s*$/;
  for (const line of nonFencedMarkdownLines(body)) {
    const match = line.text.match(pattern);
    if (!match) continue;
    const level = match[1].length; // 2, 3, or 4
    const label = match[2].replace(/`([^`]+)`/g, "$1").trim();
    const id =
      match[3] ||
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    headings.push({ id, label, level });
  }
  return headings;
}

const docs = new Map<string, DocEntry>();
const localizedDocs = new Map<DocsLocale, Map<string, DocEntry>>();
const localizedDocPromises = new Map<string, Promise<DocEntry | undefined>>();

function docEntryFromPath(path: string, raw: string): DocEntry {
  const filename = path.split("/").pop()!;
  const slug = filename.replace(/\.md$/, "");
  const { data, body } = parseFrontmatter(raw);
  const headings = extractHeadings(body);
  return {
    slug,
    title: data.title || slug,
    description: data.description || "",
    search: data.search || "",
    body,
    headings,
  };
}

// Build the docs maps once.
for (const [path, raw] of Object.entries(mdModules)) {
  const entry = docEntryFromPath(path, raw);
  docs.set(entry.slug, entry);
}

function normalizeDocsLocale(locale: unknown): DocsLocale {
  return isDocsLocale(locale) ? locale : DEFAULT_DOCS_LOCALE;
}

function localizedDocKey(locale: DocsLocale, slug: string) {
  return `../../../core/docs/content/locales/${locale}/${slug}.md`;
}

function cacheLocalizedDoc(locale: DocsLocale, entry: DocEntry) {
  const localeDocs = localizedDocs.get(locale) ?? new Map<string, DocEntry>();
  localeDocs.set(entry.slug, entry);
  localizedDocs.set(locale, localeDocs);
}

export function getDoc(
  slug: string,
  locale: unknown = DEFAULT_DOCS_LOCALE,
): DocEntry | undefined {
  const docsLocale = normalizeDocsLocale(locale);
  if (docsLocale !== DEFAULT_DOCS_LOCALE) {
    const localized = localizedDocs.get(docsLocale)?.get(slug);
    if (localized) return localized;
  }
  return docs.get(slug);
}

export async function loadDoc(
  slug: string,
  locale: unknown = DEFAULT_DOCS_LOCALE,
): Promise<DocEntry | undefined> {
  const docsLocale = normalizeDocsLocale(locale);
  if (docsLocale === DEFAULT_DOCS_LOCALE) return docs.get(slug);

  const cached = localizedDocs.get(docsLocale)?.get(slug);
  if (cached) return cached;

  const key = localizedDocKey(docsLocale, slug);
  const loader = localizedMdLoaders[key];
  if (!loader) return docs.get(slug);

  const existingPromise = localizedDocPromises.get(key);
  if (existingPromise) return existingPromise;

  const promise = loader()
    .then((raw) => {
      const entry = docEntryFromPath(key, raw);
      cacheLocalizedDoc(docsLocale, entry);
      return entry;
    })
    .catch((error) => {
      localizedDocPromises.delete(key);
      throw error;
    });
  localizedDocPromises.set(key, promise);
  return promise;
}

export function hasLocalizedDoc(locale: unknown, slug: string): boolean {
  const docsLocale = normalizeDocsLocale(locale);
  if (docsLocale === DEFAULT_DOCS_LOCALE) return docs.has(slug);
  return Boolean(
    localizedDocs.get(docsLocale)?.has(slug) ||
    localizedMdLoaders[localizedDocKey(docsLocale, slug)],
  );
}

export function getAllDocs(locale: unknown = DEFAULT_DOCS_LOCALE): DocEntry[] {
  const docsLocale = normalizeDocsLocale(locale);
  if (docsLocale === DEFAULT_DOCS_LOCALE) return Array.from(docs.values());

  const overrides = localizedDocs.get(docsLocale);
  if (!overrides) return Array.from(docs.values());

  return Array.from(docs.values()).map((doc) => overrides.get(doc.slug) ?? doc);
}

export async function loadAllDocs(
  locale: unknown = DEFAULT_DOCS_LOCALE,
): Promise<DocEntry[]> {
  const docsLocale = normalizeDocsLocale(locale);
  if (docsLocale === DEFAULT_DOCS_LOCALE) return Array.from(docs.values());

  const prefix = `../../../core/docs/content/locales/${docsLocale}/`;
  await Promise.all(
    Object.keys(localizedMdLoaders)
      .filter((key) => key.startsWith(prefix))
      .map((key) => {
        const slug = key.split("/").pop()!.replace(/\.md$/, "");
        return loadDoc(slug, docsLocale);
      }),
  );
  return getAllDocs(docsLocale);
}

/** Build a search index from all markdown content */
function buildSearchIndexFromDocs(
  docsList: DocEntry[],
  locale: unknown = DEFAULT_DOCS_LOCALE,
) {
  const entries: SearchEntry[] = [];
  const docsLocale = normalizeDocsLocale(locale);

  for (const doc of docsList) {
    const path = docsPathForSlug(doc.slug, docsLocale);
    const lines = nonFencedMarkdownLines(doc.body);
    const lastLineNumber = lines.at(-1)?.lineNumber ?? 0;
    const sections: { id: string; label: string; startLine: number }[] = [];

    // Find all h2/h3 headings
    for (const line of lines) {
      const m = line.text.match(/^(#{2,3})\s+(.+?)(?:\s+\{#([\w-]+)\})?\s*$/);
      if (m) {
        const label = m[2].replace(/`([^`]+)`/g, "$1").trim();
        const id =
          m[3] ||
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        sections.push({ id, label, startLine: line.lineNumber });
      }
    }

    // Add a page-level entry for the title + intro text (before first h2/h3)
    const introEndLine =
      sections.length > 0 ? sections[0].startLine - 1 : lastLineNumber;
    const introText = lines
      .filter(
        (line) => line.lineNumber <= introEndLine, // i18n-ignore -- source-index field, not visible copy.
      )
      .map((line) => line.text)
      .filter((l) => !l.startsWith("#"))
      .join(" ")
      .replace(/[`*_\[\](){}]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const pageText =
      [doc.description, introText].filter(Boolean).join(" — ").trim() ||
      doc.title;
    entries.push({
      page: doc.title,
      path,
      section: doc.title,
      sectionId: "",
      text:
        pageText.length > 300
          ? pageText.slice(0, 300).replace(/\s\S*$/, "...")
          : pageText,
      keywords: doc.search,
    });

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const endLine =
        i + 1 < sections.length
          ? sections[i + 1].startLine - 1
          : lastLineNumber;
      const text = lines
        .filter(
          (line) =>
            line.lineNumber >= section.startLine && line.lineNumber <= endLine,
        )
        .map((line) => line.text)
        .filter((l) => !l.startsWith("#"))
        .join(" ")
        .replace(/[`*_\[\](){}]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (text.length < 10) continue;

      entries.push({
        page: doc.title,
        path,
        section: section.label,
        sectionId: section.id,
        text:
          text.length > 300
            ? text.slice(0, 300).replace(/\s\S*$/, "...")
            : text,
        keywords: "",
      });
    }
  }

  return entries;
}

export function buildSearchIndex(
  locale: unknown = DEFAULT_DOCS_LOCALE,
): SearchEntry[] {
  return buildSearchIndexFromDocs(getAllDocs(locale), locale);
}

export async function buildSearchIndexAsync(
  locale: unknown = DEFAULT_DOCS_LOCALE,
): Promise<SearchEntry[]> {
  return buildSearchIndexFromDocs(await loadAllDocs(locale), locale);
}
