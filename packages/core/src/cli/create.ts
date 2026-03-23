import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Scaffold a new agent-native app from the default template.
 */
export function createApp(name?: string): void {
  if (!name) {
    console.error("Usage: agent-native create <app-name>");
    process.exit(1);
  }

  // Validate name
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(
      `Invalid app name "${name}". Use lowercase letters, numbers, and hyphens.`,
    );
    process.exit(1);
  }

  const targetDir = path.resolve(process.cwd(), name);

  if (fs.existsSync(targetDir)) {
    console.error(`Directory "${name}" already exists.`);
    process.exit(1);
  }

  // Locate the template directory
  // In dist: dist/cli/create.js -> ../../src/templates/default
  // Resolve relative to the package root
  const packageRoot = path.resolve(__dirname, "../..");
  const templateDir = path.join(packageRoot, "src/templates/default");

  if (!fs.existsSync(templateDir)) {
    console.error(
      `Template directory not found at ${templateDir}. Is the package installed correctly?`,
    );
    process.exit(1);
  }

  console.log(`Creating ${name}...`);

  // Copy template
  copyDir(templateDir, targetDir);

  // Replace {{APP_NAME}} and {{APP_TITLE}} placeholders in all text files.
  // Previously this was done per-file (package.json, index.html, AGENTS.md),
  // but index.html no longer exists in the React Router framework template and
  // route files like app/routes/_index.tsx also contain {{APP_TITLE}}.
  // A single recursive pass is simpler and future-proof.
  const appTitle = name
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  replacePlaceholders(targetDir, name, appTitle);

  // Copy defaults files (gitignored files that get seeded from .defaults on first create)
  for (const base of ["learnings"]) {
    const defaultsFile = path.join(targetDir, `${base}.defaults.md`);
    const targetFile = path.join(targetDir, `${base}.md`);
    if (fs.existsSync(defaultsFile) && !fs.existsSync(targetFile)) {
      fs.copyFileSync(defaultsFile, targetFile);
    }
  }

  // Rename gitignore (npm strips .gitignore from packages)
  const gitignoreSrc = path.join(targetDir, "_gitignore");
  const gitignoreDst = path.join(targetDir, ".gitignore");
  if (fs.existsSync(gitignoreSrc)) {
    fs.renameSync(gitignoreSrc, gitignoreDst);
  }

  // Ensure .claude/skills -> .agents/skills symlink exists for Claude Code discovery.
  // The template includes this symlink tracked in git, but recreate it as a safety net
  // (e.g. if git didn't preserve the symlink on Windows).
  const agentsSkills = path.join(targetDir, ".agents", "skills");
  const claudeDir = path.join(targetDir, ".claude");
  const claudeSkills = path.join(claudeDir, "skills");
  if (fs.existsSync(agentsSkills) && !fs.existsSync(claudeSkills)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    const rel = path.relative(claudeDir, agentsSkills);
    const type = process.platform === "win32" ? "junction" : "dir";
    try {
      fs.symlinkSync(rel, claudeSkills, type);
    } catch {
      copyDir(agentsSkills, claudeSkills);
    }
  }

  console.log(`\nDone! Created ${name} at ${targetDir}\n`);
  console.log(`Next steps:`);
  console.log(`  cd ${name}`);
  console.log(`  pnpm install`);
  console.log(
    `  pnpm dev          # Start dev server at http://localhost:8080`,
  );
  console.log(`  pnpm build        # Build for production`);
  console.log(`  pnpm start        # Start production server`);
  console.log(``);
  console.log(`Your app includes agent skills in .agents/skills/.`);
  console.log(
    `These teach the AI agent how to work within the framework's architecture.`,
  );
  console.log(``);
  console.log(
    `Need multi-user collaboration? See: https://agent-native.dev/docs/file-sync`,
  );
}

/**
 * Recursively replace {{APP_NAME}} and {{APP_TITLE}} placeholders in all
 * text files under `dir`. Binary files are skipped silently.
 */
function replacePlaceholders(
  dir: string,
  appName: string,
  appTitle: string,
): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink() || entry.isDirectory()) {
      if (!entry.isSymbolicLink()) replacePlaceholders(p, appName, appTitle);
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(p, "utf-8");
    } catch {
      continue; // skip unreadable / binary files
    }
    if (
      !content.includes("{{APP_NAME}}") &&
      !content.includes("{{APP_TITLE}}")
    ) {
      continue;
    }
    fs.writeFileSync(
      p,
      content
        .replace(/\{\{APP_NAME\}\}/g, appName)
        .replace(/\{\{APP_TITLE\}\}/g, appTitle),
    );
  }
}

function copyDir(src: string, dest: string, root?: string): void {
  const resolvedRoot = root ?? path.resolve(src);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(srcPath);
      // Resolve one level (path math only, no disk follow) to check
      // whether the symlink stays inside the template tree.
      const resolvedTarget = path.resolve(path.dirname(srcPath), target);
      if (resolvedTarget.startsWith(resolvedRoot)) {
        // Internal symlink (e.g. .claude/skills -> ../.agents/skills) — preserve it
        fs.symlinkSync(target, destPath);
      } else if (fs.statSync(srcPath).isDirectory()) {
        // External symlink to directory — dereference and copy contents
        copyDir(srcPath, destPath, resolvedRoot);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    } else if (entry.isDirectory()) {
      copyDir(srcPath, destPath, resolvedRoot);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
