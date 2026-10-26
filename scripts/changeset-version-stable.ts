import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
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

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint &&
    import.meta.url === pathToFileURL(path.resolve(entrypoint)).href,
  );
}

if (isDirectExecution()) {
  withStableChangesetConfig(runChangesetVersion).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
