import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface RepoMapEntry {
  file: string;
  inDegree: number;
  outDegree: number;
  bytes: number;
  tokens: number;
  exports: string[];
}

export interface RepoMapResult {
  root: string;
  subdir: string;
  files: number;
  internalEdges: number;
  tokensAll: number;
  tokensTop: number;
  coveragePct: number;
  entries: RepoMapEntry[];
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".react-router",
  ".turbo",
  ".cache",
  ".next",
]);

const SOURCE_EXT_RE = /\.(?:[cm]?tsx?)$/;
const TEST_FILE_RE = /(?:\.spec|\.test)\.[cm]?tsx?$/;
const IMPORT_SPEC_RE = /(?:from|import)\s*\(?['"]([^'"]+)['"]\)?/g;
const EXPORT_SYMBOL_RE =
  /^\s*export\s+(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;

function walkSourceFiles(
  dir: string,
  includeTests: boolean,
  out: string[] = [],
): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, includeTests, out);
    } else if (
      entry.isFile() &&
      SOURCE_EXT_RE.test(entry.name) &&
      (includeTests || !TEST_FILE_RE.test(entry.name))
    ) {
      out.push(full);
    }
  }
  return out;
}

function resolveImportCandidate(
  specifier: string,
  fromFile: string,
  baseDir: string,
  fileSet: ReadonlySet<string>,
): string | null {
  let rawTarget: string | null = null;
  if (specifier.startsWith(".")) {
    rawTarget = path.normalize(path.join(path.dirname(fromFile), specifier));
  } else if (specifier.startsWith("@/")) {
    rawTarget = path.normalize(path.join(baseDir, specifier.slice(2)));
  } else if (specifier.startsWith("@shared/")) {
    const parentShared = path.resolve(baseDir, "..", "shared");
    rawTarget = path.normalize(path.join(parentShared, specifier.slice(8)));
  } else {
    return null;
  }

  const stripped = rawTarget.replace(/\.[cm]?jsx?$/, "");
  const candidates = [
    rawTarget,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    `${stripped}.mts`,
    `${stripped}.cts`,
    path.join(stripped, "index.ts"),
    path.join(stripped, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function extractExports(source: string, limit = 8): string[] {
  const names: string[] = [];
  EXPORT_SYMBOL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPORT_SYMBOL_RE.exec(source)) !== null) {
    const name = match[1];
    if (name && !names.includes(name)) {
      names.push(name);
      if (names.length >= limit) break;
    }
  }
  return names;
}

export function buildRepoMap(
  repoRoot: string,
  subdir: string,
  options: { top?: number; includeTests?: boolean } = {},
): RepoMapResult {
  const topN = Math.max(1, options.top ?? 20);
  const includeTests = options.includeTests ?? false;
  const baseDir = path.resolve(repoRoot, subdir);
  const files = walkSourceFiles(baseDir, includeTests);
  const fileSet = new Set(files);
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const exportsByFile = new Map<string, string[]>();
  const bytesByFile = new Map<string, number>();
  let internalEdges = 0;

  for (const file of files) {
    const size = statSync(file).size;
    bytesByFile.set(file, size);
    const source = readFileSync(file, "utf8");
    exportsByFile.set(file, extractExports(source));
    const seenTargets = new Set<string>();
    IMPORT_SPEC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMPORT_SPEC_RE.exec(source)) !== null) {
      const spec = match[1];
      if (!spec) continue;
      const resolved = resolveImportCandidate(spec, file, baseDir, fileSet);
      if (!resolved || resolved === file || seenTargets.has(resolved)) continue;
      seenTargets.add(resolved);
      inDegree.set(resolved, (inDegree.get(resolved) ?? 0) + 1);
      internalEdges += 1;
    }
    outDegree.set(file, seenTargets.size);
  }

  const rankedFiles = [...files]
    .sort((a, b) => {
      const diff = (inDegree.get(b) ?? 0) - (inDegree.get(a) ?? 0);
      if (diff !== 0) return diff;
      return a.localeCompare(b);
    })
    .slice(0, topN);

  const tokensAll = Math.round(
    files.reduce((sum, f) => sum + (bytesByFile.get(f) ?? 0), 0) / 4,
  );
  const tokensTop = Math.round(
    rankedFiles.reduce((sum, f) => sum + (bytesByFile.get(f) ?? 0), 0) / 4,
  );
  const coveragePct =
    tokensAll > 0 ? Number(((100 * tokensTop) / tokensAll).toFixed(1)) : 0;

  const entries: RepoMapEntry[] = rankedFiles.map((file) => {
    const bytes = bytesByFile.get(file) ?? 0;
    return {
      file: path.relative(baseDir, file).replaceAll(path.sep, "/"),
      inDegree: inDegree.get(file) ?? 0,
      outDegree: outDegree.get(file) ?? 0,
      bytes,
      tokens: Math.round(bytes / 4),
      exports: exportsByFile.get(file) ?? [],
    };
  });

  return {
    root: repoRoot,
    subdir,
    files: files.length,
    internalEdges,
    tokensAll,
    tokensTop,
    coveragePct,
    entries,
  };
}

function formatText(result: RepoMapResult): string {
  const lines = [
    `# repo map: ${result.subdir}`,
    `files ${result.files}  internal_edges ${result.internalEdges}  tokens_all ~${result.tokensAll}  tokens_top${result.entries.length} ~${result.tokensTop} (${result.coveragePct.toFixed(1)}%)`,
    "",
  ];
  for (const entry of result.entries) {
    const syms =
      entry.exports.length > 0 ? `  [${entry.exports.join(", ")}]` : "";
    lines.push(
      `${String(entry.inDegree).padStart(4)}  ${entry.file} (~${entry.tokens}t)${syms}`,
    );
  }
  return lines.join("\n");
}

function parseArgs(argv: string[]) {
  let subdir = "";
  let top = 20;
  let json = false;
  let includeTests = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--include-tests") {
      includeTests = true;
    } else if (arg === "--top") {
      const next = argv[i + 1];
      if (!next || !/^\d+$/.test(next)) {
        throw new Error("--top requires a positive integer");
      }
      top = Number.parseInt(next, 10);
      i += 1;
    } else if (arg?.startsWith("--top=")) {
      const val = arg.slice("--top=".length);
      if (!/^\d+$/.test(val)) {
        throw new Error("--top requires a positive integer");
      }
      top = Number.parseInt(val, 10);
    } else if (arg && !arg.startsWith("-") && !subdir) {
      subdir = arg;
    }
  }
  return { subdir, top, json, includeTests };
}

function main(): void {
  const { subdir, top, json, includeTests } = parseArgs(process.argv.slice(2));
  if (!subdir) {
    console.error(
      "Usage: node --import tsx scripts/repo-map.ts <subdir> [--top N] [--include-tests] [--json]",
    );
    process.exit(2);
  }
  const result = buildRepoMap(process.cwd(), subdir, { top, includeTests });
  console.log(json ? JSON.stringify(result, null, 2) : formatText(result));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}
