import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const npmPublishAllowlist = new Set([
  "@agent-native/core",
  "@agent-native/dispatch",
  "@agent-native/pinpoint",
  "@agent-native/scheduling",
  "@agent-native/skills",
  "@agent-native/toolkit",
]);

// Packages that are NOT published to npm and therefore exempt from the
// publish-readiness checks below. Apps are private. Workspace-only libraries are
// consumed through `workspace:` and must stay ignored by changesets until npm
// trusted publishing is configured for them.
const workspaceOnlyPackageAllowlist = new Set([
  "@agent-native/desktop-app",
  "@agent-native/docs",
  "@agent-native/frame",
  "@agent-native/mobile-app",
  "@agent-native/code-agents-ui",
  "@agent-native/embedding",
  "@agent-native/migrate",
  "@agent-native/shared-app-config",
]);

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  publishConfig?: {
    access?: string;
    provenance?: boolean;
  };
  main?: string;
  types?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readIgnoredPackages(): Set<string> {
  const configPath = path.join(repoRoot, ".changeset", "config.json");
  if (!fs.existsSync(configPath)) {
    return new Set();
  }

  const config = readJson<{ ignore?: unknown }>(configPath);
  return new Set(Array.isArray(config.ignore) ? config.ignore : []);
}

const ignoredPackages = readIgnoredPackages();
const packagesDir = path.join(repoRoot, "packages");
const failures: string[] = [];

function readWorkspacePackageNames(): Set<string> {
  const names = new Set<string>();
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const packageJsonPath = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;

    const pkg = readJson<PackageJson>(packageJsonPath);
    if (pkg.name?.startsWith("@agent-native/")) {
      names.add(pkg.name);
    }
  }
  return names;
}

const workspacePackageNames = readWorkspacePackageNames();

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  return Object.values(value).flatMap(collectStringValues);
}

function isRawTypeScriptEntry(entry: string): boolean {
  return /\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry);
}

function dependencyProtocolFailures(
  pkgName: string,
  field: string,
  dependencies: Record<string, string> | undefined,
): string[] {
  if (!dependencies) return [];
  return Object.entries(dependencies)
    .filter(([dep, version]) => {
      if (/^catalog:/.test(version)) return true;
      if (/^workspace:/.test(version)) {
        return !npmPublishAllowlist.has(dep);
      }
      return false;
    })
    .map(
      ([dep, version]) =>
        `${pkgName} ${field}.${dep} must use a publishable semver range or published workspace package, not ${version}`,
    );
}

function localWorkspaceDependencyFailures(
  pkgName: string,
  field: string,
  dependencies: Record<string, string> | undefined,
): string[] {
  if (!dependencies) return [];
  return Object.entries(dependencies)
    .filter(
      ([dep, version]) =>
        workspacePackageNames.has(dep) && version !== "workspace:*",
    )
    .map(
      ([dep, version]) =>
        `${pkgName} ${field}.${dep} must stay workspace:* in source, not ${version}; pnpm pack rewrites it for npm publishing`,
    );
}

for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const packageJsonPath = path.join(packagesDir, entry.name, "package.json");
  if (!fs.existsSync(packageJsonPath)) continue;

  const pkg = readJson<PackageJson>(packageJsonPath);
  if (!pkg.name?.startsWith("@agent-native/")) continue;

  failures.push(
    ...localWorkspaceDependencyFailures(
      pkg.name,
      "dependencies",
      pkg.dependencies,
    ),
    ...localWorkspaceDependencyFailures(
      pkg.name,
      "devDependencies",
      pkg.devDependencies,
    ),
    ...localWorkspaceDependencyFailures(
      pkg.name,
      "optionalDependencies",
      pkg.optionalDependencies,
    ),
  );

  if (workspaceOnlyPackageAllowlist.has(pkg.name)) {
    if (pkg.private !== true && !ignoredPackages.has(pkg.name)) {
      failures.push(
        `${pkg.name} is workspace-only and must be listed in .changeset/config.json ignore until npm publishing is enabled`,
      );
    }
    continue;
  }

  if (!npmPublishAllowlist.has(pkg.name)) {
    failures.push(
      `${pkg.name} is not in the npm publish allowlist; add it only after npm trusted publishing is configured, or mark it workspace-only`,
    );
    continue;
  }

  if (pkg.private === true) {
    failures.push(`${pkg.name} must not set "private": true`);
  }
  if (!pkg.version) {
    failures.push(`${pkg.name} must declare a version before publishing`);
  }
  if (pkg.publishConfig?.access !== "public") {
    failures.push(`${pkg.name} must set publishConfig.access to "public"`);
  }
  if (pkg.publishConfig?.provenance !== true) {
    failures.push(`${pkg.name} must set publishConfig.provenance to true`);
  }
  if (ignoredPackages.has(pkg.name)) {
    failures.push(
      `${pkg.name} must not be listed in .changeset/config.json ignore`,
    );
  }

  if (!pkg.main && !pkg.exports && !pkg.bin) {
    failures.push(
      `${pkg.name} must declare a runtime entry point via exports, main, or bin`,
    );
  }

  const entryPaths = [
    ...(pkg.main ? [pkg.main] : []),
    ...(pkg.types ? [pkg.types] : []),
    ...collectStringValues(pkg.bin),
    ...collectStringValues(pkg.exports),
  ];
  for (const entryPath of entryPaths) {
    if (isRawTypeScriptEntry(entryPath)) {
      failures.push(
        `${pkg.name} entry point ${entryPath} must point at compiled JavaScript or .d.ts output, not raw TypeScript`,
      );
    }
  }

  if (
    entryPaths.some((entryPath) => entryPath.includes("/dist/")) &&
    !pkg.scripts?.build
  ) {
    failures.push(`${pkg.name} exports dist files but has no build script`);
  }

  failures.push(
    ...dependencyProtocolFailures(pkg.name, "dependencies", pkg.dependencies),
    ...dependencyProtocolFailures(
      pkg.name,
      "optionalDependencies",
      pkg.optionalDependencies,
    ),
    ...dependencyProtocolFailures(
      pkg.name,
      "peerDependencies",
      pkg.peerDependencies,
    ),
  );
}

if (failures.length > 0) {
  console.error("Package publish metadata is not public:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("OK Agent-Native package publish metadata is public.");
