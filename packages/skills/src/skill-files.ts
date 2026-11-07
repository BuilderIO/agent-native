import fs from "node:fs";
import path from "node:path";

/**
 * Copies a skill folder as plain files, so the copy still works on another
 * machine. A link is followed only when it resolves inside `sourceRoot`, the
 * folder or repository the skill came from. A link out of it, or one that no
 * longer resolves, is left out, so a downloaded skill can't copy files from
 * elsewhere on this machine into the project.
 */
export function copySkillFiles(
  from: string,
  to: string,
  sourceRoot: string,
  skip: (name: string) => boolean = () => false,
): void {
  const root = fs.realpathSync(sourceRoot);
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter(source) {
      if (skip(path.basename(source))) return false;
      if (!fs.lstatSync(source).isSymbolicLink()) return true;
      // `existsSync` follows the link, so it is false for one that no longer
      // resolves.
      return fs.existsSync(source) && isInside(root, fs.realpathSync(source));
    },
  });
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
