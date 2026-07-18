import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CORE_IMPORTER = "packages/core";
const TOOLKIT_IMPORTER = "packages/toolkit";

export const REQUIRED_SINGLETON_DEPENDENCIES = [
  "yjs",
  "y-protocols",
  "@tiptap/core",
  "@tiptap/pm",
] as const;

type ImporterResolutions = Map<string, string>;
type PackageManifest = {
  dependencies?: Record<string, string>;
};

export type SharedUiSingletonCheck = {
  dependencies: string[];
  errors: string[];
  resolutions: Record<string, { core: string; toolkit: string }>;
};

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isSharedContextSingleton(dependency: string): boolean {
  return (
    dependency === "yjs" ||
    dependency === "y-protocols" ||
    dependency.startsWith("@tiptap/") ||
    dependency === "react" ||
    dependency === "react-dom" ||
    dependency === "@radix-ui/primitive" ||
    dependency === "@radix-ui/react-context" ||
    dependency.startsWith("@radix-ui/react-")
  );
}

export function checkSharedDependencyCatalogUsage(
  coreManifest: PackageManifest,
  toolkitManifest: PackageManifest,
): { dependencies: string[]; errors: string[] } {
  const coreDependencies = coreManifest.dependencies ?? {};
  const toolkitDependencies = toolkitManifest.dependencies ?? {};
  const dependencies = Object.keys(coreDependencies)
    .filter((dependency) => dependency in toolkitDependencies)
    .sort();
  const errors: string[] = [];

  for (const dependency of dependencies) {
    const coreSpecifier = coreDependencies[dependency];
    const toolkitSpecifier = toolkitDependencies[dependency];
    if (coreSpecifier !== "catalog:" || toolkitSpecifier !== "catalog:") {
      errors.push(
        `${dependency} is shared by ${CORE_IMPORTER} and ${TOOLKIT_IMPORTER} and must use catalog: in both manifests; found ${coreSpecifier} and ${toolkitSpecifier}.`,
      );
    }
  }

  return { dependencies, errors };
}

function importerName(line: string): string | null {
  const match = line.match(/^ {2}([^ ].+?):\s*$/);
  return match ? unquote(match[1] ?? "") : null;
}

function dependencyName(line: string): string | null {
  const match = line.match(/^ {6}([^ ].+?):\s*$/);
  return match ? unquote(match[1] ?? "") : null;
}

/**
 * Reads the importer locators from pnpm-lock.yaml instead of comparing declared
 * semver ranges. A locator includes peer suffixes, so two separately resolved
 * instances with the same published version still fail this check.
 */
export function parsePnpmLockImporterResolutions(
  lockfile: string,
): Map<string, ImporterResolutions> {
  const importers = new Map<string, ImporterResolutions>();
  const lines = lockfile.split(/\r?\n/);
  let inImporters = false;
  let activeImporter: string | null = null;
  let inDependencyGroup = false;
  let activeDependency: string | null = null;

  for (const line of lines) {
    if (!inImporters) {
      if (line === "importers:") inImporters = true;
      continue;
    }

    if (/^\S/.test(line)) break;

    const nextImporter = importerName(line);
    if (nextImporter !== null) {
      activeImporter = nextImporter;
      if (!importers.has(activeImporter)) {
        importers.set(activeImporter, new Map());
      }
      inDependencyGroup = false;
      activeDependency = null;
      continue;
    }

    if (activeImporter === null) continue;
    if (
      /^ {4}(?:dependencies|devDependencies|optionalDependencies|peerDependencies):\s*$/.test(
        line,
      )
    ) {
      inDependencyGroup = true;
      activeDependency = null;
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      inDependencyGroup = false;
      activeDependency = null;
      continue;
    }
    if (!inDependencyGroup) continue;

    const nextDependency = dependencyName(line);
    if (nextDependency !== null) {
      activeDependency = nextDependency;
      continue;
    }
    const version = line.match(/^ {8}version:\s*(.+?)\s*$/)?.[1];
    if (activeDependency && version) {
      importers.get(activeImporter)?.set(activeDependency, unquote(version));
    }
  }

  return importers;
}

export function checkSharedUiSingletonResolutions(
  lockfile: string,
): SharedUiSingletonCheck {
  const importers = parsePnpmLockImporterResolutions(lockfile);
  const core = importers.get(CORE_IMPORTER);
  const toolkit = importers.get(TOOLKIT_IMPORTER);
  const errors: string[] = [];

  if (!core) {
    errors.push(`${CORE_IMPORTER} importer is missing from pnpm-lock.yaml`);
  }
  if (!toolkit) {
    errors.push(`${TOOLKIT_IMPORTER} importer is missing from pnpm-lock.yaml`);
  }
  if (!core || !toolkit) {
    return { dependencies: [], errors, resolutions: {} };
  }

  const sharedContextDependencies = [...core.keys()].filter(
    (dependency) =>
      toolkit.has(dependency) && isSharedContextSingleton(dependency),
  );
  const dependencies = [
    ...REQUIRED_SINGLETON_DEPENDENCIES,
    ...sharedContextDependencies.filter(
      (dependency) =>
        !REQUIRED_SINGLETON_DEPENDENCIES.includes(
          dependency as (typeof REQUIRED_SINGLETON_DEPENDENCIES)[number],
        ),
    ),
  ].sort();
  const resolutions: SharedUiSingletonCheck["resolutions"] = {};

  for (const dependency of dependencies) {
    const coreResolution = core.get(dependency);
    const toolkitResolution = toolkit.get(dependency);
    if (!coreResolution || !toolkitResolution) {
      errors.push(
        `${dependency} must be a direct dependency of both ${CORE_IMPORTER} and ${TOOLKIT_IMPORTER}; resolved lockfile entries are required to prevent duplicate singleton instances.`,
      );
      continue;
    }

    resolutions[dependency] = {
      core: coreResolution,
      toolkit: toolkitResolution,
    };
    if (coreResolution !== toolkitResolution) {
      errors.push(
        `${dependency} resolves differently: ${CORE_IMPORTER} -> ${coreResolution}; ${TOOLKIT_IMPORTER} -> ${toolkitResolution}. Align the shared dependency so pnpm installs one singleton instance.`,
      );
    }
  }

  return { dependencies, errors, resolutions };
}

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const lockfile = readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");
  const coreManifest = JSON.parse(
    readFileSync(path.join(repoRoot, CORE_IMPORTER, "package.json"), "utf8"),
  ) as PackageManifest;
  const toolkitManifest = JSON.parse(
    readFileSync(path.join(repoRoot, TOOLKIT_IMPORTER, "package.json"), "utf8"),
  ) as PackageManifest;
  const catalogResult = checkSharedDependencyCatalogUsage(
    coreManifest,
    toolkitManifest,
  );
  const result = checkSharedUiSingletonResolutions(lockfile);
  result.errors.unshift(...catalogResult.errors);

  if (result.errors.length > 0) {
    console.error(
      `[guard:shared-ui-singletons] ${result.errors.length} issue(s):\n${result.errors.map((error) => `- ${error}`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[guard:shared-ui-singletons] clean (${catalogResult.dependencies.length} catalog-shared dependencies; ${result.dependencies.length} singleton-critical resolutions)`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
