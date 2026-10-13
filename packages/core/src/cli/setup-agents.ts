import fs from "fs";
import path from "path";

const FILE_SYMLINKS: Array<{ link: string; target: string }> = [
  { link: "CLAUDE.md", target: "AGENTS.md" },
];

const DIR_SYMLINKS: Array<{ link: string; target: string }> = [
  { link: ".claude/skills", target: "../.agents/skills" },
];

export function setupAgentSymlinks(targetDir: string): void {
  for (const { link, target } of FILE_SYMLINKS) {
    const linkPath = path.join(targetDir, link);
    const targetPath = path.join(targetDir, target);

    if (!fs.existsSync(targetPath)) continue;

    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        const existing = fs.readlinkSync(linkPath);
        if (existing === target) continue;
        fs.unlinkSync(linkPath);
      } else {
        continue;
      }
    } catch {
      // lstatSync threw ENOENT — file doesn't exist, proceed to create
    }

    try {
      fs.symlinkSync(target, linkPath);
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

    if (fs.existsSync(linkPath)) {
      try {
        const stat = fs.lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
          const existing = fs.readlinkSync(linkPath);
          if (existing === target) continue;
        } else {
          continue;
        }
      } catch {
        // Proceed to create
      }
    }

    const type = process.platform === "win32" ? "junction" : "dir";
    try {
      fs.symlinkSync(target, linkPath, type);
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
