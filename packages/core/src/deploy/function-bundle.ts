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
