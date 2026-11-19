import { spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const CHANGESET_CONFIG_PATH = path.join(
  rootDir,
  ".changeset",
  "config.json",
);

/**
 * Stable releases only rewrite `workspace:` ranges. A plain npm range on an
 * internal package is deliberate: the community QR template declares
 * `@agent-native/core` that way because its files are copied into other
 * workspaces, and Dispatch pins those files by Git blob id. Snapshot releases
 * keep the shared config, so their peer ranges still move to each snapshot.
 */
export function stableChangesetConfig(source: string): string {
  const config = JSON.parse(source) as Record<string, unknown>;
  return `${JSON.stringify(
    { ...config, bumpVersionsWithWorkspaceProtocolOnly: true },
    null,
    2,
  )}\n`;
}

export async function withStableChangesetConfig<T>(
  run: () => T | Promise<T>,
  configPath = CHANGESET_CONFIG_PATH,
): Promise<T> {
  const original = await readFile(configPath, "utf8");
  await writeFile(configPath, stableChangesetConfig(original));
  try {
    return await run();
  } finally {
    await writeFile(configPath, original);
  }
}

function runChangesetVersion(): void {
  const changesetsBin = createRequire(import.meta.url).resolve(
    "@changesets/cli/bin.js",
  );
  const result = spawnSync(process.execPath, [changesetsBin, "version"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`changeset version exited with ${result.status}.`);
  }
}

const CORE_PACKAGE = "@agent-native/core";
const PACKAGES_DIR = path.join(rootDir, "packages");

type PackageManifest = {
  name?: string;
  version?: string;
  peerDependencies?: Record<string, string>;
};

/**
 * A released package peers on the Core it was built and tested beside. A
 * hand-kept floor goes stale as soon as the package adopts a newer Core
 * export, and pnpm then installs it next to a Core that lacks the export with
 * nothing more than a warning.
 */
export function corePeerFloorFor(
  manifest: PackageManifest,
  coreVersion: string,
): string | null {
  const range = manifest.peerDependencies?.[CORE_PACKAGE];
  if (range === undefined || range.startsWith("workspace:")) return null;
  if (!/^>=\S+$/.test(range)) {
    throw new Error(
      `${manifest.name} declares ${CORE_PACKAGE}@"${range}". Only a ">=" floor can be raised to the released Core.`,
    );
  }
  const floor = `>=${coreVersion}-0`;
  return range === floor ? null : floor;
}

async function readPackageManifests(
  packagesDir: string,
): Promise<Map<string, PackageManifest>> {
  const manifests = new Map<string, PackageManifest>();
  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(packagesDir, entry.name, "package.json");
    let source: string;
    try {
      source = await readFile(manifestPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    manifests.set(manifestPath, JSON.parse(source) as PackageManifest);
  }
  return manifests;
}

export async function readPackageVersions(
  packagesDir = PACKAGES_DIR,
): Promise<Map<string, string | undefined>> {
  const manifests = await readPackageManifests(packagesDir);
  return new Map(
    [...manifests].map(([manifestPath, manifest]) => [
      manifestPath,
      manifest.version,
    ]),
  );
}

export async function raiseReleasedCorePeerFloors(
  versionsBefore: Map<string, string | undefined>,
  packagesDir = PACKAGES_DIR,
): Promise<string[]> {
  const manifests = await readPackageManifests(packagesDir);
  const coreVersion = [...manifests.values()].find(
    (manifest) => manifest.name === CORE_PACKAGE,
  )?.version;
  if (!coreVersion) {
    throw new Error(`No ${CORE_PACKAGE} version found under ${packagesDir}.`);
  }
  const raised: string[] = [];
  for (const [manifestPath, manifest] of manifests) {
    if (manifest.version === versionsBefore.get(manifestPath)) continue;
    const floor = corePeerFloorFor(manifest, coreVersion);
    if (!floor) continue;
    manifest.peerDependencies = {
      ...manifest.peerDependencies,
      [CORE_PACKAGE]: floor,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    raised.push(`${manifest.name}: ${CORE_PACKAGE}@${floor}`);
  }
  return raised;
}

async function versionStable(): Promise<void> {
  const versionsBefore = await readPackageVersions();
  await withStableChangesetConfig(runChangesetVersion);
  for (const raised of await raiseReleasedCorePeerFloors(versionsBefore)) {
    console.log(`Raised peer floor ${raised}`);
  }
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint &&
    import.meta.url === pathToFileURL(path.resolve(entrypoint)).href,
  );
}

if (isDirectExecution()) {
  versionStable().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
