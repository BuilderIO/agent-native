/**
 * Loads all markdown doc files from content/ at build time via Vite glob import.
 * Provides parsed frontmatter, raw markdown, and heading extraction for TOC + search.
 */

// Import all .md files from content/ as raw strings
const mdModules = import.meta.glob("../../content/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface DocEntry {
  slug: string;
  title: string;
  description: string;
  raw: string; // full raw markdown (with frontmatter)
  body: string; // markdown body (without frontmatter)
  headings: { id: string; label: string; level: number }[];
}

export interface SearchEntry {
  page: string;
  path: string;
  section: string;
  sectionId: string;
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

function extractHeadings(
  body: string,
): { id: string; label: string; level: number }[] {
  const headings: { id: string; label: string; level: number }[] = [];
  const pattern = /^(#{2,3})\s+(.+?)(?:\s+\{#([\w-]+)\})?\s*$/gm;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const level = match[1].length; // 2 or 3
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

// Build the docs map once
const docs = new Map<string, DocEntry>();

for (const [path, raw] of Object.entries(mdModules)) {
  const filename = path.split("/").pop()!;
  const slug = filename.replace(/\.md$/, "");
  const { data, body } = parseFrontmatter(raw);
  const headings = extractHeadings(body);
  docs.set(slug, {
    slug,
    title: data.title || slug,
    description: data.description || "",
    raw,
    body,
    headings,
  });
}

export function getDoc(slug: string): DocEntry | undefined {
  return docs.get(slug);
}

export function getAllDocs(): DocEntry[] {
  return Array.from(docs.values());
}

/** Build a search index from all markdown content */
export function buildSearchIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];

  for (const doc of docs.values()) {
    const path = doc.slug === "getting-started" ? "/docs" : `/docs/${doc.slug}`;
    const lines = doc.body.split("\n");
    const sections: { id: string; label: string; startLine: number }[] = [];

    // Find all h2/h3 headings
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#{2,3})\s+(.+?)(?:\s+\{#([\w-]+)\})?\s*$/);
      if (m) {
        const label = m[2].replace(/`([^`]+)`/g, "$1").trim();
        const id =
          m[3] ||
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        sections.push({ id, label, startLine: i + 1 });
      }
    }

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const endLine =
        i + 1 < sections.length ? sections[i + 1].startLine - 1 : lines.length;
      const text = lines
        .slice(section.startLine, endLine)
        .filter((l) => !l.startsWith("```") && !l.startsWith("#"))
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
        text: text.length > 300 ? text.slice(0, 300).replace(/\s\S*$/, "...") : text,
      });
    }
  }

  return entries;
}
