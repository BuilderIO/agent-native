import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ExportValue = string | Record<string, ExportValue | null> | null;
type PackageManifest = {
  exports?: Record<string, ExportValue>;
  name?: string;
  sideEffects?: boolean | string[];
};
type MigrationMoveStatus = "active" | "planned";
type MigrationSymbolMove = {
  name?: string;
  status?: MigrationMoveStatus;
  to: string;
};
type MigrationMove = {
  status?: MigrationMoveStatus;
  symbols?: Record<string, string | MigrationSymbolMove>;
  to: string;
};
type MigrationManifest = {
  moves?: Record<string, MigrationMove>;
};
type ExportSnapshot = {
  exports?: Record<string, string[]>;
};

type GuardedPackage = {
  directory: string;
  name: string;
};

type ExportedSymbolCatalog = Record<string, Set<string>>;

interface ExportSourceProject {
  addSourceFileAtPath: (sourceFile: string) => {
    getExportedDeclarations: () => Map<string, unknown>;
  };
  getSourceFile: (sourceFile: string) =>
    | {
        getExportedDeclarations: () => Map<string, unknown>;
      }
    | undefined;
}

const GUARDED_PACKAGES: GuardedPackage[] = [
  { directory: "packages/core", name: "@agent-native/core" },
  { directory: "packages/toolkit", name: "@agent-native/toolkit" },
];

export type MigrationManifestViolation = {
  packageName: string;
  message: string;
};

function packageSpecifier(packageName: string, exportKey: string): string {
  return exportKey === "."
    ? packageName
    : `${packageName}${exportKey.slice(1)}`;
}

function tombstonePath(target: string): boolean {
  return /(?:^|[/.\\-])tombstone(?:[/.\\-]|$)/.test(target);
}

function runtimeTombstoneTarget(target: string): boolean {
  return tombstonePath(target) && /\.(?:[cm]?js)$/.test(target);
}

function tombstoneTarget(target: string): boolean {
  return tombstonePath(target) && /(?:\.d\.ts|\.(?:[cm]?js))$/.test(target);
}

function collectExportTargets(value: ExportValue): string[] {
  if (typeof value === "string") return [normalizePackagePath(value)];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectExportTargets);
}

function normalizePackagePath(value: string): string {
  return value.replace(/^\.\//, "");
}

function normalizedTargets(value: ExportValue): string[] {
  return [...new Set(collectExportTargets(value))].sort();
}

function hasExactMove(
  moves: Record<string, MigrationMove>,
  specifier: string,
): boolean {
  const move = moves[specifier];
  return Boolean(
    move &&
    typeof move === "object" &&
    typeof (move as { to?: unknown }).to === "string" &&
    (move as { to: string }).to.length > 0 &&
    move.status !== "planned",
  );
}

function moveStatus(move: Pick<MigrationMove, "status">): MigrationMoveStatus {
  return move.status === "planned" ? "planned" : "active";
}

function packageExportKey(packageName: string, specifier: string): string {
  return specifier === packageName
    ? "."
    : `.${specifier.slice(packageName.length)}`;
}

function packageNameForSpecifier(
  specifier: string,
  packageCatalog: Record<string, PackageManifest>,
): string | null {
  return (
    Object.keys(packageCatalog)
      .sort((left, right) => right.length - left.length)
      .find(
        (candidate) =>
          specifier === candidate || specifier.startsWith(`${candidate}/`),
      ) ?? null
  );
}

function substituteExportPattern(
  value: ExportValue,
  wildcard: string,
): ExportValue {
  if (typeof value === "string") return value.replaceAll("*", wildcard);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      substituteExportPattern(child, wildcard),
    ]),
  );
}

function exportValueForSpecifier(
  packageName: string,
  specifier: string,
  manifest: PackageManifest,
): ExportValue | undefined {
  const exportKey = packageExportKey(packageName, specifier);
  const exports = manifest.exports ?? {};
  if (exports[exportKey] !== undefined) return exports[exportKey];
  for (const [candidate, value] of Object.entries(exports)) {
    if (!candidate.includes("*")) continue;
    const [prefix, suffix] = candidate.split("*");
    if (!exportKey.startsWith(prefix) || !exportKey.endsWith(suffix)) continue;
    const wildcard = exportKey.slice(
      prefix.length,
      exportKey.length - suffix.length,
    );
    return substituteExportPattern(value, wildcard);
  }
  return undefined;
}

function targetIsExported(
  target: string,
  packageCatalog: Record<string, PackageManifest>,
): boolean {
  const packageName = packageNameForSpecifier(target, packageCatalog);
  if (!packageName) return false;
  return (
    exportValueForSpecifier(
      packageName,
      target,
      packageCatalog[packageName],
    ) !== undefined
  );
}

function activeMoveTargets(move: MigrationMove): string[] {
  if (!move.symbols) {
    return moveStatus(move) === "active" ? [move.to] : [];
  }
  const targets = new Set<string>();
  for (const symbolMove of Object.values(move.symbols)) {
    if (typeof symbolMove === "string") {
      if (moveStatus(move) === "active") targets.add(move.to);
      continue;
    }
    const status = symbolMove.status ?? moveStatus(move);
    if (status === "active") targets.add(symbolMove.to);
  }
  return [...targets];
}

function sourceFileForSpecifier(
  repoRoot: string,
  specifier: string,
  packageCatalog: Record<string, PackageManifest>,
  packageDirectories: Record<string, string>,
): string | null {
  const packageName = packageNameForSpecifier(specifier, packageCatalog);
  if (!packageName) return null;
  const exportValue = exportValueForSpecifier(
    packageName,
    specifier,
    packageCatalog[packageName],
  );
  if (exportValue === undefined) return null;
  const targets = collectExportTargets(exportValue).sort((left, right) => {
    const leftTypes = left.endsWith(".d.ts") ? 0 : 1;
    const rightTypes = right.endsWith(".d.ts") ? 0 : 1;
    return leftTypes - rightTypes;
  });
  for (const target of targets) {
    if (!/\.(?:d\.ts|[cm]?js)$/.test(target)) continue;
    const sourceBase = target
      .replace(/^dist\//, "src/")
      .replace(/\.d\.ts$/, "")
      .replace(/\.[cm]?js$/, "");
    for (const extension of [".ts", ".tsx"]) {
      const candidate = path.join(
        repoRoot,
        packageDirectories[packageName],
        `${sourceBase}${extension}`,
      );
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function buildExportedSymbolCatalog(
  repoRoot: string,
  manifests: MigrationManifest[],
  packageCatalog: Record<string, PackageManifest>,
  packageDirectories: Record<string, string>,
): ExportedSymbolCatalog {
  const specifiers = new Set<string>();
  for (const manifest of manifests) {
    for (const [from, move] of Object.entries(manifest.moves ?? {})) {
      specifiers.add(from);
      for (const target of activeMoveTargets(move)) specifiers.add(target);
    }
  }
  const { Project } = createRequire(
    path.join(repoRoot, "packages/core/package.json"),
  )("ts-morph") as {
    Project: new (options: { tsConfigFilePath: string }) => ExportSourceProject;
  };
  const projects = Object.fromEntries(
    Object.entries(packageDirectories).map(([packageName, directory]) => [
      packageName,
      new Project({
        tsConfigFilePath: path.join(repoRoot, directory, "tsconfig.json"),
      }),
    ]),
  );
  const catalog: ExportedSymbolCatalog = {};
  for (const specifier of specifiers) {
    const sourceFile = sourceFileForSpecifier(
      repoRoot,
      specifier,
      packageCatalog,
      packageDirectories,
    );
    if (!sourceFile) continue;
    const packageName = packageNameForSpecifier(specifier, packageCatalog);
    if (!packageName) continue;
    const project = projects[packageName];
    const declarations = (
      project.getSourceFile(sourceFile) ??
      project.addSourceFileAtPath(sourceFile)
    ).getExportedDeclarations();
    catalog[specifier] = new Set(declarations.keys());
  }
  return catalog;
}

function activeSymbolMoves(
  move: MigrationMove,
): Array<{ fromName: string; to: string; toName: string }> {
  if (!move.symbols) return [];
  const symbols: Array<{ fromName: string; to: string; toName: string }> = [];
  for (const [fromName, symbolMove] of Object.entries(move.symbols)) {
    if (typeof symbolMove === "string") {
      if (moveStatus(move) === "active") {
        symbols.push({ fromName, to: move.to, toName: symbolMove });
      }
      continue;
    }
    if ((symbolMove.status ?? moveStatus(move)) !== "active") continue;
    symbols.push({
      fromName,
      to: symbolMove.to,
      toName: symbolMove.name ?? fromName,
    });
  }
  return symbols;
}

function isSideEffectPinned(
  manifest: PackageManifest,
  target: string,
): boolean {
  if (manifest.sideEffects === true) return true;
  if (!Array.isArray(manifest.sideEffects)) return false;
  const normalizedTarget = normalizePackagePath(target);
  return manifest.sideEffects.some(
    (entry) => normalizePackagePath(entry) === normalizedTarget,
  );
}

export function checkMigrationManifest(
  packageManifest: PackageManifest,
  snapshot: ExportSnapshot,
  migrationManifest: MigrationManifest,
  packageCatalog?: Record<string, PackageManifest>,
  exportedSymbols?: ExportedSymbolCatalog,
): MigrationManifestViolation[] {
  const packageName = packageManifest.name ?? "<unknown package>";
  const exports = packageManifest.exports ?? {};
  const snapshotExports = snapshot.exports ?? {};
  const moves = migrationManifest.moves ?? {};
  const violations: MigrationManifestViolation[] = [];

  if (packageCatalog) {
    const checkedTargets = new Set<string>();
    for (const [from, move] of Object.entries(moves)) {
      for (const target of activeMoveTargets(move)) {
        if (checkedTargets.has(target)) continue;
        checkedTargets.add(target);
        if (targetIsExported(target, packageCatalog)) continue;
        violations.push({
          packageName,
          message: `${from} has active migration target ${target}, but that target is not a published package export. Mark the move planned until the target ships.`,
        });
      }
    }
  }

  if (exportedSymbols) {
    for (const [from, move] of Object.entries(moves)) {
      if (!move.symbols && moveStatus(move) === "active") {
        const sourceSymbols = exportedSymbols[from];
        const targetSymbols = exportedSymbols[move.to];
        if (!sourceSymbols || !targetSymbols) continue;
        const missing = [...sourceSymbols].filter(
          (symbol) => !targetSymbols.has(symbol),
        );
        if (missing.length > 0) {
          violations.push({
            packageName,
            message: `${from} moves its full surface to ${move.to}, but the target does not export: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ` (+${missing.length - 8} more)` : ""}. Add symbol-level planned entries until those exports ship.`,
          });
        }
        continue;
      }
      for (const symbolMove of activeSymbolMoves(move)) {
        const targetSymbols = exportedSymbols[symbolMove.to];
        if (!targetSymbols || targetSymbols.has(symbolMove.toName)) continue;
        violations.push({
          packageName,
          message: `${from}#${symbolMove.fromName} has active migration target ${symbolMove.to}#${symbolMove.toName}, but that symbol is not exported. Mark the symbol move planned until it ships.`,
        });
      }
    }
  }

  for (const [exportKey, previousTargets] of Object.entries(snapshotExports)) {
    const specifier = packageSpecifier(packageName, exportKey);
    const exportValue = exports[exportKey];
    if (exportValue === undefined) {
      violations.push({
        packageName,
        message: `${specifier} was removed from exports; keep the export and point it to a tombstone so consumers receive the upgrade guidance.`,
      });
      continue;
    }

    const currentTargets = normalizedTargets(exportValue);
    if (
      currentTargets.length === previousTargets.length &&
      currentTargets.every((target, index) => target === previousTargets[index])
    ) {
      continue;
    }
    const addedTargets = currentTargets.filter(
      (target) => !previousTargets.includes(target),
    );
    if (
      addedTargets.length === 0 ||
      addedTargets.some((target) => !tombstoneTarget(target)) ||
      !addedTargets.some(runtimeTombstoneTarget)
    ) {
      violations.push({
        packageName,
        message: `${specifier} changed its published export target; only a tombstone target with an exact migration move and sideEffects pin is allowed.`,
      });
      continue;
    }
    if (!hasExactMove(moves, specifier)) {
      violations.push({
        packageName,
        message: `${specifier} changed to a tombstone target but has no exact migration manifest move.`,
      });
    }
    for (const target of addedTargets.filter(runtimeTombstoneTarget)) {
      if (isSideEffectPinned(packageManifest, target)) continue;
      violations.push({
        packageName,
        message: `${specifier} tombstone target ${target} must be pinned in sideEffects so bundlers retain its upgrade error.`,
      });
    }
  }

  for (const [exportKey, exportValue] of Object.entries(exports)) {
    const targets = normalizedTargets(exportValue).filter(
      runtimeTombstoneTarget,
    );
    if (targets.length === 0) continue;
    const specifier = packageSpecifier(packageName, exportKey);
    if (!hasExactMove(moves, specifier)) {
      violations.push({
        packageName,
        message: `${specifier} exports a tombstone target but has no exact migration manifest move.`,
      });
    }
    for (const target of targets) {
      if (isSideEffectPinned(packageManifest, target)) continue;
      violations.push({
        packageName,
        message: `${specifier} tombstone target ${target} must be pinned in sideEffects so bundlers retain its upgrade error.`,
      });
    }
  }

  return violations;
}

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const packageDirectories = Object.fromEntries(
    GUARDED_PACKAGES.map(({ directory, name }) => [name, directory]),
  );
  const packageCatalog = Object.fromEntries(
    GUARDED_PACKAGES.map(({ directory, name }) => [
      name,
      JSON.parse(
        readFileSync(path.join(repoRoot, directory, "package.json"), "utf8"),
      ) as PackageManifest,
    ]),
  );
  const migrationManifests = Object.fromEntries(
    GUARDED_PACKAGES.map(({ directory, name }) => [
      name,
      JSON.parse(
        readFileSync(
          path.join(repoRoot, directory, "migration-manifest.json"),
          "utf8",
        ),
      ) as MigrationManifest,
    ]),
  );
  const exportedSymbols = buildExportedSymbolCatalog(
    repoRoot,
    Object.values(migrationManifests),
    packageCatalog,
    packageDirectories,
  );
  const violations = GUARDED_PACKAGES.flatMap(({ directory, name }) => {
    const readJson = <T>(file: string): T =>
      JSON.parse(
        readFileSync(path.join(repoRoot, directory, file), "utf8"),
      ) as T;
    const packageManifest = readJson<PackageManifest>("package.json");
    if (packageManifest.name !== name) {
      return [
        {
          packageName: name,
          message: `${directory}/package.json must name ${name}.`,
        },
      ];
    }
    return checkMigrationManifest(
      packageManifest,
      readJson<ExportSnapshot>("export-snapshot.json"),
      migrationManifests[name],
      packageCatalog,
      exportedSymbols,
    );
  });

  if (violations.length > 0) {
    console.error(
      `[guard:migration-manifest] ${violations.length} violation(s):\n${violations.map((violation) => `- ${violation.message}`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("[guard:migration-manifest] clean");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
