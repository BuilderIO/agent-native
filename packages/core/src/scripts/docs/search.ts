/**
 * Core script: docs-search
 *
 * Search and read agent-native framework documentation.
 * Docs are bundled in @agent-native/core so they're always the right version.
 *
 * Usage:
 *   pnpm action docs-search --query "actions"
 *   pnpm action docs-search --slug authentication
 *   pnpm action docs-search --list
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "../utils.js";

interface DocMeta {
  slug: string;
  title: string;
  description: string;
}

interface DocFull extends DocMeta {
  body: string;
}

function getDocsDir(): string {
  // Resolve from the package root: src/scripts/docs/search.ts -> docs/content/
  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../docs/content",
  );
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

function loadAllDocs(): DocFull[] {
  const docsDir = getDocsDir();
  if (!fs.existsSync(docsDir)) return [];

  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"));
  return files.map((file) => {
    const raw = fs.readFileSync(path.join(docsDir, file), "utf-8");
    const slug = file.replace(/\.md$/, "");
    const { data, body } = parseFrontmatter(raw);
    return {
      slug,
      title: data.title || slug,
      description: data.description || "",
      body,
    };
  });
}

function searchDocs(query: string): DocMeta[] {
  const docs = loadAllDocs();
  const terms = query.toLowerCase().split(/\s+/);

  const scored = docs
    .map((doc) => {
      const searchText =
        `${doc.title} ${doc.description} ${doc.body}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (doc.title.toLowerCase().includes(term)) score += 10;
        if (doc.description.toLowerCase().includes(term)) score += 5;
        if (doc.slug.includes(term)) score += 8;
        // Count body occurrences
        const bodyMatches = searchText.split(term).length - 1;
        score += Math.min(bodyMatches, 5);
      }
      return { doc, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ doc }) => ({
    slug: doc.slug,
    title: doc.title,
    description: doc.description,
  }));
}

export default async function docsSearchScript(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action docs-search [options]

Options:
  --query <text>    Search docs by keyword (returns matching pages)
  --slug <slug>     Read a specific doc page by slug
  --list            List all available doc pages
  --help            Show this help message`);
    return;
  }

  if (parsed.list === "true") {
    const docs = loadAllDocs();
    const listing = docs.map((d) => ({
      slug: d.slug,
      title: d.title,
      description: d.description,
    }));
    console.log(JSON.stringify(listing, null, 2));
    return;
  }

  if (parsed.slug) {
    const docs = loadAllDocs();
    const doc = docs.find((d) => d.slug === parsed.slug);
    if (!doc) {
      console.log(`Doc not found: ${parsed.slug}`);
      console.log(`Available: ${docs.map((d) => d.slug).join(", ")}`);
      return;
    }
    console.log(`# ${doc.title}\n`);
    if (doc.description) console.log(`${doc.description}\n`);
    console.log(doc.body);
    return;
  }

  if (parsed.query) {
    const results = searchDocs(parsed.query);
    if (results.length === 0) {
      console.log(`No docs found matching "${parsed.query}".`);
      return;
    }
    console.log(`Found ${results.length} doc(s) matching "${parsed.query}":\n`);
    for (const result of results.slice(0, 8)) {
      console.log(`  ${result.slug} — ${result.title}`);
      if (result.description) {
        console.log(`    ${result.description}`);
      }
    }
    console.log(`\nUse --slug <slug> to read the full doc.`);
    return;
  }

  console.log("Provide --query, --slug, or --list. Use --help for details.");
}
