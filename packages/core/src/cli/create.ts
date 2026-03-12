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

  console.log(`\nDone! Created ${name} at ${targetDir}\n`);
  console.log(`Next steps:`);
  console.log(`  cd ${name}`);
  console.log(`  pnpm install`);
  console.log(`  pnpm dev`);
  console.log(``);
  console.log(`Your app will be running at http://localhost:8080`);
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
