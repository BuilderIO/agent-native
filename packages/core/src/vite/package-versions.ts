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

interface ResolvedPackageManifest {
  manifest: PackageManifest;
  manifestPath: string;
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
    // coercion-ok: missing or malformed manifests are typed absence from the optional version inventory.
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
  resolutionBase: string,
): ResolvedPackageManifest | null {
  let entryPath: string;
  const packageRequire = createRequire(
    path.join(resolutionBase, "package.json"),
  );

  try {
    entryPath = packageRequire.resolve(packageName);
  } catch {
    if (packageName !== "@agent-native/core") {
      return null;
    }

    const coreManifestPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../package.json",
    );
    const coreManifest = readPackageManifest(coreManifestPath);
    return coreManifest?.name === packageName
      ? { manifest: coreManifest, manifestPath: coreManifestPath }
      : null;
  }

  let directory = path.dirname(entryPath);
  for (let depth = 0; depth < 20; depth += 1) {
    const manifestPath = path.join(directory, "package.json");
    const manifest = readPackageManifest(manifestPath);
    if (manifest?.name === packageName) {
      return { manifest, manifestPath };
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
  const resolvedVersions = new Map<string, string>();
  const queuedPackages = [...packageNames].map((packageName) => ({
    packageName,
    resolutionBase: cwd,
  }));

  while (queuedPackages.length > 0) {
    const queuedPackage = queuedPackages.shift();
    if (!queuedPackage) continue;

    const resolvedPackage = resolvePackageManifest(
      queuedPackage.packageName,
      queuedPackage.resolutionBase,
    );
    if (!resolvedPackage) {
      continue;
    }
    const { manifest } = resolvedPackage;

    if (typeof manifest.version === "string" && manifest.version.trim()) {
      resolvedVersions.set(queuedPackage.packageName, manifest.version.trim());
    }

    for (const dependencyName of dependencyNames(manifest)) {
      if (
        dependencyName.startsWith(AGENT_NATIVE_PACKAGE_PREFIX) &&
        !packageNames.has(dependencyName)
      ) {
        packageNames.add(dependencyName);
        queuedPackages.push({
          packageName: dependencyName,
          resolutionBase: path.dirname(resolvedPackage.manifestPath),
        });
      }
    }
  }

  return Object.fromEntries(
    [...resolvedVersions.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}
