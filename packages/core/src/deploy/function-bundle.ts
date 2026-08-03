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
        placeFile(srcPath, destPath);
      }
    } else if (entry.isDirectory()) {
      copyTree(srcPath, destPath, placeFile, nextAncestorRealPaths);
    } else {
      placeFile(srcPath, destPath);
    }
  }
}
