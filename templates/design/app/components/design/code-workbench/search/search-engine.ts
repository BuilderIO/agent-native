import type { WorkspaceFileEntry, WorkspaceProvider } from "../workspace/types";

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

const MAX_FILE_BYTES = 1 * 1024 * 1024;
const MAX_TOTAL_MATCHES = 5000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSearchRegExp(
  query: string,
  options: Pick<SearchOptions, "matchCase" | "wholeWord" | "regex">,
): RegExp {
  const source = options.regex ? query : escapeRegExp(query);
  const bounded = options.wholeWord ? `\\b(?:${source})\\b` : source;
  const flags = options.matchCase ? "g" : "gi";
  return new RegExp(bounded, flags);
}

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
  route: "open-buffer" | "provider";
}

export function planReplaceAllFile(hasOpenBuffer: boolean): ReplaceAllFilePlan {
  return { route: hasOpenBuffer ? "open-buffer" : "provider" };
}

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
      let rest = matchArgs.slice(1);
      if (typeof rest[rest.length - 1] === "object") {
        rest = rest.slice(0, -1);
      }
      const groups = rest.slice(0, -2);
      return replacement.replace(/\$(\d+)/g, (_all, index) => {
        const groupIndex = Number(index) - 1;
        return typeof groups[groupIndex] === "string" ? groups[groupIndex] : "";
      });
    }
    return replacement;
  });
  return { content, count };
}
