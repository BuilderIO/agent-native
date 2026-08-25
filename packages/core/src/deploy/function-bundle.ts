/**
 * Placing a built Nitro server bundle into the extra platform functions that
 * run the same handler under a different trigger (background worker, scheduled
 * sweep).
 */
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

/**
 * Netlify has no shared-layer primitive: an extra function is its own deploy
 * artifact, so every emit has to place the whole handler bundle next to its
 * entry. Doing that with real copies wrote a byte-for-byte second `server/` per
 * function — hundreds of MB per workspace before the zip step ever ran.
 *
 * Hard links cost nothing on disk and are invisible to every reader
 * (zip-it-and-ship-it, the Netlify CLI, tar): a hard link IS a regular file,
 * unlike a symlink, which those readers may dereference, skip, or ship
 * dangling. Deleting the source afterwards (workspace deploy prunes each app's
 * build output) leaves the linked bundle intact.
 *
 * The clone shares inodes with the source, so never write in place into one:
 * remove the file and write a new one, as every emit here does. An in-place
 * write would land in the source bundle's bytes too.
 *
 * Symlinked sources are resolved before linking, so the clone is always a
 * regular file — see the note in `copyTree`.
 */
export function cloneServerBundleForFunction(src: string, dest: string): void {
  copyTree(src, dest, linkFile);
}

function linkFile(src: string, dest: string): void {
  // linkSync refuses an existing dest where copyFileSync overwrites it.
  fs.rmSync(dest, { force: true });
  try {
    fs.linkSync(src, dest);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Only "this filesystem will not hard-link" may spend real bytes instead;
    // any other failure means the bundle is incomplete and must stay loud.
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
        // link(2) does not dereference symlinks on Linux (BSD/macOS does), so
        // linking the link itself would put a symlink in the emitted function
        // on the deploy builder — and the clone sits at a different tree depth,
        // so a relative target would dangle. Place the target, not the link.
        placeFile(fs.realpathSync(srcPath), destPath);
      }
    } else if (entry.isDirectory()) {
      copyTree(srcPath, destPath, placeFile, nextAncestorRealPaths);
    } else {
      placeFile(srcPath, destPath);
    }
  }
}

/** Nitro's SSR page/asset route entries. Only the `/*` server function uses these. */
const SSR_ENTRY_FILES = [
  "_...page_.get.mjs",
  "_...page_.head.mjs",
  "_...asset_.get.mjs",
];

// Rolldown emits `import(`./x.mjs`)` with BACKTICKS; a quote-only pattern
// under-reports the graph by tens of MB and would delete reachable chunks.
const SPECIFIER = /(?:from|import|require)\s*\(?\s*(["'`])([^"'`]*)\1/g;

// `import(`${pkg}/server`)` is a BARE specifier and can never name a local
// chunk. Only a specifier that is relative BEFORE the interpolation is
// genuinely unresolvable, and that is when we must not guess.
const RELATIVE_INTERPOLATED = /import\s*\(\s*`\s*[./][^`]*\$\{/;

/**
 * Every file reachable from `main.mjs`, treating `removed` as already deleted.
 * Returns null when the graph cannot be resolved statically, so the caller
 * prunes nothing rather than deleting a chunk something still imports.
 */
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
      // Docs prose inside the bundle contains path-shaped strings that are not
      // imports; a specifier resolving to nothing is not an edge.
      if (!hit) continue;
      if (removed.has(path.relative(dir, hit))) continue;
      if (!visit(hit)) return false;
    }
    return true;
  };
  return visit(path.join(dir, "main.mjs")) ? seen : null;
}

/**
 * Drop the SSR page/asset island from a clone that can never route to it.
 *
 * The background and integration-recovery entries overwrite `url.pathname`
 * unconditionally before delegating to `main.mjs`, so those clones cannot reach
 * the page or asset handlers — yet each shipped a full copy of that island, and
 * Netlify zips and uploads every function separately. Deleting from the clone is
 * safe under hard links: only an in-place WRITE would reach the source bundle.
 */
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

/**
 * Read a package's manifest, or null when it has none. Shared with build.ts's
 * copyRuntimePackageTree, which is why this lives here rather than there:
 * build.ts already imports from this file, and the reverse import would be
 * circular.
 */
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

/**
 * Every installed package name directly under `nodeModulesDir`, scoped packages
 * expanded to `@scope/name`.
 *
 * Dot-prefixed entries are npm/pnpm bookkeeping, not packages — `.bin` holds
 * executable links and has no manifest, so treating it as a package makes the
 * closure walk throw on a perfectly normal bundle.
 */
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

/**
 * Every package name reachable from `roots` by walking the given manifest
 * fields — the same edge copyRuntimePackageTree (build.ts) follows to build the
 * browser runtime tree in the first place, so a package that tree copied in is
 * exactly a package this walk can find again.
 *
 * The two callers want deliberately different widths. "What might be dead"
 * walks `dependencies` only, so a dev/optional/peer listing cannot pull an
 * unrelated package into the browser's closure. "What must live" also walks
 * `optionalDependencies`: an installed optional dependency is one a surviving
 * package may still require at runtime, and deleting it is unrecoverable
 * whereas keeping it costs bytes. Err narrow when deciding what to delete and
 * wide when deciding what to spare.
 *
 * A dependency name with no directory here was never installed — the same
 * BARE_RUNTIME_ONLY_PACKAGES / SERVERLESS_FUNCTION_PACKAGE_DENYLIST exclusions
 * upstream leave real, expected gaps in a package's own "dependencies" field,
 * and a gap is not a resolution failure. A directory that DOES exist without a
 * readable package.json is one: the closure can no longer be trusted, so that
 * throws instead of guessing which way is safe.
 */
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
  // chromium-min, not chromium: the full package embeds a 66MB browser in every
  // emitted function, paid on every cold start to serve a fallback most requests
  // never take. The min package is 46KB and fetches the same pinned pack on
  // first launch. See chromiumPackUrl() in creative-context's rendered-page.
  // guard:allow-serverless-function-payload — -66.4MB per function, replaces "@sparticuz/chromium"
  "@sparticuz/chromium-min",
  "playwright-core",
] as const;

/**
 * Any path whose handler can reach an agent turn, directly or transitively.
 * `_process-run` is the obvious one, but the integration sweep and the
 * recurring-jobs sweep both resume tasks that run a full agent turn with the
 * app's whole tool surface, so a path-shape check alone is not enough.
 */
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

/**
 * Drop the serverless browser runtime — and everything installed only because
 * the runtime needed it — from a clone that can never run an agent turn.
 *
 * Playwright and @sparticuz/chromium are reached only through NON-LITERAL
 * dynamic imports in creative-context's rendered-page connector, so no static
 * walk can prove them dead. The caller asserts it instead, and this refuses the
 * prune when the entry rewrites to a route that could reach an agent — a
 * scheduled report sweep can drop the runtime, an agent worker cannot.
 *
 * Deleting just the two known directories used to leave their whole
 * dependency closure behind — packages like tar-fs and pump that exist in
 * `node_modules` for no other reason than @sparticuz/chromium-min or
 * playwright-core needing them. Those are orphaned the instant the runtime is
 * gone, so this walks the closure and removes it too, keeping only what a
 * still-present, unrelated package also depends on.
 */
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
    // Everything reachable from the runtime being deleted — e.g.
    // @sparticuz/chromium-min's tar-fs, and everything tar-fs needs. A member
    // of this set is dead UNLESS some other, unrelated top-level package also
    // depends on it — `stillNeeded` proves that by walking every package that
    // ISN'T itself downstream of the runtime, so it can never trivially
    // "prove itself" reachable.
    const browserClosure = reachablePackageNames(nodeModulesDir, browserRoots);
    // The function's own manifest is a liveness root too. Its dependencies are
    // what the emitted bundle traced directly, so a package that is BOTH in the
    // browser closure and imported by the surviving server has no other package
    // vouching for it and would be deleted out from under a live import. The
    // browser roots are excluded — they are declared there as well, and keeping
    // them would make the whole closure look alive.
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
      // The roots are deleted below, after their closure.
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
  // unrelated @sparticuz/* package that some other dependency still needs would
  // otherwise go with the scope, and `stillNeeded` has no way to protect it.
  // The scope is removed afterwards only once nothing is left in it.
  for (const name of browserRoots) {
    const dir = path.join(nodeModulesDir, ...name.split("/"));
    if (!fs.existsSync(dir)) continue;
    bytes += dirSize(dir);
    // Hard links: deleting the clone's link never touches the source bundle.
    fs.rmSync(dir, { recursive: true, force: true });
    removeScopeIfEmpty(nodeModulesDir, dir);
  }
  return bytes;
}
