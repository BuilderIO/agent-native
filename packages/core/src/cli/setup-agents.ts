import fs from "fs";
import path from "path";

/**
 * Symlink definitions for agent tool discovery.
 * Each entry maps a symlink path (relative to the project root) to its target.
 */
const FILE_SYMLINKS: Array<{ link: string; target: string }> = [
  { link: "CLAUDE.md", target: "AGENTS.md" },
  { link: ".cursorrules", target: "AGENTS.md" },
  { link: ".windsurfrules", target: "AGENTS.md" },
];

const DIR_SYMLINKS: Array<{ link: string; target: string }> = [
  { link: ".claude/skills", target: "../.agents/skills" },
];

/**
 * Create symlinks for all supported agent tools (Claude, Cursor, Windsurf, etc.).
 * Idempotent — skips existing correct symlinks and user-customized files.
 */
export function setupAgentSymlinks(targetDir: string): void {
  // File symlinks (CLAUDE.md, .cursorrules, .windsurfrules → AGENTS.md)
  for (const { link, target } of FILE_SYMLINKS) {
    const linkPath = path.join(targetDir, link);
    const targetPath = path.join(targetDir, target);

    // Skip if the target doesn't exist
    if (!fs.existsSync(targetPath)) continue;

    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        const existing = fs.readlinkSync(linkPath);
        if (existing === target) continue; // Already correct
        // Wrong target — remove and recreate
        fs.unlinkSync(linkPath);
      } else {
        // Real file exists — don't overwrite user customizations
        continue;
      }
    } catch {
      // lstatSync threw ENOENT — file doesn't exist, proceed to create
    }

    try {
      fs.symlinkSync(target, linkPath);
    } catch {
      // On Windows or restricted environments, copy instead
      try {
        fs.copyFileSync(targetPath, linkPath);
      } catch {
        // Skip silently if copy also fails
      }
    }
  }

  // Directory symlinks (.claude/skills → ../.agents/skills)
  for (const { link, target } of DIR_SYMLINKS) {
    const linkPath = path.join(targetDir, link);
    const parentDir = path.dirname(linkPath);
    const absTarget = path.resolve(parentDir, target);

    // Skip if the target directory doesn't exist
    if (!fs.existsSync(absTarget)) continue;

    // Ensure parent directory exists
    fs.mkdirSync(parentDir, { recursive: true });

    if (fs.existsSync(linkPath)) {
      try {
        const stat = fs.lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
          const existing = fs.readlinkSync(linkPath);
          if (existing === target) continue; // Already correct
        } else {
          continue; // Real directory — don't overwrite
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

/**
 * CLI entry point for `agent-native setup-agents`.
 * Runs in the current working directory.
 */
export function runSetupAgents(): void {
  const dir = process.cwd();
  if (!fs.existsSync(path.join(dir, "AGENTS.md"))) {
    console.log("No AGENTS.md found in current directory. Skipping.");
    return;
  }
  setupAgentSymlinks(dir);
  console.log("Agent tool symlinks configured.");
}
