import fs from "node:fs";
import path from "node:path";

/**
 * Replaces `to` with a copy of a skill folder as plain files, so the copy
 * still works on another machine. A link is followed only when it resolves
 * inside `sourceRoot`, the folder or repository the skill came from. A link
 * out of it, one that no longer resolves, or one that leads back to a folder
 * the copy is already inside (which would copy forever) is left out, so a
 * downloaded skill can't copy files from elsewhere on this machine into the
 * project. A `.git` or `node_modules` folder is left out too, and so is a
 * link inside the skill whose target sits under one.
 *
 * The skill folder itself may be a link to anywhere in the source,
 * `node_modules` included. If it leads out of the source or nowhere, this
 * throws before `to` is touched, rather than install nothing.
 *
 * Core's `copyFollowingLinks` follows the same rules.
 */
export function copySkillFiles(
  from: string,
  to: string,
  sourceRoot: string,
): void {
  const top = path.resolve(from);
  const root = fs.realpathSync(sourceRoot);
  if (!fs.existsSync(from)) {
    throw new Error(`Skill folder not found: ${from}`);
  }
  const real = fs.realpathSync(from);
  if (!isInside(root, real)) {
    throw new Error(`Skill folder ${from} links outside its source: ${real}`);
  }
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter(source) {
      if (path.resolve(source) === top) return true;
      if (isLeftOut(path.basename(source))) return false;
      if (!fs.lstatSync(source).isSymbolicLink()) return true;
      // `existsSync` follows the link, so it is false for one that no longer
      // resolves.
      if (!fs.existsSync(source)) return false;
      const target = fs.realpathSync(source);
      if (!isInside(root, target)) return false;
      return (
        !path.relative(root, target).split(path.sep).some(isLeftOut) &&
        !leadsBackIntoCopy(top, source, target)
      );
    },
  });
}

function isLeftOut(name: string): boolean {
  return name === ".git" || name === "node_modules";
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
