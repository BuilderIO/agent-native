import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MigrationSymbolMove {
  to: string;
  name?: string;
  status?: MigrationMoveStatus;
}

export interface MigrationMove {
  to: string;
  symbols?: Record<string, string | MigrationSymbolMove>;
  status?: MigrationMoveStatus;
}

export type MigrationMoveStatus = "active" | "planned";

export type MigrationDependencyCondition =
  | "pglite-database"
  | "server-sentry"
  | "browser-sentry"
  | "sentry-source-map-upload"
  | "sso"
  | "scim"
  | "amplitude"
  | "microsoft-teams";

export interface MigrationDependency {
  name: string;
  version: string;
  when: MigrationDependencyCondition;
}

export interface MigrationManifest {
  sinceVersion: string;
  moves: Record<string, MigrationMove>;
  dependencyVersions?: Record<string, string>;
  removedExports?: Record<string, RemovedExportManifest>;
  dependencies?: MigrationDependency[];
}

export interface RemovedExportManifest {
  symbols: string[];
  migrationGuide: string;
  symbolGuides?: Record<string, string>;
}

const MIGRATION_DEPENDENCY_CONDITIONS = new Set<MigrationDependencyCondition>([
  "pglite-database",
  "server-sentry",
  "browser-sentry",
  "sentry-source-map-upload",
  "sso",
  "scim",
  "amplitude",
  "microsoft-teams",
]);

function isMigrationDependency(value: unknown): value is MigrationDependency {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const dependency = value as Record<string, unknown>;
  return (
    typeof dependency.name === "string" &&
    dependency.name.trim().length > 0 &&
    typeof dependency.version === "string" &&
    dependency.version.trim().length > 0 &&
    typeof dependency.when === "string" &&
    MIGRATION_DEPENDENCY_CONDITIONS.has(
      dependency.when as MigrationDependencyCondition,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMigrationMoveStatus(value: unknown): value is MigrationMoveStatus {
  return value === "active" || value === "planned";
}

function isMigrationSymbolMove(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return (
    isRecord(value) &&
    typeof value.to === "string" &&
    value.to.trim().length > 0 &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.status === undefined || isMigrationMoveStatus(value.status))
  );
}

function isMigrationMove(value: unknown): value is MigrationMove {
  if (
    !isRecord(value) ||
    typeof value.to !== "string" ||
    value.to.trim().length === 0 ||
    (value.status !== undefined && !isMigrationMoveStatus(value.status))
  ) {
    return false;
  }
  return (
    value.symbols === undefined ||
    (isRecord(value.symbols) &&
      Object.values(value.symbols).every(isMigrationSymbolMove))
  );
}

function isRemovedExportManifest(
  value: unknown,
): value is RemovedExportManifest {
  if (!isRecord(value) || !Array.isArray(value.symbols)) return false;
  const symbols = value.symbols;
  const symbolGuides = value.symbolGuides;
  return (
    symbols.length > 0 &&
    symbols.every((symbol) => typeof symbol === "string") &&
    typeof value.migrationGuide === "string" &&
    /^https:\/\//.test(value.migrationGuide) &&
    (symbolGuides === undefined ||
      (isRecord(symbolGuides) &&
        Object.entries(symbolGuides).every(
          ([symbol, guide]) =>
            symbols.includes(symbol) &&
            typeof guide === "string" &&
            /^https:\/\//.test(guide),
        )))
  );
}

function migrationManifestProblem(value: unknown): string | null {
  if (!isRecord(value)) return "the root must be an object";
  if (typeof value.sinceVersion !== "string" || !value.sinceVersion.trim()) {
    return "sinceVersion must be a non-empty string";
  }
  if (
    !isRecord(value.moves) ||
    Object.entries(value.moves).some(
      ([specifier, move]) => !specifier.trim() || !isMigrationMove(move),
    )
  ) {
    return "moves must map specifiers to valid migration move records";
  }
  if (
    value.dependencyVersions !== undefined &&
    (!isRecord(value.dependencyVersions) ||
      Object.entries(value.dependencyVersions).some(
        ([name, version]) =>
          !name.trim() || typeof version !== "string" || !version.trim(),
      ))
  ) {
    return "dependencyVersions must map package names to non-empty version ranges";
  }
  if (
    value.removedExports !== undefined &&
    (!isRecord(value.removedExports) ||
      Object.entries(value.removedExports).some(
        ([specifier, removed]) =>
          !specifier.trim() || !isRemovedExportManifest(removed),
      ))
  ) {
    return "removedExports must map specifiers to symbol lists and HTTPS migrationGuide URLs";
  }
  if (
    value.dependencies !== undefined &&
    (!Array.isArray(value.dependencies) ||
      !value.dependencies.every(isMigrationDependency))
  ) {
    return "dependencies must be an array of supported dependency records";
  }
  return null;
}

export interface ResolvedMigrationSymbolMove {
  to: string;
  name: string;
  status: MigrationMoveStatus;
}

export function migrationMoveStatus(
  move: Pick<MigrationMove, "status">,
): MigrationMoveStatus {
  return move.status === "planned" ? "planned" : "active";
}

export function readMigrationManifest(
  manifestPath: string,
): MigrationManifest | null {
  let source: string;
  try {
    source = fs.readFileSync(manifestPath, "utf-8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw new Error(
      `Could not read migration manifest at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Could not parse migration manifest at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const problem = migrationManifestProblem(parsed);
  if (problem) {
    throw new Error(
      `Invalid migration manifest at ${manifestPath}: ${problem}.`,
    );
  }
  return parsed as MigrationManifest;
}

export function bundledCoreMigrationManifestPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../migration-manifest.json");
}

export function bundledCorePackageVersion(): string | null {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../package.json",
        ),
        "utf-8",
      ),
    ) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

function numericVersion(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isMigrationManifestActive(
  manifest: MigrationManifest,
  packageVersion: string | null,
): boolean {
  if (!packageVersion) return false;
  const current = numericVersion(packageVersion);
  const since = numericVersion(manifest.sinceVersion);
  if (!current || !since) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== since[index]) return current[index] > since[index];
  }
  return true;
}

function resolveOptionalManifest(
  projectRoot: string,
  specifier: string,
): string | null {
  try {
    const require = createRequire(path.join(projectRoot, "package.json"));
    return require.resolve(specifier);
  } catch {
    return null;
  }
}

export function loadMigrationManifestsForProject(
  projectRoot: string,
): MigrationManifest[] {
  const paths = [
    bundledCoreMigrationManifestPath(),
    resolveOptionalManifest(
      projectRoot,
      "@agent-native/toolkit/migration-manifest.json",
    ),
  ];
  return paths
    .filter((manifestPath): manifestPath is string => Boolean(manifestPath))
    .map(readMigrationManifest)
    .filter((manifest): manifest is MigrationManifest => Boolean(manifest));
}

export function resolveMigrationSymbolMove(
  move: MigrationMove,
  importedName: string,
): ResolvedMigrationSymbolMove | null {
  if (!move.symbols) {
    return {
      to: move.to,
      name: importedName,
      status: migrationMoveStatus(move),
    };
  }
  const symbolMove = move.symbols[importedName];
  if (typeof symbolMove === "string") {
    return {
      to: move.to,
      name: symbolMove,
      status: migrationMoveStatus(move),
    };
  }
  if (symbolMove) {
    return {
      to: symbolMove.to,
      name: symbolMove.name ?? importedName,
      status:
        symbolMove.status === "planned"
          ? "planned"
          : symbolMove.status === "active"
            ? "active"
            : migrationMoveStatus(move),
    };
  }
  return null;
}
