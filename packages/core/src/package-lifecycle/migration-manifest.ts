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

export interface MigrationManifest {
  sinceVersion: string;
  moves: Record<string, MigrationMove>;
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
  try {
    const parsed = JSON.parse(
      fs.readFileSync(manifestPath, "utf-8"),
    ) as Partial<MigrationManifest>;
    if (
      typeof parsed.sinceVersion !== "string" ||
      !parsed.moves ||
      typeof parsed.moves !== "object"
    ) {
      return null;
    }
    return parsed as MigrationManifest;
  } catch {
    return null;
  }
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
