import { readFileSync } from "node:fs";
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

function targetIsExported(
  target: string,
  packageCatalog: Record<string, PackageManifest>,
): boolean {
  const packageName = Object.keys(packageCatalog)
    .sort((left, right) => right.length - left.length)
    .find(
      (candidate) => target === candidate || target.startsWith(`${candidate}/`),
    );
  if (!packageName) return false;
  const exports = packageCatalog[packageName]?.exports ?? {};
  const exportKey = packageExportKey(packageName, target);
  return Object.keys(exports).some((candidate) => {
    if (candidate === exportKey) return true;
    if (!candidate.includes("*")) return false;
    const [prefix, suffix] = candidate.split("*");
    return exportKey.startsWith(prefix) && exportKey.endsWith(suffix);
  });
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
  const packageCatalog = Object.fromEntries(
    GUARDED_PACKAGES.map(({ directory, name }) => [
      name,
      JSON.parse(
        readFileSync(path.join(repoRoot, directory, "package.json"), "utf8"),
      ) as PackageManifest,
    ]),
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
      readJson<MigrationManifest>("migration-manifest.json"),
      packageCatalog,
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
