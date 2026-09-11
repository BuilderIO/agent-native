import fs from "node:fs";
import path from "node:path";

import {
  loadMigrationManifestsForProject,
  migrationMoveStatus,
  resolveMigrationSymbolMove,
  type MigrationManifest,
  type MigrationMove,
  type MigrationMoveStatus,
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
  status: MigrationMoveStatus;
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
): Array<{
  status: MigrationMoveStatus;
  targets: string[];
  symbols: string[];
}> {
  if (!move.symbols) {
    return [
      {
        status: migrationMoveStatus(move),
        targets: [move.to],
        symbols: names ?? [],
      },
    ];
  }
  if (!names) {
    const groups = new Map<MigrationMoveStatus, Set<string>>();
    for (const importedName of Object.keys(move.symbols)) {
      const resolved = resolveMigrationSymbolMove(move, importedName);
      if (!resolved) continue;
      const targets = groups.get(resolved.status) ?? new Set<string>();
      targets.add(resolved.to);
      groups.set(resolved.status, targets);
    }
    return [...groups].map(([status, targets]) => ({
      status,
      targets: [...targets].sort(),
      symbols: [],
    }));
  }
  const groups = new Map<
    MigrationMoveStatus,
    { targets: Set<string>; symbols: string[] }
  >();
  for (const name of names) {
    const resolved = resolveMigrationSymbolMove(move, name);
    if (!resolved) continue;
    const group = groups.get(resolved.status) ?? {
      targets: new Set<string>(),
      symbols: [],
    };
    group.targets.add(resolved.to);
    group.symbols.push(name);
    groups.set(resolved.status, group);
  }
  return [...groups].map(([status, group]) => ({
    status,
    targets: [...group.targets].sort(),
    symbols: group.symbols,
  }));
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
      const matches = matchingMoveTargets(move, importedNames(match[2]));
      for (const matched of matches) {
        findings.push({
          file,
          line: lineAt(text, match.index ?? 0),
          from,
          to: matched.targets,
          symbols: matched.symbols,
          status: matched.status,
        });
      }
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
        status: migrationMoveStatus(move),
      });
    }
  }
  return findings;
}
