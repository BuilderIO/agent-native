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
 * longer resolves, resolves outside `within`, or leads back to a folder the
 * copy is already inside, which would copy forever.
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
      if (target === undefined) return false;
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
