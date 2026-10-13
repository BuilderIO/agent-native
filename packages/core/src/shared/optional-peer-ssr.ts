import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}

function findCoreSourceRoot(cwd: string): string | null {
  try {
    const appPackage = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const localCore =
      appPackage.dependencies?.["@agent-native/core"] ??
      appPackage.devDependencies?.["@agent-native/core"];
    if (localCore?.startsWith("file:")) {
      const root = fileURLToPath(localCore);
      if (fs.existsSync(path.join(root, "src/index.ts"))) return root;
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }

  for (const candidate of [
    path.resolve(cwd, "packages/core"),
    path.resolve(cwd, "../../packages/core"),
    path.resolve(cwd, "../core"),
  ]) {
    const manifestPath = path.join(candidate, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      name?: string;
    };
    if (
      manifest.name === "@agent-native/core" &&
      fs.existsSync(path.join(candidate, "src/index.ts"))
    ) {
      return fs.realpathSync(candidate);
    }
  }
  return null;
}

function findDependencyManifestPath(
  packageName: string,
  startDir: string,
): string | null {
  const packagePath = packageName.split("/");
  let dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    const candidate = path.join(
      dir,
      "node_modules",
      ...packagePath,
      "package.json",
    );
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getRuntimeDependencyNames(cwd: string): Set<string> {
  const appPackage = JSON.parse(
    fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const pending = [
    ...Object.keys(appPackage.dependencies ?? {}),
    ...Object.keys(appPackage.optionalDependencies ?? {}),
    ...Object.keys(appPackage.peerDependencies ?? {}),
  ].map((name) => ({ name, fromDir: cwd }));
  const dependencies = new Set<string>();
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop()!;
    const manifestPath = findDependencyManifestPath(
      current.name,
      current.fromDir,
    );
    if (!manifestPath) continue;

    dependencies.add(current.name);
    const realManifestPath = fs.realpathSync(manifestPath);
    if (visited.has(realManifestPath)) continue;
    visited.add(realManifestPath);

    const manifest = JSON.parse(fs.readFileSync(realManifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const packageDir = path.dirname(realManifestPath);
    for (const name of [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]) {
      pending.push({ name, fromDir: packageDir });
    }
  }

  return dependencies;
}

export function getMissingCoreOptionalPeers(cwd: string): string[] {
  const coreRoot = findCoreSourceRoot(cwd);
  if (!coreRoot) return [];

  const corePackage = JSON.parse(
    fs.readFileSync(path.join(coreRoot, "package.json"), "utf8"),
  ) as {
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };
  const runtimeDependencies = getRuntimeDependencyNames(cwd);
  return Object.entries(corePackage.peerDependenciesMeta ?? {})
    .filter(
      ([name, peer]) =>
        peer.optional === true && !runtimeDependencies.has(name),
    )
    .map(([name]) => name)
    .sort();
}
