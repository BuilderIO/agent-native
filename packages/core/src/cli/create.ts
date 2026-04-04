import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { setupAgentSymlinks } from "./setup-agents.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO = "BuilderIO/agent-native";
const TEMPLATES_DIR = "templates";

/**
 * Template definitions with descriptions for the interactive picker.
 */
const TEMPLATES = [
  {
    value: "blank",
    label: "Blank",
    hint: "Empty starter — build from scratch",
  },
  {
    value: "mail",
    label: "Mail",
    hint: "AI-native Superhuman — email client with keyboard shortcuts and AI triage",
  },
  {
    value: "calendar",
    label: "Calendar",
    hint: "AI-native Google Calendar — manage events, sync, and public booking",
  },
  {
    value: "content",
    label: "Content",
    hint: "AI-native Notion/Google Docs — write and organize with agent assistance",
  },
  {
    value: "slides",
    label: "Slides",
    hint: "AI-native Google Slides — generate and edit React presentations",
  },
  {
    value: "videos",
    label: "Video",
    hint: "AI-native video editing with Remotion",
  },
  {
    value: "analytics",
    label: "Analytics",
    hint: "AI-native Amplitude/Mixpanel — connect data sources, prompt for charts",
  },
  {
    value: "forms",
    label: "Forms",
    hint: "AI-native form builder — create, edit, and manage forms",
  },
  {
    value: "issues",
    label: "Issues",
    hint: "AI-native Jira — project management and issue tracking",
  },
  {
    value: "recruiting",
    label: "Recruiting",
    hint: "AI-native Greenhouse — manage candidates and recruiting pipelines",
  },
] as const;

/**
 * Known first-party template names (for validation).
 * Includes aliases like "video" → "videos" and "starter" for backwards compat.
 */
const KNOWN_TEMPLATES = [
  ...TEMPLATES.map((t) => t.value).filter((v) => v !== "blank"),
  "video",
  "starter",
];

/**
 * Scaffold a new agent-native app.
 *
 * Interactive mode: prompts for app name and template if not provided.
 * With --template <name>: downloads the template from GitHub.
 * With --template github:user/repo: downloads from a custom GitHub repo.
 */
export async function createApp(
  name?: string,
  opts?: { template?: string },
): Promise<void> {
  const clack = await import("@clack/prompts");

  clack.intro("Create a new agent-native app");

  // Prompt for name if not provided
  if (!name) {
    const nameResult = await clack.text({
      message: "What is your app name?",
      placeholder: "my-app",
      validate(value) {
        if (!value) return "App name is required";
        if (!/^[a-z][a-z0-9-]*$/.test(value)) {
          return "Use lowercase letters, numbers, and hyphens (must start with a letter)";
        }
        if (fs.existsSync(path.resolve(process.cwd(), value))) {
          return `Directory "${value}" already exists`;
        }
      },
    });
    if (clack.isCancel(nameResult)) {
      clack.cancel("Cancelled.");
      process.exit(0);
    }
    name = nameResult;
  } else {
    // Validate provided name
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      clack.cancel(
        `Invalid app name "${name}". Use lowercase letters, numbers, and hyphens.`,
      );
      process.exit(1);
    }
  }

  const targetDir = path.resolve(process.cwd(), name);

  if (fs.existsSync(targetDir)) {
    clack.cancel(`Directory "${name}" already exists.`);
    process.exit(1);
  }

  // Prompt for template if not provided
  let template = opts?.template;
  if (!template) {
    const templateResult = await clack.select({
      message: "Which template would you like to use?",
      options: TEMPLATES.map((t) => ({
        value: t.value,
        label: t.label,
        hint: t.hint,
      })),
    });
    if (clack.isCancel(templateResult)) {
      clack.cancel("Cancelled.");
      process.exit(0);
    }
    template = templateResult as string;
  }

  const s = clack.spinner();
  s.start("Scaffolding your app...");

  try {
    if (template === "blank") {
      createFromDefault(name, targetDir);
    } else {
      await createFromTemplate(name, targetDir, template);
    }
    s.stop("App created!");
  } catch (err) {
    s.stop("Failed to create app.");
    throw err;
  }

  clack.outro(`Done! Next steps:\n\n  cd ${name}\n  pnpm install\n  pnpm dev`);
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
    await downloadGitHubRepo(repo, targetDir);
  } else if (KNOWN_TEMPLATES.includes(resolvedTemplate)) {
    // First-party template from monorepo
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
 * Validate a GitHub repo string (user/repo) to prevent injection.
 */
function validateRepoName(repo: string): void {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
    console.error(
      `Invalid repository name "${repo}". Expected format: user/repo`,
    );
    process.exit(1);
  }
}

/**
 * Download a tarball from a URL and extract it to a directory.
 * Uses execFileSync with array args to avoid shell injection.
 */
function downloadAndExtract(url: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  // Download with curl (no shell — execFileSync passes args directly)
  const tarball = execFileSync("curl", ["-sL", url], {
    maxBuffer: 100 * 1024 * 1024,
  });
  // Write tarball to a temp file, then extract (avoids pipe through shell)
  const tarPath = path.join(destDir, ".download.tar.gz");
  fs.writeFileSync(tarPath, tarball);
  try {
    execFileSync(
      "tar",
      ["xzf", tarPath, "--strip-components=1", "-C", destDir],
      {
        stdio: "pipe",
      },
    );
  } finally {
    fs.unlinkSync(tarPath);
  }
}

/**
 * Download a subdirectory from a GitHub repo using the tarball API.
 */
async function downloadGitHubSubdir(
  repo: string,
  subdir: string,
  targetDir: string,
): Promise<void> {
  validateRepoName(repo);
  const tarUrl = `https://api.github.com/repos/${repo}/tarball/main`;

  // Download and extract into a temp dir, then copy the subdir
  const tmpDir = path.join(targetDir, "..", `.agent-native-tmp-${Date.now()}`);

  try {
    downloadAndExtract(tarUrl, tmpDir);

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
  validateRepoName(repo);
  const tarUrl = `https://api.github.com/repos/${repo}/tarball/main`;

  try {
    downloadAndExtract(tarUrl, targetDir);
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
