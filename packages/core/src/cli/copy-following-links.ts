import fs from "node:fs";
import path from "node:path";

export interface CopyFollowingLinksOptions {
  /** Folders a followed link has to resolve inside. Unset, it may go anywhere. */
  within?: string[];
  /**
   * Leaves an entry out by name. A followed link is also left out when a
   * folder on its way from the `within` folder it resolves in has such a name.
   */
  skip?: (name: string) => boolean;
}

/**
 * Copies a folder as plain files, following the links inside it, so the copy
 * still works on another machine. A link inside it is left out when it no
 * longer resolves, resolves outside `within`, leads back to a folder the copy
 * is already inside, or leads into or above `to`; the last two would copy
 * forever or copy the copy into itself.
 *
 * The filter matters even with nothing to leave out: without one, Node 24's
 * `cpSync` takes a native shortcut that follows only a link at the top of the
 * copy and copies the links inside it as links with absolute targets.
 */
export function copyFollowingLinks(
  from: string,
  to: string,
  options: CopyFollowingLinksOptions = {},
): void {
  copyLeavingOut(from, to, options, [landingPath(to)]);
}

// `copyFollowingLinks`, leaving out a link into or above any of
// `destinations` rather than only `to`.
function copyLeavingOut(
  from: string,
  to: string,
  options: CopyFollowingLinksOptions,
  destinations: string[],
): void {
  const top = path.resolve(from);
  const within = options.within?.map((root) => fs.realpathSync(root));
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter(source) {
      // The top is copied as given, and an error about it is the caller's.
      if (path.resolve(source) === top) return true;
      if (options.skip?.(path.basename(source))) return false;
      if (!fs.lstatSync(source).isSymbolicLink()) return true;
      const target = resolveLink(source);
      if (
        target === undefined ||
        destinations.some(
          (folder) => isInside(folder, target) || isInside(target, folder),
        )
      ) {
        return false;
      }
      if (within) {
        const root = within.find((folder) => isInside(folder, target));
        if (root === undefined) return false;
        const skip = options.skip;
        if (skip && path.relative(root, target).split(path.sep).some(skip)) {
          return false;
        }
      }
      return !leadsBackIntoCopy(top, source, target);
    },
  });
}

/**
 * Replaces `to` with a copy of `from` made as `copyFollowingLinks` makes it.
 * The copy is made beside `to` and swapped in only once it is whole, so a
 * copy that fails partway, such as on a link this user can't read, leaves
 * what was at `to` in place. It throws before touching `to` when the two
 * overlap, since replacing `to` would delete what the copy comes from.
 */
export function replaceFollowingLinks(
  from: string,
  to: string,
  options: CopyFollowingLinksOptions = {},
): void {
  const real = fs.realpathSync(from);
  const landing = landingPath(to);
  if (isInside(real, landing) || isInside(landing, real)) {
    throw new Error(
      `${from} and ${to} overlap, so replacing ${to} would delete it`,
    );
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const staging = fs.mkdtempSync(
    path.join(path.dirname(to), `.${path.basename(to)}-`),
  );
  const aside = path.join(staging, "earlier");
  try {
    const copy = path.join(staging, "copy");
    // A link into `to` would carry what is there now into its replacement.
    copyLeavingOut(from, copy, options, [landingPath(copy), landing]);
    swapIn(copy, to, aside);
  } finally {
    // Kept when what was at `to` couldn't be put back, as it's the only copy.
    if (!exists(aside) || exists(to)) {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}

// Moves `copy` to `to`. What was at `to` is moved aside first rather than
// deleted, and moved back if the move fails, as it can on Windows while
// another program has a file in `to` open.
function swapIn(copy: string, to: string, aside: string): void {
  const earlier = exists(to);
  if (earlier) fs.renameSync(to, aside);
  try {
    fs.renameSync(copy, to);
  } catch (error) {
    if (!earlier) throw error;
    try {
      fs.renameSync(aside, to);
    } catch (restoreError) {
      throw new Error(
        `Couldn't replace ${to}, nor put it back: it is now at ${aside} (${(restoreError as Error).message})`,
        { cause: error },
      );
    }
    throw error;
  }
}

function exists(file: string): boolean {
  return fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined;
}

// Where `to` sits on disk, with the folders above it resolved but not `to`
// itself: a link at `to` is replaced, not followed, so it isn't an overlap.
function landingPath(to: string): string {
  const rest = [path.basename(path.resolve(to))];
  for (let dir = path.dirname(path.resolve(to)); ; dir = path.dirname(dir)) {
    const real = resolveLink(dir);
    if (real !== undefined) return path.join(real, ...rest);
    rest.unshift(path.basename(dir));
  }
}

// The real path a link leads to, or `undefined` when it leads nowhere: its
// target is gone, or links loop. Any other error, such as a target this user
// can't read, is thrown rather than leave the copy quietly incomplete.
function resolveLink(link: string): string | undefined {
  try {
    return fs.realpathSync(link);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
      return undefined;
    }
    throw error;
  }
}

// Whether a link's target is, or holds, a folder the copy is already inside
// on its way to the link.
function leadsBackIntoCopy(top: string, link: string, target: string): boolean {
  for (let dir = path.dirname(path.resolve(link)); ; dir = path.dirname(dir)) {
    if (isInside(target, fs.realpathSync(dir))) return true;
    if (dir === top || path.dirname(dir) === dir) return false;
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

// Whether a link was made for a folder or a file. Only Windows tells the two
// apart, and its links keep the kind after their target is gone: opening a
// dangling folder link as a folder fails with ENOENT, a file link with ENOTDIR.
export function linkKind(linkPath: string): "file" | "dir" {
  const resolved = fs.statSync(linkPath, { throwIfNoEntry: false });
  if (resolved) return resolved.isDirectory() ? "dir" : "file";
  try {
    fs.opendirSync(linkPath).closeSync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") return "file";
  }
  return "dir";
}
