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
 * throws before `to` is touched, rather than install nothing. It also throws
 * when the skill folder and `to` overlap, as when a project's own skills
 * folder is the source, since replacing `to` would delete the skill.
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
  const real = resolveLink(from);
  if (real === undefined) {
    throw new Error(`Skill folder not found: ${from}`);
  }
  if (!isInside(root, real)) {
    throw new Error(`Skill folder ${from} links outside its source: ${real}`);
  }
  const landing = landingPath(to);
  if (isInside(real, landing) || isInside(landing, real)) {
    throw new Error(
      `Skill folder ${from} and its install folder ${to} overlap, so installing would delete it`,
    );
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
      const target = resolveLink(source);
      if (target === undefined || !isInside(root, target)) return false;
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

// The real path a link leads to, or `undefined` when it leads nowhere: its
// target is gone, or links loop. Any other error, such as a target this user
// can't read, is thrown rather than leave the install quietly incomplete.
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
