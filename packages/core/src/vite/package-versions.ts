import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const AGENT_NATIVE_PACKAGE_PREFIX = "@agent-native/";

interface PackageManifest {
  name?: unknown;
  version?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readPackageManifest(manifestPath: string): PackageManifest | null {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as unknown;
    return manifest && typeof manifest === "object"
      ? (manifest as PackageManifest)
      : null;
  } catch {
    return null;
  }
}

function dependencyNames(
  manifest: PackageManifest | null,
  includeDevDependencies = false,
): string[] {
  if (!manifest) {
    return [];
  }

  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...(includeDevDependencies
      ? Object.keys(manifest.devDependencies ?? {})
      : []),
  ];
}

function resolvePackageManifest(
  packageName: string,
  appRequire: NodeRequire,
): PackageManifest | null {
  let entryPath: string;

  try {
    entryPath = appRequire.resolve(packageName);
  } catch {
    if (packageName !== "@agent-native/core") {
      return null;
    }

    const coreManifestPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../package.json",
    );
    const coreManifest = readPackageManifest(coreManifestPath);
    return coreManifest?.name === packageName ? coreManifest : null;
  }

  let directory = path.dirname(entryPath);
  for (let depth = 0; depth < 20; depth += 1) {
    const manifest = readPackageManifest(path.join(directory, "package.json"));
    if (manifest?.name === packageName) {
      return manifest;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }

  return null;
}

export function resolveAgentNativePackageVersions(
  cwd: string,
): Record<string, string> {
  const appManifest = readPackageManifest(path.join(cwd, "package.json"));
  const packageNames = new Set<string>([
    "@agent-native/core",
    ...dependencyNames(appManifest, true).filter((name) =>
      name.startsWith(AGENT_NATIVE_PACKAGE_PREFIX),
    ),
  ]);
  const appRequire = createRequire(path.join(cwd, "package.json"));
  const resolvedVersions = new Map<string, string>();
  const queuedPackages = [...packageNames];

  while (queuedPackages.length > 0) {
    const packageName = queuedPackages.shift();
    if (!packageName) {
      continue;
    }

    const manifest = resolvePackageManifest(packageName, appRequire);
    if (!manifest) {
      continue;
    }

    if (typeof manifest.version === "string" && manifest.version.trim()) {
      resolvedVersions.set(packageName, manifest.version.trim());
    }

    for (const dependencyName of dependencyNames(manifest)) {
      if (
        dependencyName.startsWith(AGENT_NATIVE_PACKAGE_PREFIX) &&
        !packageNames.has(dependencyName)
      ) {
        packageNames.add(dependencyName);
        queuedPackages.push(dependencyName);
      }
    }
  }

  return Object.fromEntries(
    [...resolvedVersions.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}
