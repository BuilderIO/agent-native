import fs from "fs";
import path from "path";

type PlaceFile = (src: string, dest: string) => void;

export function copyDir(
  src: string,
  dest: string,
  ancestorRealPaths = new Set<string>(),
) {
  copyTree(src, dest, fs.copyFileSync, ancestorRealPaths);
}

export function cloneServerBundleForFunction(src: string, dest: string): void {
  copyTree(src, dest, linkFile);
}

function linkFile(src: string, dest: string): void {
  fs.rmSync(dest, { force: true });
  try {
    fs.linkSync(src, dest);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV" && code !== "EPERM" && code !== "EMLINK") throw error;
    fs.copyFileSync(src, dest);
  }
}

function copyTree(
  src: string,
  dest: string,
  placeFile: PlaceFile,
  ancestorRealPaths = new Set<string>(),
): void {
  const realSrc = fs.realpathSync(src);
  if (ancestorRealPaths.has(realSrc)) return;
  const nextAncestorRealPaths = new Set(ancestorRealPaths);
  nextAncestorRealPaths.add(realSrc);

  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(srcPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          console.warn(
            `[deploy] Skipping broken symlink while copying ${srcPath}`,
          );
          continue;
        }
        throw error;
      }
      if (stat.isDirectory()) {
        copyTree(srcPath, destPath, placeFile, nextAncestorRealPaths);
      } else {
        placeFile(fs.realpathSync(srcPath), destPath);
      }
    } else if (entry.isDirectory()) {
      copyTree(srcPath, destPath, placeFile, nextAncestorRealPaths);
    } else {
      placeFile(srcPath, destPath);
    }
  }
}

const SSR_ENTRY_FILES = [
  "_...page_.get.mjs",
  "_...page_.head.mjs",
  "_...asset_.get.mjs",
];

const SPECIFIER = /(?:from|import|require)\s*\(?\s*(["'`])([^"'`]*)\1/g;

const RELATIVE_INTERPOLATED = /import\s*\(\s*`\s*[./][^`]*\$\{/;

function reachableFiles(dir: string, removed: Set<string>): Set<string> | null {
  const seen = new Set<string>();
  const visit = (file: string): boolean => {
    if (seen.has(file)) return true;
    seen.add(file);
    let src: string;
    try {
      src = fs.readFileSync(file, "utf-8");
    } catch {
      return true;
    }
    if (RELATIVE_INTERPOLATED.test(src)) return false;
    SPECIFIER.lastIndex = 0;
    for (let m: RegExpExecArray | null; (m = SPECIFIER.exec(src)); ) {
      const spec = m[2];
      if (!spec.startsWith(".")) continue;
      const base = path.resolve(path.dirname(file), spec);
      const hit = [
        base,
        `${base}.mjs`,
        `${base}.js`,
        path.join(base, "index.mjs"),
      ].find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
      if (!hit) continue;
      if (removed.has(path.relative(dir, hit))) continue;
      if (!visit(hit)) return false;
    }
    return true;
  };
  return visit(path.join(dir, "main.mjs")) ? seen : null;
}

export function pruneSsrIslandFromRewritingClone(
  dest: string,
  entryText: string,
): number {
  if (!/^\s*url\.pathname\s*=/m.test(entryText)) {
    throw new Error(
      "[deploy] SSR prune requires a clone entry that rewrites url.pathname unconditionally",
    );
  }
  const full = reachableFiles(dest, new Set());
  const lean = reachableFiles(dest, new Set(SSR_ENTRY_FILES));
  if (!full || !lean) {
    console.warn(
      "[deploy] SSR prune skipped: unresolvable relative dynamic import in the clone.",
    );
    return 0;
  }

  let bytes = 0;
  for (const file of full) {
    if (lean.has(file)) continue;
    try {
      bytes += fs.statSync(file).size;
      fs.rmSync(file, { force: true });
    } catch {
      // coercion-ok: a file already gone is the goal state, and its bytes were
      // read before the unlink, so the reported total stays honest.
    }
  }
  for (const name of SSR_ENTRY_FILES) {
    fs.rmSync(path.join(dest, name), { force: true });
  }
  return bytes;
}

export function readPackageManifest(
  packageDir: string,
): Record<string, unknown> | null {
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return null;
  const manifest: unknown = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8"),
  );
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return null;
  }
  return manifest as Record<string, unknown>;
}

function listTopLevelPackageNames(nodeModulesDir: string): string[] {
  if (!fs.existsSync(nodeModulesDir)) return [];
  const names: string[] = [];
  for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (!entry.name.startsWith("@")) {
      names.push(entry.name);
      continue;
    }
    const scopeDir = path.join(nodeModulesDir, entry.name);
    for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
      if (scoped.isDirectory()) names.push(`${entry.name}/${scoped.name}`);
    }
  }
  return names;
}

function reachablePackageNames(
  nodeModulesDir: string,
  roots: Iterable<string>,
  fields: readonly string[] = ["dependencies"],
): Set<string> {
  const seen = new Set<string>();
  const visit = (packageName: string): void => {
    if (seen.has(packageName)) return;
    seen.add(packageName);
    const packageDir = path.join(nodeModulesDir, ...packageName.split("/"));
    if (!fs.existsSync(packageDir)) return;
    const manifest = readPackageManifest(packageDir);
    if (!manifest) {
      throw new Error(
        `[deploy] ${packageDir} has no readable package.json; cannot compute the runtime dependency closure it belongs to.`,
      );
    }
    for (const field of fields) {
      const dependencies = manifest[field];
      if (!dependencies || typeof dependencies !== "object") continue;
      for (const dependencyName of Object.keys(
        dependencies as Record<string, unknown>,
      )) {
        visit(dependencyName);
      }
    }
  };
  for (const root of roots) visit(root);
  return seen;
}

/**
 * Drop a now-empty `@scope` directory. Never remove a scope that still holds a
 * package: an unrelated `@sparticuz/*` some other dependency needs lives in the
 * same scope as the browser runtime, and the closure walk cannot protect what a
 * scope-wide delete takes.
 */
function removeScopeIfEmpty(nodeModulesDir: string, packageDir: string): void {
  const scopeDir = path.dirname(packageDir);
  if (scopeDir === nodeModulesDir) return;
  if (fs.readdirSync(scopeDir).length > 0) return;
  fs.rmSync(scopeDir, { recursive: true, force: true });
}

/**
 * The browser runtime copied into serverless functions, by exact package name.
 *
 * Exact names, never the `@sparticuz` scope: another dependency can install an
 * unrelated package into the same scope, and a scope-wide delete takes it with
 * no way for the closure walk to prove it is still needed. build.ts imports
 * this rather than declaring its own copy, so the list that is copied in and
 * the list that is pruned out cannot drift apart.
 */
export const SERVERLESS_BROWSER_RUNTIME_PACKAGES = [
  // guard:allow-serverless-function-payload — -66.4MB per function, replaces "@sparticuz/chromium"
  "@sparticuz/chromium-min",
  "playwright-core",
] as const;

const AGENT_CAPABLE_PATH =
  /_process-run|_process-task|\/integrations\/|recurring-jobs/;

function dirSize(dir: string): number {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          // coercion-ok: an unreadable entry contributes no measurable bytes and
          // must not abort a size report.
        }
      }
    }
  }
  return total;
}

export function pruneBrowserRuntimeFromNonAgentClone(
  dest: string,
  entryText: string,
): number {
  if (!/^\s*url\.pathname\s*=/m.test(entryText)) {
    throw new Error(
      "[deploy] browser-runtime prune requires a clone entry that rewrites url.pathname unconditionally",
    );
  }
  if (AGENT_CAPABLE_PATH.test(entryText)) {
    throw new Error(
      "[deploy] refusing to prune the browser runtime from a clone whose entry names an agent-capable route",
    );
  }

  const nodeModulesDir = path.join(dest, "node_modules");
  const browserRoots: string[] = SERVERLESS_BROWSER_RUNTIME_PACKAGES.filter(
    (name) => fs.existsSync(path.join(nodeModulesDir, ...name.split("/"))),
  );

  let bytes = 0;
  if (browserRoots.length > 0) {
    const browserClosure = reachablePackageNames(nodeModulesDir, browserRoots);
    const ownManifest = readPackageManifest(dest);
    const ownDependencies = ["dependencies", "optionalDependencies"]
      .flatMap((field) =>
        Object.keys(
          (ownManifest?.[field] as Record<string, unknown> | undefined) ?? {},
        ),
      )
      .filter((name) => !browserRoots.includes(name));
    const otherRoots = [
      ...listTopLevelPackageNames(nodeModulesDir).filter(
        (name) => !browserClosure.has(name),
      ),
      ...ownDependencies,
    ];
    const stillNeeded = reachablePackageNames(nodeModulesDir, otherRoots, [
      "dependencies",
      "optionalDependencies",
    ]);

    for (const packageName of browserClosure) {
      if (browserRoots.includes(packageName)) continue;
      if (stillNeeded.has(packageName)) continue;
      const packageDir = path.join(nodeModulesDir, ...packageName.split("/"));
      if (!fs.existsSync(packageDir)) continue;
      bytes += dirSize(packageDir);
      fs.rmSync(packageDir, { recursive: true, force: true });
      removeScopeIfEmpty(nodeModulesDir, packageDir);
    }
  }

  // Delete the roots themselves by package name, never by scope directory: an
  // otherwise go with the scope, and `stillNeeded` has no way to protect it.
  // The scope is removed afterwards only once nothing is left in it.
  for (const name of browserRoots) {
    const dir = path.join(nodeModulesDir, ...name.split("/"));
    if (!fs.existsSync(dir)) continue;
    bytes += dirSize(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    removeScopeIfEmpty(nodeModulesDir, dir);
  }
  return bytes;
}
