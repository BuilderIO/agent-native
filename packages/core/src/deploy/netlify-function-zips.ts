import { createHash } from "crypto";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";

import { normalizeZip } from "./deterministic-zip.js";

/**
 * netlify-cli hashes the sha256 of each function's whole ZIP (hash-fns.js), and
 * zip-it writes entries in a nondeterministic order, so an unchanged function
 * re-uploads on every deploy. The CLI skips zipping when
 * `.netlify/functions/manifest.json` is fresh, using the functions and config
 * listed there; this module writes that manifest with deterministic zips.
 */

/** The zip-it major this logic was verified against (netlify-cli 27.16.1 bundles 16.6.0). */
export const SUPPORTED_ZIP_IT_MAJOR = 16;
/** hash-fns.js MANIFEST_FILE_TTL: an older manifest is ignored and the CLI re-zips. */
export const NETLIFY_MANIFEST_TTL_MS = 120_000;
/** Seconds of the TTL that must remain when the CLI is launched. */
export const NETLIFY_MANIFEST_LAUNCH_MARGIN_MS = 30_000;
/** hash-fns.js status lines: the manifest was consumed, or it was discarded and the CLI re-zips. */
export const NETLIFY_MANIFEST_USED_MESSAGE = "Deploying functions from cache";
export const NETLIFY_MANIFEST_REJECTED_MESSAGES = [
  "Ignored invalid or expired functions cache",
  "No cached functions were found",
];

export interface NetlifyCli {
  packageDir: string;
  version: string;
  /** Absolute path of the CLI's JavaScript entry point, launched with node so no .cmd shim is needed. */
  entryPoint: string;
}

export interface ZipItModule {
  zipFunctions: (
    input: string[],
    destFolder: string,
    options?: Record<string, unknown>,
  ) => Promise<Array<{ name: string; path: string }>>;
}

export class NetlifyManifestExpiredError extends Error {
  constructor(public readonly ageMs: number) {
    super(
      `manifest-expired: functions manifest is ${Math.round(ageMs / 1000)}s old ` +
        `(netlify-cli ignores it after ${NETLIFY_MANIFEST_TTL_MS / 1000}s and re-zips with nondeterministic bytes)`,
    );
    this.name = "NetlifyManifestExpiredError";
  }
}

function readCliPackage(dir: string): NetlifyCli | undefined {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return undefined;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
    name?: string;
    version?: string;
    bin?: string | Record<string, string>;
  };
  if (pkg.name !== "netlify-cli" || !pkg.version) return undefined;
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.netlify;
  if (!bin) throw new Error("netlify-cli package.json declares no netlify bin");
  return {
    packageDir: dir,
    version: pkg.version,
    entryPoint: path.resolve(dir, bin),
  };
}

const SHIM_NAMES = ["netlify", "netlify.cmd", "netlify.ps1", "netlify.exe"];

export function findNetlifyCli(
  pathEnv: string | undefined = process.env.PATH,
): NetlifyCli {
  for (const dir of (pathEnv ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of SHIM_NAMES) {
      const bin = path.join(dir, name);
      if (!fs.existsSync(bin)) continue;
      // Unix: the shim is a symlink into the package. Windows npm: a .cmd file
      // beside node_modules/netlify-cli.
      let current = path.dirname(fs.realpathSync(bin));
      for (;;) {
        const found = readCliPackage(current);
        if (found) return found;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      // Project-local installs put the shim in node_modules/.bin, one level
      // below node_modules/netlify-cli.
      for (const candidate of [
        path.join(dir, "node_modules", "netlify-cli"),
        path.join(dir, "..", "netlify-cli"),
      ]) {
        const sibling = readCliPackage(candidate);
        if (sibling) return sibling;
      }
    }
  }
  throw new Error(
    "netlify-cli not found on PATH; install it so its bundled zip-it-and-ship-it can be used",
  );
}

/**
 * Loads zip-it from the CLI that will run the deploy, so the zips and the
 * manifest always come from the same version the CLI reads them with.
 */
export async function loadCliZipIt(
  cli: NetlifyCli,
): Promise<{ zipIt: ZipItModule; version: string }> {
  const require = createRequire(path.join(cli.packageDir, "package.json"));
  const entry = require.resolve("@netlify/zip-it-and-ship-it");
  let dir = path.dirname(entry);
  while (!fs.existsSync(path.join(dir, "package.json")))
    dir = path.dirname(dir);
  const version = (
    JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8")) as {
      version: string;
    }
  ).version;
  assertSupportedZipItVersion(version, cli.version);
  return {
    zipIt: (await import(pathToFileURL(entry).href)) as ZipItModule,
    version,
  };
}

export function assertSupportedZipItVersion(
  zipItVersion: string,
  cliVersion: string,
): void {
  const major = Number.parseInt(zipItVersion.split(".")[0] ?? "", 10);
  if (major !== SUPPORTED_ZIP_IT_MAJOR) {
    throw new Error(
      `netlify-cli ${cliVersion} bundles zip-it-and-ship-it ${zipItVersion}, but the ` +
        `deterministic function zips were verified against major ${SUPPORTED_ZIP_IT_MAJOR}. ` +
        `Re-verify the manifest format and update SUPPORTED_ZIP_IT_MAJOR.`,
    );
  }
}

export function assertManifestFresh(
  manifestPath: string,
  now: number,
  maxAgeMs: number = NETLIFY_MANIFEST_TTL_MS,
): void {
  const { timestamp } = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
    timestamp?: unknown;
  };
  if (typeof timestamp !== "number") {
    throw new Error(`${manifestPath} has no numeric timestamp`);
  }
  const age = now - timestamp;
  if (age > maxAgeMs) throw new NetlifyManifestExpiredError(age);
}

export interface PreparedFunctionZip {
  name: string;
  path: string;
  sha256: string;
}

/**
 * zip-it receives no netlify.toml `[functions]` settings here (included_files,
 * node_bundler, ...), and the CLI trusts the prebuilt manifest instead of
 * applying them, so a project that sets any must not use this path.
 */
export function assertNoFunctionsConfig(siteRoot: string): void {
  const tomlPath = path.join(siteRoot, "netlify.toml");
  if (!fs.existsSync(tomlPath)) return;
  const unsupported = fs
    .readFileSync(tomlPath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .some((line) => {
      if (line.startsWith("#")) return false;
      if (line.startsWith("[")) {
        const segments = line
          .replace(/^\[+|\]+\s*(#.*)?$/g, "")
          .split(".")
          .map((segment) => segment.trim().replace(/^["']|["']$/g, ""));
        return segments.includes("functions");
      }
      return /^["']?functions["']?\s*[.=]/.test(line);
    });
  if (unsupported) {
    throw new Error(
      `${tomlPath} sets functions options (a [functions] table, a context-scoped one, or a functions key) that the deterministic zip step does not apply; remove them or deploy with plain \`netlify deploy\``,
    );
  }
}

export async function prepareNetlifyFunctionZips(opts: {
  siteRoot: string;
  functionsDir: string;
  zipIt: ZipItModule;
  now?: () => number;
}): Promise<{ manifestPath: string; functions: PreparedFunctionZip[] }> {
  assertNoFunctionsConfig(opts.siteRoot);
  const now = opts.now ?? Date.now;
  const dest = path.join(opts.siteRoot, ".netlify", "functions");
  const manifestPath = path.join(dest, "manifest.json");
  const rel = path.relative(dest, opts.functionsDir);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(
      `functions directory ${opts.functionsDir} is inside the output directory ${dest}, which is cleaned before zipping; use a different --functions directory (default .netlify/functions-internal)`,
    );
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  const results = await opts.zipIt.zipFunctions([opts.functionsDir], dest, {
    basePath: opts.siteRoot,
    configFileDirectories: [opts.functionsDir],
    manifest: manifestPath,
  });
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `zip-it-and-ship-it produced no functions manifest at ${manifestPath}`,
    );
  }

  const functions: PreparedFunctionZip[] = [];
  for (const fn of results) {
    if (!fn.path.endsWith(".zip")) {
      throw new Error(
        `function ${fn.name} was not zipped (${fn.path}); the deterministic manifest only covers zipped functions`,
      );
    }
    const bytes = normalizeZip(fs.readFileSync(fn.path));
    fs.writeFileSync(fn.path, bytes);
    functions.push({
      name: fn.name,
      path: fn.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  // The manifest timestamp starts the CLI's TTL; restamp after the re-zip so
  // the clock covers only the time until `netlify deploy` reads it.
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
    timestamp: number;
  };
  manifest.timestamp = now();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return { manifestPath, functions };
}
