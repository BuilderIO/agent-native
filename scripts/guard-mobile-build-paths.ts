import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
// Paths stay repo-relative with "/" separators on every OS: main() and the
// workflow path filters split and match on "/".
import { posix as path } from "node:path";

import { parse } from "yaml";

const WORKFLOW = ".github/workflows/mobile-build-check.yml";
const MOBILE_APP = "packages/mobile-app";
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  ".expo",
  "android",
  "ios",
]);

const IMPORT_PATTERN =
  /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

function isSourceFile(file: string): boolean {
  return (
    SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext)) &&
    !file.endsWith(".d.ts") &&
    !/\.(?:spec|test)\.tsx?$/.test(file)
  );
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listSourceFiles(full));
    else if (isSourceFile(full)) files.push(full);
  }
  return files;
}

export function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    if (match[1]) continue;
    const specifier = match[2] ?? match[3] ?? match[4];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function withSourceExtensions(base: string): string[] {
  const stem = base.replace(/\.(?:m?js|jsx)$/, "");
  return [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => stem + ext),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(stem, `index${ext}`)),
  ];
}

function exportTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const conditions = value as Record<string, unknown>;
    for (const key of ["react-native", "browser", "import", "default"]) {
      const target = exportTarget(conditions[key]);
      if (target) return target;
    }
  }
  return null;
}

function resolveWorkspaceSpecifier(specifier: string): string | null {
  const match = specifier.match(/^@agent-native\/([^/]+)(?:\/(.+))?$/);
  if (!match) return null;
  const packageDir = path.join("packages", match[1]);
  const manifestPath = path.join(packageDir, "package.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    exports?: Record<string, unknown>;
  };
  const key = match[2] ? `./${match[2]}` : ".";
  let target = exportTarget(manifest.exports?.[key]);
  if (!target) {
    for (const [pattern, value] of Object.entries(manifest.exports ?? {})) {
      const [prefix, suffix] = pattern.split("*");
      if (
        suffix !== undefined &&
        key.startsWith(prefix) &&
        key.endsWith(suffix)
      ) {
        const wildcard = key.slice(prefix.length, key.length - suffix.length);
        target = exportTarget(value)?.replaceAll("*", wildcard) ?? null;
        break;
      }
    }
  }
  if (!target) return null;
  // Metro bundles each package's built dist, which compiles from src (or
  // from the package root when there is no src directory).
  const built = target.replace(/^\.\//, "");
  return firstExisting([
    ...withSourceExtensions(
      path.join(packageDir, built.replace(/^dist\//, "src/")),
    ),
    ...withSourceExtensions(
      path.join(packageDir, built.replace(/^dist\//, "")),
    ),
  ]);
}

function resolveImport(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith(".")) {
    return firstExisting(
      withSourceExtensions(path.join(path.dirname(fromFile), specifier)),
    );
  }
  return resolveWorkspaceSpecifier(specifier);
}

function tsconfigChain(file: string, into: Set<string>): void {
  if (into.has(file) || !existsSync(file)) return;
  into.add(file);
  const parent = readFileSync(file, "utf8").match(
    /"extends"\s*:\s*"([^"]+)"/,
  )?.[1];
  if (parent?.startsWith(".")) {
    const resolved = path.join(path.dirname(file), parent);
    tsconfigChain(
      resolved.endsWith(".json") ? resolved : `${resolved}.json`,
      into,
    );
  }
}

/**
 * Files a bundled package's `build` script reads besides its source: Metro
 * bundles the built dist, so a compiler config change can change the bundle.
 */
export function packageBuildInputs(packageDir: string): string[] {
  const manifestPath = path.join(packageDir, "package.json");
  const inputs = new Set<string>([manifestPath]);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  for (const command of (manifest.scripts?.build ?? "").split("&&")) {
    const [bin, ...args] = command.trim().split(/\s+/);
    if (bin === "tsc") {
      const project = args.indexOf("-p");
      tsconfigChain(
        path.join(
          packageDir,
          project >= 0 ? args[project + 1] : "tsconfig.json",
        ),
        inputs,
      );
    } else if (bin === "node" && args[0]) {
      inputs.add(path.join(packageDir, args[0]));
    }
  }
  return [...inputs].sort();
}

/** Workspace source files the mobile app's Metro bundle can reach. */
export function mobileBundleInputs(): string[] {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const file of listSourceFiles(MOBILE_APP)) {
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith("@agent-native/")) continue;
      const resolved = resolveWorkspaceSpecifier(specifier);
      if (!resolved) {
        throw new Error(`${file}: cannot resolve ${specifier} to source`);
      }
      queue.push(resolved);
    }
  }
  while (queue.length > 0) {
    const file = path.normalize(queue.pop()!);
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (
        !specifier.startsWith(".") &&
        !specifier.startsWith("@agent-native/")
      ) {
        continue;
      }
      const resolved = resolveImport(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen].sort();
}

function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      source += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** GitHub `paths` semantics: the last matching pattern wins, `!` excludes. */
export function matchesPathFilter(
  file: string,
  patterns: readonly string[],
): boolean {
  let included = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    if (globToRegExp(negated ? pattern.slice(1) : pattern).test(file)) {
      included = !negated;
    }
  }
  return included;
}

function workflowPathFilters(): Record<string, string[]> {
  const workflow = parse(readFileSync(WORKFLOW, "utf8")) as {
    on?: Record<string, { paths?: string[] } | null>;
  };
  const filters: Record<string, string[]> = {};
  for (const event of ["pull_request", "push"]) {
    const paths = workflow.on?.[event]?.paths;
    if (!Array.isArray(paths)) {
      throw new Error(`${WORKFLOW}: on.${event}.paths must be a list`);
    }
    filters[event] = paths;
  }
  return filters;
}

function main(): void {
  const sources = mobileBundleInputs();
  const bundledPackages = new Set(
    sources
      .filter((file) => !file.startsWith(`${MOBILE_APP}/`))
      .map((file) => file.split("/").slice(0, 2).join("/")),
  );
  const inputs = [
    ...sources,
    ...[...bundledPackages].flatMap((dir) => packageBuildInputs(dir)),
  ];
  const failures: string[] = [];
  const filters = workflowPathFilters();
  if (JSON.stringify(filters.pull_request) !== JSON.stringify(filters.push)) {
    failures.push("on.pull_request.paths and on.push.paths differ");
  }
  for (const [event, patterns] of Object.entries(filters)) {
    const missed = inputs.filter((file) => !matchesPathFilter(file, patterns));
    for (const file of missed)
      failures.push(`on.${event}.paths misses ${file}`);
  }
  if (failures.length > 0) {
    console.error(
      `[mobile-build-paths] ${WORKFLOW} would skip changes the mobile bundle imports:`,
    );
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      "Add the file (or its directory) to both path filters so a change to it runs the mobile build.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `[mobile-build-paths] ${inputs.length} mobile bundle inputs are covered by both path filters.`,
  );
}

if (process.argv[1]?.endsWith("guard-mobile-build-paths.ts")) {
  main();
}
