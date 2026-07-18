import fs from "node:fs";
import path from "node:path";

import {
  loadMigrationManifestsForProject,
  resolveMigrationSymbolMove,
  type MigrationManifest,
  type MigrationMove,
} from "./migration-manifest.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".output",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export interface DeprecatedImportFinding {
  file: string;
  line: number;
  from: string;
  to: string[];
  symbols: string[];
}

export interface ScanDeprecatedImportsOptions {
  root: string;
  manifests?: MigrationManifest[];
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (
        SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(entryPath);
      }
    }
  };
  visit(root);
  return files.sort();
}

function mergeMoves(
  manifests: MigrationManifest[],
): Record<string, MigrationMove> {
  const moves: Record<string, MigrationMove> = {};
  for (const manifest of manifests) Object.assign(moves, manifest.moves);
  return moves;
}

function importedNames(clause: string): string[] | null {
  const named = clause.match(/\{([\s\S]*?)\}/);
  if (!named) return null;
  return named[1]
    .split(",")
    .map((part) => part.trim().replace(/^type\s+/, ""))
    .filter(Boolean)
    .map((part) => part.split(/\s+as\s+/)[0].trim());
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function matchingMoveTargets(
  move: MigrationMove,
  names: string[] | null,
): { targets: string[]; symbols: string[] } | null {
  if (!move.symbols) {
    return { targets: [move.to], symbols: names ?? [] };
  }
  if (!names) {
    return { targets: [move.to], symbols: [] };
  }
  const targets = new Set<string>();
  const symbols: string[] = [];
  for (const name of names) {
    const resolved = resolveMigrationSymbolMove(move, name);
    if (!resolved) continue;
    targets.add(resolved.to);
    symbols.push(name);
  }
  if (symbols.length === 0) return null;
  return { targets: [...targets].sort(), symbols };
}

export function scanDeprecatedImports(
  options: ScanDeprecatedImportsOptions,
): DeprecatedImportFinding[] {
  const root = path.resolve(options.root);
  const manifests = options.manifests ?? loadMigrationManifestsForProject(root);
  const moves = mergeMoves(manifests);
  const findings: DeprecatedImportFinding[] = [];
  const fromDeclaration =
    /\b(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']\s*;?/g;
  const sideEffectImport = /\bimport\s+["']([^"']+)["']\s*;?/g;

  for (const file of sourceFiles(root)) {
    const text = fs.readFileSync(file, "utf-8");
    for (const match of text.matchAll(fromDeclaration)) {
      const from = match[3];
      const move = moves[from];
      if (!move) continue;
      const matched = matchingMoveTargets(move, importedNames(match[2]));
      if (!matched) continue;
      findings.push({
        file,
        line: lineAt(text, match.index ?? 0),
        from,
        to: matched.targets,
        symbols: matched.symbols,
      });
    }
    for (const match of text.matchAll(sideEffectImport)) {
      const from = match[1];
      const move = moves[from];
      if (!move || move.symbols) continue;
      findings.push({
        file,
        line: lineAt(text, match.index ?? 0),
        from,
        to: [move.to],
        symbols: [],
      });
    }
  }
  return findings;
}
