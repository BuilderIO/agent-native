import fs from "fs";
import path from "path";

const FILE_SYMLINKS: Array<{ link: string; target: string }> = [
  { link: "CLAUDE.md", target: "AGENTS.md" },
];

const DIR_SYMLINKS: Array<{ link: string; target: string }> = [
  { link: ".claude/skills", target: "../.agents/skills" },
];

type SymlinkState = "create" | "matches" | "occupied";

export function prepareAgentSymlink(
  linkPath: string,
  target: string,
  type: "file" | "dir",
): SymlinkState {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "create";
    throw error;
  }
  if (!stat.isSymbolicLink()) return "occupied";

  let existingTarget: string;
  try {
    existingTarget = fs.readlinkSync(linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "create";
    throw error;
  }
  const resolvedExistingTarget = path.resolve(
    path.dirname(linkPath),
    existingTarget,
  );
  const resolvedTarget = path.resolve(path.dirname(linkPath), target);
  const sameTarget =
    process.platform === "win32"
      ? resolvedExistingTarget.toLowerCase() === resolvedTarget.toLowerCase()
      : resolvedExistingTarget === resolvedTarget;
  if (sameTarget) {
    return "matches";
  }

  try {
    if (process.platform === "win32" && type === "dir") {
      fs.rmdirSync(linkPath);
    } else {
      fs.unlinkSync(linkPath);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code !== "ENOENT" &&
      code !== "EPERM" &&
      code !== "EACCES" &&
      code !== "EBUSY"
    ) {
      throw error;
    }
    // Let the caller try link creation so its existing copy fallback can run.
  }
  return "create";
}

export function createAgentSymlink(
  target: string,
  linkPath: string,
  type: "file" | "dir",
): void {
  if (process.platform !== "win32" || type === "file") {
    fs.symlinkSync(target, linkPath, type);
    return;
  }

  try {
    fs.symlinkSync(target, linkPath, "dir");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES") throw error;
    fs.symlinkSync(
      path.resolve(path.dirname(linkPath), target),
      linkPath,
      "junction",
    );
  }
}

export function rebaseAgentSymlinkTarget(
  sourceRoot: string,
  destinationRoot: string,
  sourceLinkPath: string,
  destinationLinkPath: string,
  target: string,
): string | undefined {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const resolvedTarget = path.resolve(path.dirname(sourceLinkPath), target);
  const targetWithinRoot = path.relative(resolvedSourceRoot, resolvedTarget);
  if (
    targetWithinRoot === ".." ||
    targetWithinRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(targetWithinRoot)
  ) {
    return undefined;
  }

  const copiedTargetPath = path.resolve(destinationRoot, targetWithinRoot);
  return (
    path.relative(path.dirname(destinationLinkPath), copiedTargetPath) || "."
  );
}

export function setupAgentSymlinks(targetDir: string): void {
  for (const { link, target } of FILE_SYMLINKS) {
    const linkPath = path.join(targetDir, link);
    const targetPath = path.join(targetDir, target);

    if (!fs.existsSync(targetPath)) continue;

    const state = prepareAgentSymlink(linkPath, target, "file");
    if (state !== "create") continue;

    try {
      createAgentSymlink(target, linkPath, "file");
    } catch {
      try {
        fs.copyFileSync(targetPath, linkPath);
      } catch {
        // Skip silently if copy also fails
      }
    }
  }

  for (const { link, target } of DIR_SYMLINKS) {
    const linkPath = path.join(targetDir, link);
    const parentDir = path.dirname(linkPath);
    const absTarget = path.resolve(parentDir, target);

    if (!fs.existsSync(absTarget)) continue;

    fs.mkdirSync(parentDir, { recursive: true });

    const state = prepareAgentSymlink(linkPath, target, "dir");
    if (state !== "create") continue;

    try {
      createAgentSymlink(target, linkPath, "dir");
    } catch {
      try {
        copyDir(absTarget, linkPath);
      } catch {
        // Skip silently
      }
    }
  }
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

export function runSetupAgents(): void {
  const dir = process.cwd();
  if (!fs.existsSync(path.join(dir, "AGENTS.md"))) {
    console.log("No AGENTS.md found in current directory. Skipping.");
    return;
  }
  setupAgentSymlinks(dir);
  console.log("Agent tool symlinks configured.");
}
