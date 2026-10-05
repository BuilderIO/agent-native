/**
 * Require a default export from every `server/plugins/` source file. Nitro
 * calls each plugin's default export, so a plugin without one passes
 * typecheck but fails the production build with
 * `[MISSING_EXPORT] "default" is not exported by "server/plugins/..."`.
 */

import fs from "node:fs";
import path from "node:path";

import { buildSync, type Loader } from "esbuild";

import { readFileSafe, relPosix } from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

// Mirrors Nitro's plugin scan (`plugins/**/*.{js,mjs,cjs,ts,mts,cts,tsx,jsx}`)
// minus the spec/test files `NITRO_RUNTIME_IGNORE_PATTERNS` in deploy/build.ts
// excludes.
const PLUGIN_FILE_RE = /\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx)$/;
const IGNORED_FILE_RE = /\.(?:spec|test)\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx)$/;
// Declaration files compile to empty modules, so they never export a default.
const DECLARATION_FILE_RE = /\.d\.(?:ts|mts|cts)$/;

/** Like `walk`, but follows symlinks the way Nitro's plugin glob does. */
function* walkFollowingSymlinks(
  dir: string,
  seen = new Set<string>(),
): Generator<string> {
  let realDir: string;
  let entries: fs.Dirent[];
  try {
    realDir = fs.realpathSync(dir);
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (seen.has(realDir)) return;
  seen.add(realDir);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch (error) {
      // A dangling symlink is not a file Nitro can load.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stat.isDirectory()) yield* walkFollowingSymlinks(full, seen);
    else if (stat.isFile()) yield full;
  }
}

function loaderFor(file: string): Loader {
  if (file.endsWith(".tsx")) return "tsx";
  if (file.endsWith(".jsx")) return "jsx";
  if (/\.[mc]?ts$/.test(file)) return "ts";
  return "js";
}

/** The module's runtime export names after TypeScript erasure, or `null` when
 * esbuild cannot parse it (the real build reports that error itself). */
export function runtimeExports(source: string, file: string): string[] | null {
  try {
    const result = buildSync({
      stdin: { contents: source, loader: loaderFor(file), sourcefile: file },
      bundle: false,
      write: false,
      metafile: true,
      format: "esm",
      jsx: "preserve",
      tsconfigRaw: "{}",
      logLevel: "silent",
    });
    const output = Object.values(result.metafile.outputs).find(
      (entry) => entry.entryPoint,
    );
    return output?.exports ?? [];
  } catch (error) {
    // esbuild reports syntax errors as a BuildFailure with an `errors` list.
    if (error instanceof Error && Array.isArray(Reflect.get(error, "errors"))) {
      return null;
    }
    throw error;
  }
}

export function scanServerPluginDefaultExport(
  options: GuardScanOptions,
): GuardResult {
  const { root } = options;
  const pluginsDir = path.join(root, "server", "plugins");
  const findings: GuardFinding[] = [];

  const files = [...walkFollowingSymlinks(pluginsDir)]
    .filter((file) => PLUGIN_FILE_RE.test(file) && !IGNORED_FILE_RE.test(file))
    .sort();

  for (const file of files) {
    const source = readFileSafe(file);
    if (source === null) continue;
    if (!DECLARATION_FILE_RE.test(file)) {
      const exports = runtimeExports(source, file);
      if (exports === null || exports.includes("default")) continue;
    }
    const rel = relPosix(root, file);
    findings.push({
      file: rel,
      line: 1,
      message: `${rel} has no default export. Nitro calls each server plugin's default export, so the production build fails with [MISSING_EXPORT]. Use \`export default defineNitroPlugin(...)\`, or move registration-only code to \`server/\` and import it from a plugin.`,
    });
  }

  return { name: "server-plugin-default-export", findings };
}
