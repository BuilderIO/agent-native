/**
 * Require a default export from every `server/plugins/` source file. Nitro
 * calls each plugin's default export, so a plugin without one passes
 * typecheck but fails the production build with
 * `[MISSING_EXPORT] "default" is not exported by "server/plugins/..."`.
 */

import path from "node:path";

import { maskNonCode, readFileSafe, relPosix, walk } from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

// Mirrors Nitro's plugin scan (`plugins/**/*.{js,mjs,cjs,ts,mts,cts,tsx,jsx}`)
// minus the spec/test files `NITRO_RUNTIME_IGNORE_PATTERNS` in deploy/build.ts
// excludes.
const PLUGIN_FILE_RE = /\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx)$/;
const IGNORED_FILE_RE = /\.(?:spec|test)\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx)$/;
// Declaration files compile to empty modules, so they never export a default.
const DECLARATION_FILE_RE = /\.d\.(?:ts|mts|cts)$/;
const JSX_FILE_RE = /\.(?:tsx|jsx)$/;

const EXPORT_DEFAULT_RE =
  /\bexport\s+default\b(?!\s*interface\b)(?:\s*([A-Za-z_$][\w$]*)\s*(?:;|$))?/gm;
const EXPORT_STAR_AS_DEFAULT_RE = /\bexport\s*\*\s*as\s+default\b/;
const COMMONJS_EXPORT_RE = /\bmodule\.exports\s*=|\bexports\.default\s*=/;
const EXPORT_LIST_RE = /\bexport\s*(type\s+)?\{([^}]*)\}(\s*from\b)?/g;
const TYPE_DECLARATION_RE =
  /\binterface\s+([A-Za-z_$][\w$]*)|\btype\s+([A-Za-z_$][\w$]*)\s*(?:<[^;]*?>)?\s*=/g;

/** Names declared only as `interface`/`type`, which TypeScript erases, so
 * exporting one as default leaves no runtime default. */
function typeOnlyNames(code: string): Set<string> {
  const names = new Set<string>();
  for (const match of code.matchAll(TYPE_DECLARATION_RE)) {
    const name = match[1] ?? match[2];
    if (!name) continue;
    const valueDeclaration = new RegExp(
      `\\b(?:const|let|var|function\\*?|class|enum|namespace|import)\\b[^;]*?(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`,
    );
    if (!valueDeclaration.test(code)) names.add(name);
  }
  return names;
}

function isRuntimeDefaultSpecifier(
  specifier: string,
  typeOnly: Set<string>,
): boolean {
  const tokens = specifier.trim().split(/\s+/);
  if (tokens.at(-1) !== "default") return false;
  if (tokens.length !== 1 && tokens.at(-2) !== "as") return false;
  // `type default` / `type Foo as default` are erased at runtime.
  if (tokens[0] === "type" && (tokens.length === 2 || tokens.length === 4)) {
    return false;
  }
  return !(tokens.length === 3 && typeOnly.has(tokens[0] ?? ""));
}

function findsDefaultExport(code: string): boolean {
  if (EXPORT_STAR_AS_DEFAULT_RE.test(code) || COMMONJS_EXPORT_RE.test(code)) {
    return true;
  }
  const typeOnly = typeOnlyNames(code);
  for (const match of code.matchAll(EXPORT_DEFAULT_RE)) {
    if (!match[1] || !typeOnly.has(match[1])) return true;
  }
  for (const match of code.matchAll(EXPORT_LIST_RE)) {
    if (match[1]) continue;
    // Re-exported names resolve in the source module, not local types.
    const localTypes = match[3] ? new Set<string>() : typeOnly;
    const specifiers = (match[2] ?? "").split(",");
    if (
      specifiers.some((spec) => isRuntimeDefaultSpecifier(spec, localTypes))
    ) {
      return true;
    }
  }
  return false;
}

/** `jsx` also checks the unmasked source, because JSX text (apostrophes,
 * `https://`) can look like strings or comments to `maskNonCode` and hide a
 * real export; a missed finding is cheaper than blocking a valid build. */
export function hasDefaultExport(
  source: string,
  options: { jsx?: boolean } = {},
): boolean {
  if (findsDefaultExport(maskNonCode(source))) return true;
  return options.jsx === true && findsDefaultExport(source);
}

export function scanServerPluginDefaultExport(
  options: GuardScanOptions,
): GuardResult {
  const { root } = options;
  const pluginsDir = path.join(root, "server", "plugins");
  const findings: GuardFinding[] = [];

  const files = [...walk(pluginsDir, new Set())]
    .filter((file) => PLUGIN_FILE_RE.test(file) && !IGNORED_FILE_RE.test(file))
    .sort();

  for (const file of files) {
    const source = readFileSafe(file);
    if (source === null) continue;
    if (
      !DECLARATION_FILE_RE.test(file) &&
      hasDefaultExport(source, { jsx: JSX_FILE_RE.test(file) })
    ) {
      continue;
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
