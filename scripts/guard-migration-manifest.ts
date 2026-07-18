import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ExportValue = string | Record<string, ExportValue | null> | null;
type PackageManifest = {
  exports?: Record<string, ExportValue>;
  name?: string;
  sideEffects?: boolean | string[];
};
type MigrationManifest = {
  moves?: Record<string, unknown>;
};
type ExportSnapshot = {
  exportKeys?: string[];
};

type GuardedPackage = {
  directory: string;
  name: string;
};

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

function tombstoneTarget(target: string): boolean {
  return (
    /(?:^|[/.\\-])tombstone(?:[/.\\-]|$)/.test(target) &&
    /\.(?:[cm]?js)$/.test(target)
  );
}

function collectTombstoneTargets(value: ExportValue): string[] {
  if (typeof value === "string") return tombstoneTarget(value) ? [value] : [];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectTombstoneTargets);
}

function normalizePackagePath(value: string): string {
  return value.replace(/^\.\//, "");
}

function hasExactMove(
  moves: Record<string, unknown>,
  specifier: string,
): boolean {
  const move = moves[specifier];
  return Boolean(
    move &&
    typeof move === "object" &&
    typeof (move as { to?: unknown }).to === "string" &&
    (move as { to: string }).to.length > 0,
  );
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
): MigrationManifestViolation[] {
  const packageName = packageManifest.name ?? "<unknown package>";
  const exports = packageManifest.exports ?? {};
  const snapshotKeys = snapshot.exportKeys ?? [];
  const moves = migrationManifest.moves ?? {};
  const violations: MigrationManifestViolation[] = [];

  for (const exportKey of snapshotKeys) {
    if (exportKey in exports) continue;
    const specifier = packageSpecifier(packageName, exportKey);
    if (!hasExactMove(moves, specifier)) {
      violations.push({
        packageName,
        message: `${specifier} was removed from exports; add an exact migration manifest move before removing a published entrypoint.`,
      });
    }
  }

  for (const [exportKey, exportValue] of Object.entries(exports)) {
    const targets = collectTombstoneTargets(exportValue);
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
      readJson<MigrationManifest>("migration-manifest.json"),
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
