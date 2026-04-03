import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { setupAgentSymlinks } from "./setup-agents.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO = "BuilderIO/agent-native";
const TEMPLATES_DIR = "templates";

/**
 * Known first-party templates hosted in the agent-native monorepo.
 */
const KNOWN_TEMPLATES = [
  "analytics",
  "calendar",
  "content",
  "forms",
  "issues",
  "mail",
  "recruiting",
  "slides",
  "starter",
  "video",
  "videos",
];

/**
 * Scaffold a new agent-native app.
 *
 * Without --template: uses the bundled default template.
 * With --template <name>: downloads the template from GitHub.
 * With --template github:user/repo: downloads from a custom GitHub repo.
 */
export async function createApp(
  name?: string,
  opts?: { template?: string },
): Promise<void> {
  if (!name) {
    console.error("Usage: agent-native create <app-name> [--template <name>]");
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

  const template = opts?.template;

  if (template) {
    await createFromTemplate(name, targetDir, template);
  } else {
    createFromDefault(name, targetDir);
  }
}

/**
 * Create from the bundled default template (no --template flag).
 */
function createFromDefault(name: string, targetDir: string): void {
  const packageRoot = path.resolve(__dirname, "../..");
  const templateDir = path.join(packageRoot, "src/templates/default");

  if (!fs.existsSync(templateDir)) {
    console.error(
      `Template directory not found at ${templateDir}. Is the package installed correctly?`,
    );
    process.exit(1);
  }

  console.log(`Creating ${name}...`);
  copyDir(templateDir, targetDir);
  postProcess(name, targetDir);
}

/**
 * Create from a named template or GitHub repo.
 *
 * Supports:
 *   --template mail           (first-party template from BuilderIO/agent-native)
 *   --template github:user/repo  (community template from a GitHub repo)
 */
async function createFromTemplate(
  name: string,
  targetDir: string,
  template: string,
): Promise<void> {
  // Normalize "video" → "videos" (docs use singular, dir is plural)
  let resolvedTemplate = template;
  if (resolvedTemplate === "video") resolvedTemplate = "videos";

  if (resolvedTemplate.startsWith("github:")) {
    // Community template: github:user/repo
    const repo = resolvedTemplate.slice("github:".length);
    console.log(`Creating ${name} from ${repo}...`);
    await downloadGitHubRepo(repo, targetDir);
  } else if (KNOWN_TEMPLATES.includes(resolvedTemplate)) {
    // First-party template from monorepo
    console.log(`Creating ${name} from template "${resolvedTemplate}"...`);
    await downloadGitHubSubdir(
      REPO,
      `${TEMPLATES_DIR}/${resolvedTemplate}`,
      targetDir,
    );
  } else {
    console.error(
      `Unknown template "${template}". Available templates: ${KNOWN_TEMPLATES.filter((t) => t !== "videos").join(", ")}`,
    );
    console.error(`For community templates, use: --template github:user/repo`);
    process.exit(1);
  }

  postProcess(name, targetDir);
}

/**
 * Download a subdirectory from a GitHub repo using the tarball API.
 */
async function downloadGitHubSubdir(
  repo: string,
  subdir: string,
  targetDir: string,
): Promise<void> {
  const tarUrl = `https://api.github.com/repos/${repo}/tarball/main`;

  // Download and extract into a temp dir, then copy the subdir
  const tmpDir = path.join(targetDir, "..", `.agent-native-tmp-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Download tarball
    execSync(
      `curl -sL "${tarUrl}" | tar xz --strip-components=1 -C "${tmpDir}"`,
      { stdio: "pipe" },
    );

    const srcDir = path.join(tmpDir, subdir);
    if (!fs.existsSync(srcDir)) {
      console.error(
        `Template directory "${subdir}" not found in ${repo}. Check the template name.`,
      );
      process.exit(1);
    }

    // Copy template to target
    copyDir(srcDir, targetDir);
  } finally {
    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Download an entire GitHub repo (for community templates).
 */
async function downloadGitHubRepo(
  repo: string,
  targetDir: string,
): Promise<void> {
  const tarUrl = `https://api.github.com/repos/${repo}/tarball/main`;

  fs.mkdirSync(targetDir, { recursive: true });

  try {
    execSync(
      `curl -sL "${tarUrl}" | tar xz --strip-components=1 -C "${targetDir}"`,
      { stdio: "pipe" },
    );
  } catch {
    console.error(
      `Failed to download template from ${repo}. Check the repo name and that it's public.`,
    );
    process.exit(1);
  }
}

/**
 * Post-process a scaffolded template: replace placeholders, set up symlinks, etc.
 */
function postProcess(name: string, targetDir: string): void {
  // Replace {{APP_NAME}} and {{APP_TITLE}} placeholders in all text files
  const appTitle = name
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  replacePlaceholders(targetDir, name, appTitle);

  // Update package.json name field (templates have their own name)
  const pkgPath = path.join(targetDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      pkg.name = name;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    } catch {}
  }

  // Copy defaults files
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

  // Remove monorepo-specific files that don't belong in standalone apps
  for (const f of ["DEVELOPING.md"]) {
    const p = path.join(targetDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // Fix package.json: remove workspace: references
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      for (const depType of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
      ] as const) {
        const deps = pkg[depType];
        if (!deps) continue;
        for (const [key, val] of Object.entries(deps)) {
          if (typeof val === "string" && val.startsWith("workspace:")) {
            // Replace workspace:* with "latest"
            deps[key] = "latest";
          }
        }
      }
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    } catch {}
  }

  // Create symlinks for all agent tools (Claude, Cursor, Windsurf, etc.)
  setupAgentSymlinks(targetDir);

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
    `Need multi-user collaboration? See: https://agent-native.com/docs/file-sync`,
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
