/**
 * Copy the generated formatter assets into the Nitro preset's server output.
 *
 * Nitro chooses the deployable server directory per preset. The default node
 * build writes `.output/server`; the Netlify preset used by
 * `agent-native deploy --build-only --preset netlify` writes
 * `.netlify/functions-internal/server`. Copying to a fixed `.output` path would
 * either fail the build (missing directory) or put the assets outside the
 * deployed function, so the preset is resolved explicitly.
 *
 * The copy is verified against the generated manifest before the build script
 * exits: a truncated/partial copy is a failed build, not a runtime surprise.
 */
import { createHash } from "node:crypto";
import { cp, lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ManifestFile = { path: string; size: number; sha256: string };
type Manifest = { files: ManifestFile[] };

/**
 * Deployable server directories for the presets this app is built with.
 * Keep in sync with the installed Nitro preset table:
 * node_modules/nitro/dist/_presets.mjs (nitro@3.0.260903-beta).
 */
const PRESET_SERVER_DIRS: Record<string, string> = {
  node: ".output/server",
  "node-server": ".output/server",
  "node-cluster": ".output/server",
  netlify: ".netlify/functions-internal/server",
  vercel: ".vercel/output/functions/__server.func",
};

export function resolvePreset(value: string | undefined): string {
  const preset = (value ?? "").trim().toLowerCase();
  return preset || "node-server";
}

export function resolveAssetDestination(
  appRoot: string,
  preset: string,
): string {
  const relativeServerDir = PRESET_SERVER_DIRS[preset];
  if (!relativeServerDir) {
    throw new Error(
      `Unsupported Nitro preset for formatter assets: "${preset}". ` +
        `Known presets: ${Object.keys(PRESET_SERVER_DIRS).join(", ")}.`,
    );
  }
  return path.join(appRoot, relativeServerDir, "formatter-assets");
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

const RUNTIME_ENTRY_FILES = ["main.mjs", "index.mjs"];

async function hasRuntimeEntry(dir: string): Promise<boolean> {
  for (const entry of RUNTIME_ENTRY_FILES) {
    try {
      if ((await lstat(path.join(dir, entry))).isFile()) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return false;
}

/**
 * Every deployable runtime target for a preset. Netlify's app build emits the
 * main `server/` function and then clones it to sibling functions (for example
 * `server-agent-background`) BEFORE the package build script runs. Those
 * siblings execute the same server bundle, so each one needs the assets too.
 */
async function resolveDeployableServerRoots(
  appRoot: string,
  preset: string,
): Promise<string[]> {
  const mainServerRoot = path.dirname(resolveAssetDestination(appRoot, preset));
  if (!(await isDirectory(mainServerRoot))) {
    throw new Error(
      `Nitro server output for preset "${preset}" is missing at ` +
        `${path.relative(appRoot, mainServerRoot)}; run \`agent-native build\` with that preset first.`,
    );
  }
  const roots = [mainServerRoot];
  if (preset === "netlify") {
    const functionsDir = path.dirname(mainServerRoot);
    for (const entry of await readdir(functionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(functionsDir, entry.name);
      if (candidate === mainServerRoot) continue;
      if (await hasRuntimeEntry(candidate)) roots.push(candidate);
    }
  }
  return roots;
}

async function resolveExistingRealPath(target: string): Promise<string> {
  let current = target;
  for (;;) {
    try {
      return await realpath(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function assertInsideAppRoot(
  appRootReal: string,
  candidateReal: string,
  requested: string,
  description: string,
): void {
  const relative = path.relative(appRootReal, candidateReal);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Refusing to write formatter assets outside the app root ` +
        `(${description}): ${requested}`,
    );
  }
}

async function assertSafeDestination(
  appRootReal: string,
  appRoot: string,
  destination: string,
): Promise<void> {
  const existing = await lstat(destination).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (existing && !existing.isDirectory()) {
    throw new Error(
      `Refusing to replace non-directory formatter asset destination: ` +
        `${path.relative(appRoot, destination)}`,
    );
  }
  assertInsideAppRoot(
    appRootReal,
    await resolveExistingRealPath(destination),
    path.relative(appRoot, destination),
    "asset destination",
  );
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path.join(root, entry.name), relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`Unsupported formatter asset entry: ${relative}`);
    }
  }
  return files.sort();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Verify the copy is complete and byte-identical to the generated source. */
export async function verifyCopiedAssets(
  sourceDir: string,
  destinationDir: string,
): Promise<number> {
  const manifest = JSON.parse(
    await readFile(path.join(sourceDir, "manifest.json"), "utf8"),
  ) as Manifest;
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("Formatter asset manifest lists no files.");
  }

  const sourceFiles = await listFiles(sourceDir);
  const copiedFiles = await listFiles(destinationDir);
  if (sourceFiles.join("\n") !== copiedFiles.join("\n")) {
    throw new Error(
      "Copied formatter assets do not match the generated file set.",
    );
  }

  for (const file of manifest.files) {
    const target = path.join(destinationDir, file.path);
    let info;
    try {
      info = await lstat(target);
    } catch {
      throw new Error(`Copied formatter asset is missing: ${file.path}`);
    }
    if (!info.isFile() || info.size !== file.size) {
      throw new Error(`Copied formatter asset size mismatch: ${file.path}`);
    }
    if (sha256(await readFile(target)) !== file.sha256) {
      throw new Error(
        `Copied formatter asset integrity mismatch: ${file.path}`,
      );
    }
  }
  return manifest.files.length;
}

export type AssetCopyResult = {
  preset: string;
  /** Main server function destination; kept for existing callers. */
  destination: string;
  /** Every deployable runtime destination, main first. */
  destinations: string[];
  files: number;
};

export async function copyFormatterAssets(
  appRoot: string,
  preset: string,
): Promise<AssetCopyResult> {
  const requestedRoot = path.resolve(appRoot);
  const source = path.join(requestedRoot, "server", "assets", "formatter");
  if (!(await isDirectory(source))) {
    throw new Error("Run `pnpm formatter:assets` before building.");
  }
  try {
    const info = await lstat(path.join(source, "manifest.json"));
    if (!info.isFile()) throw new Error("manifest is not a file");
  } catch {
    throw new Error("Run `pnpm formatter:assets` before building.");
  }

  const serverRoots = await resolveDeployableServerRoots(requestedRoot, preset);
  const appRootReal = await realpath(requestedRoot);
  const destinations: string[] = [];
  let files = 0;

  for (const serverRoot of serverRoots) {
    const serverRootReal = await realpath(serverRoot);
    assertInsideAppRoot(
      appRootReal,
      serverRootReal,
      path.relative(requestedRoot, serverRoot),
      `server root for preset "${preset}"`,
    );
    const expectedRoot = path.join(
      appRootReal,
      path.relative(requestedRoot, serverRoot),
    );
    if (serverRootReal !== expectedRoot) {
      throw new Error("Refusing to follow a formatter output symlink.");
    }
    const destination = path.join(serverRoot, "formatter-assets");
    await assertSafeDestination(appRootReal, requestedRoot, destination);

    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true });
    files = await verifyCopiedAssets(source, destination);
    destinations.push(destination);
  }

  const mainDestination = destinations[0];
  if (!mainDestination) {
    throw new Error("No deployable formatter asset target was found.");
  }
  return {
    preset,
    destination: mainDestination,
    destinations,
    files,
  };
}

export async function main(
  appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssetCopyResult> {
  const result = await copyFormatterAssets(
    appRoot,
    resolvePreset(env.NITRO_PRESET),
  );
  for (const destination of result.destinations) {
    console.log(
      `[formatter] copied ${result.files} assets to ` +
        `${path.relative(appRoot, destination)} (preset=${result.preset})`,
    );
  }
  return result;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
