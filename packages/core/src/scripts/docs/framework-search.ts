/**
 * Core script: framework-search
 *
 * Search the version-matched framework docs and readable source together.
 * This is intentionally bounded and read-only so every app chat can use the
 * same fallback when a question is not answered by the docs alone.
 */

import fs from "node:fs";

import {
  createTextMatcher,
  type TextSearchMode,
} from "../../search-utils/index.js";
import { parseArgs } from "../utils.js";
import { loadAllDocs, type DocFull } from "./search.js";
import { listSourceFiles, type SourceFile } from "./source-search.js";

type SearchScope = "all" | "docs" | "source";

interface SearchEntry {
  kind: "doc" | "source";
  path: string;
  title?: string;
  body: string;
  file?: SourceFile;
}

interface SearchHit {
  entry: SearchEntry;
  pathMatch: boolean;
  snippets: string[];
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const MAX_SNIPPETS_PER_RESULT = 3;

function parseScope(value: string | undefined): {
  value?: SearchScope;
  error?: string;
} {
  if (!value) return { value: "all" };
  if (value === "all" || value === "docs" || value === "source") {
    return { value };
  }
  return { error: `Invalid scope "${value}". Use all, docs, or source.` };
}

function parseMode(value: string | undefined): {
  value?: TextSearchMode;
  error?: string;
} {
  if (!value) return { value: "substring" };
  if (
    value === "substring" ||
    value === "glob" ||
    value === "sql-like" ||
    value === "regex"
  ) {
    return { value };
  }
  return {
    error: `Invalid mode "${value}". Use substring, glob, sql-like, or regex.`,
  };
}

function parseLimit(value: string | undefined): {
  value?: number;
  error?: string;
} {
  if (!value) return { value: DEFAULT_LIMIT };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { error: "Limit must be a positive integer." };
  }
  return { value: Math.min(parsed, MAX_LIMIT) };
}

function docsAsEntries(docs: DocFull[]): SearchEntry[] {
  return docs.map((doc) => ({
    kind: "doc",
    path: `docs/${doc.slug}`,
    title: doc.title,
    body: `${doc.title}\n${doc.description}\n${doc.body}`,
  }));
}

function sourceAsEntries(files: SourceFile[]): {
  entries: SearchEntry[];
  unreadable: number;
} {
  const entries: SearchEntry[] = [];
  let unreadable = 0;
  for (const file of files) {
    try {
      entries.push({
        kind: "source",
        path: file.relativePath,
        body: fs.readFileSync(file.absolutePath, "utf-8"),
        file,
      });
    } catch {
      unreadable += 1;
    }
  }
  return { entries, unreadable };
}

function snippetsForEntry(
  entry: SearchEntry,
  matcher: ReturnType<typeof createTextMatcher>,
  pathMatch: boolean,
): string[] {
  const snippets: string[] = [];
  const lines = entry.body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!matcher.matches(lines[index])) continue;
    const line = lines[index].trim();
    if (!line) continue;
    snippets.push(`${index + 1}: ${line.slice(0, 260)}`);
    if (snippets.length >= MAX_SNIPPETS_PER_RESULT) break;
  }
  if (snippets.length === 0 && pathMatch) {
    const firstLine = lines.find((line) => line.trim());
    if (firstLine) snippets.push(`1: ${firstLine.trim().slice(0, 260)}`);
  }
  return snippets;
}

function pathMatches(
  path: string,
  filter: string | undefined,
): { matches: boolean; error?: string } {
  if (!filter) return { matches: true };
  const matcher = createTextMatcher(filter, "glob");
  return { matches: matcher.matches(path), error: matcher.error };
}

async function searchFramework(options: {
  pattern: string;
  mode: TextSearchMode;
  scope: SearchScope;
  pathFilter?: string;
  limit: number;
}): Promise<{ hits: SearchHit[]; total: number; unreadable: number }> {
  const [docs, sourceResult] = await Promise.all([
    options.scope === "source" ? Promise.resolve([]) : loadAllDocs(),
    options.scope === "docs"
      ? Promise.resolve({ entries: [], unreadable: 0 })
      : Promise.resolve(sourceAsEntries(listSourceFiles())),
  ]);
  const entries = [
    ...(options.scope === "source" ? [] : docsAsEntries(docs)),
    ...(options.scope === "docs" ? [] : sourceResult.entries),
  ];
  const matcher = createTextMatcher(options.pattern, options.mode);
  if (matcher.error) {
    return { hits: [], total: 0, unreadable: 0 };
  }

  const hits: SearchHit[] = [];
  for (const entry of entries) {
    const pathResult = pathMatches(entry.path, options.pathFilter);
    if (pathResult.error) continue;
    if (!pathResult.matches) continue;
    const pathMatch = matcher.matches(entry.path);
    const contentMatch = matcher.matches(entry.body);
    if (!pathMatch && !contentMatch) continue;
    const snippets = snippetsForEntry(entry, matcher, pathMatch);
    hits.push({ entry, pathMatch, snippets });
  }

  // Keep the result deterministic and favor docs titles and exact path hits.
  hits.sort((a, b) => {
    const aScore = (a.pathMatch ? 2 : 0) + (a.entry.kind === "doc" ? 1 : 0);
    const bScore = (b.pathMatch ? 2 : 0) + (b.entry.kind === "doc" ? 1 : 0);
    return bScore - aScore || a.entry.path.localeCompare(b.entry.path);
  });
  return {
    hits: hits.slice(0, options.limit),
    total: hits.length,
    unreadable: sourceResult.unreadable,
  };
}

function printHelp(): void {
  console.log(`Usage: pnpm action framework-search [options]

Options:
  --pattern <text>   Text, wildcard, SQL-like, or regex pattern to search
  --query <text>     Alias for --pattern
  --scope <scope>    all, docs, or source (default: all)
  --mode <mode>      substring, glob, sql-like, or regex (default: substring)
  --path <glob>      Optional glob to limit matching paths
  --limit <number>   Maximum files to return (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT})
  --list             List the searchable docs and source roots
  --help             Show this help message`);
}

export default async function frameworkSearchScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help === "true") {
    printHelp();
    return;
  }

  const scopeResult = parseScope(parsed.scope);
  if (scopeResult.error) {
    console.log(scopeResult.error);
    return;
  }
  const scope = scopeResult.value!;
  const modeResult = parseMode(parsed.mode);
  if (modeResult.error) {
    console.log(modeResult.error);
    return;
  }
  const mode = modeResult.value!;
  const limitResult = parseLimit(parsed.limit);
  if (limitResult.error) {
    console.log(limitResult.error);
    return;
  }
  const limit = limitResult.value!;

  if (parsed.list === "true") {
    const [docs, sourceFiles] = await Promise.all([
      scope === "source" ? Promise.resolve([]) : loadAllDocs(),
      scope === "docs"
        ? Promise.resolve([])
        : Promise.resolve(listSourceFiles()),
    ]);
    console.log(
      JSON.stringify(
        {
          docs: docs.map((doc) => ({ slug: doc.slug, title: doc.title })),
          source: {
            files: sourceFiles.length,
            roots: Array.from(
              new Set(
                sourceFiles.map((file) => file.relativePath.split("/")[0]),
              ),
            ),
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const pattern = parsed.pattern ?? parsed.query;
  if (!pattern) {
    printHelp();
    return;
  }
  const matcher = createTextMatcher(pattern, mode);
  if (matcher.error) {
    console.log(matcher.error);
    return;
  }
  if (parsed.path) {
    const pathMatcher = createTextMatcher(parsed.path, "glob");
    if (pathMatcher.error) {
      console.log(pathMatcher.error);
      return;
    }
  }

  const result = await searchFramework({
    pattern,
    mode,
    scope,
    pathFilter: parsed.path,
    limit,
  });
  if (result.total === 0) {
    console.log(
      `No matches in the indexed ${scope} corpus for ${JSON.stringify(pattern)}.`,
    );
    console.log(
      "The search covers version-matched framework docs, runtime-visible skills, and readable Core, Toolkit, and first-party template source. A miss is not proof that an implementation is absent if the relevant package source is not published in this app.",
    );
    if (result.unreadable > 0) {
      console.log(`Skipped ${result.unreadable} unreadable source file(s).`);
    }
    return;
  }

  console.log(
    `Found ${result.total} matching file(s) in ${scope} using ${mode} mode for ${JSON.stringify(pattern)}:\n`,
  );
  for (const hit of result.hits) {
    const label = hit.entry.kind === "doc" ? "doc" : "source";
    console.log(
      `[${label}] ${hit.entry.path}${hit.entry.title ? ` - ${hit.entry.title}` : ""}`,
    );
    for (const snippet of hit.snippets) console.log(`  ${snippet}`);
    console.log("");
  }
  if (result.total > result.hits.length) {
    console.log(
      `Showing ${result.hits.length} of ${result.total} matching files. Refine --path, --pattern, or --limit for more targeted evidence.`,
    );
  }
  if (result.unreadable > 0) {
    console.log(`Skipped ${result.unreadable} unreadable source file(s).`);
  }
}
