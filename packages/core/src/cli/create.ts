import fs from "fs";
import path from "path";
import { execSync } from "child_process";
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

  // Replace placeholders in package.json
  const pkgPath = path.join(targetDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    let content = fs.readFileSync(pkgPath, "utf-8");
    content = content.replace(/\{\{APP_NAME\}\}/g, name);
    fs.writeFileSync(pkgPath, content);
  }

  // Replace placeholders in index.html
  const htmlPath = path.join(targetDir, "index.html");
  if (fs.existsSync(htmlPath)) {
    let content = fs.readFileSync(htmlPath, "utf-8");
    content = content.replace(
      /\{\{APP_TITLE\}\}/g,
      name
        .split("-")
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" "),
    );
    fs.writeFileSync(htmlPath, content);
  }

  // Replace placeholders in AGENTS.md
  const agentsPath = path.join(targetDir, "AGENTS.md");
  if (fs.existsSync(agentsPath)) {
    let content = fs.readFileSync(agentsPath, "utf-8");
    content = content.replace(/\{\{APP_NAME\}\}/g, name);
    fs.writeFileSync(agentsPath, content);
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
  console.log(`  pnpm dev          # Start dev server at http://localhost:8080`);
  console.log(`  pnpm build        # Build for production`);
  console.log(`  pnpm start        # Start production server`);
  console.log(``);
  console.log(`Your app includes agent skills in .agents/skills/.`);
  console.log(`These teach the AI agent how to work within the framework's architecture.`);
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
