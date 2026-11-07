import fs from "node:fs";
import path from "node:path";

/**
 * Copies a skill folder as plain files, so the copy still works on another
 * machine. A link is followed only when it resolves inside `sourceRoot`, the
 * folder or repository the skill came from. A link out of it, one that no
 * longer resolves, or one that leads back to a folder the copy is already
 * inside (which would copy forever) is left out, so a downloaded skill can't
 * copy files from elsewhere on this machine into the project. A link inside
 * the skill is also left out when its target sits under a name `skip` leaves
 * out, such as `.git`; the skill folder itself may be linked from anywhere in
 * the source, `node_modules` included.
 *
 * Core's `copyFollowingLinks` follows the same rules.
 */
export function copySkillFiles(
  from: string,
  to: string,
  sourceRoot: string,
  skip: (name: string) => boolean = () => false,
): void {
  const top = path.resolve(from);
  const root = fs.realpathSync(sourceRoot);
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter(source) {
      if (skip(path.basename(source))) return false;
      if (!fs.lstatSync(source).isSymbolicLink()) return true;
      // `existsSync` follows the link, so it is false for one that no longer
      // resolves.
      if (!fs.existsSync(source)) return false;
      const target = fs.realpathSync(source);
      if (!isInside(root, target)) return false;
      if (path.resolve(source) === top) return true;
      return (
        !path.relative(root, target).split(path.sep).some(skip) &&
        !leadsBackIntoCopy(top, source, target)
      );
    },
  });
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
