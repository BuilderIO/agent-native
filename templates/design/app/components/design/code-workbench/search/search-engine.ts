import type { WorkspaceFileEntry, WorkspaceProvider } from "../workspace/types";

/**
 * Pure + async search engine for the workbench Search view. The matching
 * core (`findMatchesInText`) is pure and unit-testable; `searchWorkspace`
 * orchestrates reading provider files through an in-memory content cache.
 */

export interface SearchMatch {
  line: number;
  column: number;
  length: number;
  lineText: string;
}

export interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

const MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_TOTAL_MATCHES = 5000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the search RegExp for a query + options. Throws on invalid regex
 * input (caller surfaces as an inline error, never a toast loop).
 */
export function buildSearchRegExp(
  query: string,
  options: Pick<SearchOptions, "matchCase" | "wholeWord" | "regex">,
): RegExp {
  const source = options.regex ? query : escapeRegExp(query);
  const bounded = options.wholeWord ? `\\b(?:${source})\\b` : source;
  const flags = options.matchCase ? "g" : "gi";
  return new RegExp(bounded, flags);
}

/**
 * Pure matching core: find all matches of `query` in `text` given options.
 * Returns per-line matches with 1-based line/column, matching Monaco's
 * position convention.
 */
export function findMatchesInText(
  text: string,
  query: string,
  options: SearchOptions,
): SearchMatch[] {
  if (!query) return [];
  let regex: RegExp;
  try {
    regex = buildSearchRegExp(query, options);
  } catch {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/);
  const matches: SearchMatch[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex]!;
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((match = regex.exec(lineText))) {
      const matchedText = match[0];
      matches.push({
        line: lineIndex + 1,
        column: match.index + 1,
        length: matchedText.length,
        lineText,
      });
      if (matchedText.length === 0) {
        regex.lastIndex += 1;
      }
    }
  }
  return matches;
}

export interface FileSearchResult {
  providerKey: string;
  path: string;
  matches: SearchMatch[];
}

export interface SearchResults {
  files: FileSearchResult[];
  totalMatches: number;
  capped: boolean;
  error?: string;
}

interface CacheEntry {
  versionHash: string | undefined;
  content: string;
}

const contentCache = new Map<string, CacheEntry>();

function cacheKey(providerKey: string, path: string): string {
  return `${providerKey}::${path}`;
}

/** Invalidate one cached file, or the whole cache when called with no args. */
export function invalidate(providerKey?: string, path?: string): void {
  if (!providerKey) {
    contentCache.clear();
    return;
  }
  if (!path) {
    for (const key of contentCache.keys()) {
      if (key.startsWith(`${providerKey}::`)) contentCache.delete(key);
    }
    return;
  }
  contentCache.delete(cacheKey(providerKey, path));
}

async function readCached(
  provider: WorkspaceProvider,
  entry: WorkspaceFileEntry,
): Promise<string | null> {
  if (entry.size !== undefined && entry.size > MAX_FILE_BYTES) return null;
  const key = cacheKey(provider.key, entry.path);
  const read = await provider.readFile(entry.path);
  const cached = contentCache.get(key);
  if (cached && cached.versionHash === read.versionHash) {
    return cached.content;
  }
  if (read.content.length > MAX_FILE_BYTES) return null;
  contentCache.set(key, {
    versionHash: read.versionHash,
    content: read.content,
  });
  return read.content;
}

export interface SearchWorkspaceArgs {
  providers: WorkspaceProvider[];
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  signal?: AbortSignal;
}

/**
 * Search all files across the given providers. Caps at 1 MB per file and
 * 5,000 total matches (returns `capped: true` once the cap is hit).
 */
export async function searchWorkspace(
  args: SearchWorkspaceArgs,
): Promise<SearchResults> {
  const { providers, query, matchCase, wholeWord, regex, signal } = args;
  const results: FileSearchResult[] = [];
  if (!query) return { files: results, totalMatches: 0, capped: false };

  try {
    buildSearchRegExp(query, { matchCase, wholeWord, regex });
  } catch (error) {
    return {
      files: results,
      totalMatches: 0,
      capped: false,
      error:
        error instanceof Error
          ? error.message
          : "Invalid pattern" /* i18n-ignore */,
    };
  }

  let totalMatches = 0;
  let capped = false;

  for (const provider of providers) {
    if (signal?.aborted) break;
    let entries: WorkspaceFileEntry[];
    try {
      entries = await provider.listFiles();
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (signal?.aborted || capped) break;
      let content: string | null;
      try {
        content = await readCached(provider, entry);
      } catch {
        continue;
      }
      if (content === null) continue;
      const matches = findMatchesInText(content, query, {
        matchCase,
        wholeWord,
        regex,
      });
      if (matches.length === 0) continue;
      const remaining = MAX_TOTAL_MATCHES - totalMatches;
      const bounded =
        matches.length > remaining ? matches.slice(0, remaining) : matches;
      totalMatches += bounded.length;
      results.push({
        providerKey: provider.key,
        path: entry.path,
        matches: bounded,
      });
      if (totalMatches >= MAX_TOTAL_MATCHES) capped = true;
    }
  }

  return { files: results, totalMatches, capped };
}

/**
 * Read-modify-write a single match/all-matches replacement into one file
 * through the provider. Caller is responsible for computing the replacement
 * text per match (this just persists the final content).
 */
export async function replaceInFile(
  provider: WorkspaceProvider,
  path: string,
  nextContent: string,
  expectedVersionHash?: string,
): Promise<void> {
  await provider.writeFile(path, nextContent, expectedVersionHash);
  invalidate(provider.key, path);
}

export interface ReplaceAllFilePlan {
  /** "open-buffer" routes through the live Monaco model; "provider" reads
   * and writes the file directly through the workspace provider. */
  route: "open-buffer" | "provider";
}

/**
 * Replace All per-file routing decision: a file with a live open buffer must
 * have its replacement applied through the Monaco model (so undo/dirty
 * tracking and the versioned save pipeline stay correct) instead of a raw
 * provider read/write, which would silently clobber unsaved edits. Pure so
 * the routing logic is unit-testable without Monaco/DOM.
 */
export function planReplaceAllFile(hasOpenBuffer: boolean): ReplaceAllFilePlan {
  return { route: hasOpenBuffer ? "open-buffer" : "provider" };
}

/**
 * Apply a find/replace across text, honoring the same match options as
 * search. Pure helper used by Replace All.
 */
export function replaceMatchesInText(
  text: string,
  query: string,
  replacement: string,
  options: SearchOptions,
): { content: string; count: number } {
  if (!query) return { content: text, count: 0 };
  let regex: RegExp;
  try {
    regex = buildSearchRegExp(query, options);
  } catch {
    return { content: text, count: 0 };
  }
  let count = 0;
  const content = text.replace(regex, (...matchArgs) => {
    count += 1;
    if (options.regex) {
      // Support $1, $2, ... backreferences the way String.replace does.
      const groups = matchArgs.slice(1, -2);
      return replacement.replace(/\$(\d+)/g, (_all, index) => {
        const groupIndex = Number(index) - 1;
        return typeof groups[groupIndex] === "string" ? groups[groupIndex] : "";
      });
    }
    return replacement;
  });
  return { content, count };
}
