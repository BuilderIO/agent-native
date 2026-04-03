import fs from "fs";
import https from "https";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { setupAgentSymlinks } from "./setup-agents.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GITHUB_REPO = "BuilderIO/agent-native";

// Static fallback used only when the GitHub Contents API is unreachable.
const FALLBACK_TEMPLATES = [
  "analytics",
  "calendar",
  "content",
  "forms",
  "issues",
  "mail",
  "recruiting",
  "slides",
  "starter",
  "videos",
];

/**
 * Fetch the list of available templates from the GitHub Contents API.
 * Tries the versioned tag first, then falls back to main.
 * Returns FALLBACK_TEMPLATES if the API is unreachable.
 */
async function fetchAvailableTemplates(version: string): Promise<string[]> {
  const refs = [`v${version}`, "main"];
  for (const ref of refs) {
    try {
      const data = (await fetchJson(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/templates?ref=${ref}`,
      )) as Array<{ type: string; name: string }>;
      const templates = data.filter((e) => e.type === "dir").map((e) => e.name);
      if (templates.length > 0) return templates;
    } catch {
      // try next ref
    }
  }
  return FALLBACK_TEMPLATES;
}

/**
 * Scaffold a new agent-native app from a template.
 * Defaults to the bundled "default" template; other templates are downloaded
 * from the GitHub repository tarball on demand.
 */
export async function createApp(
  name?: string,
  template = "default",
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

  // Resolve package root (dist/cli/create.js -> ../../)
  const packageRoot = path.resolve(__dirname, "../..");

  // Read the installed version — used for the GitHub tarball URL and workspace dep rewriting
  let version = "unknown";
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(packageRoot, "package.json"), "utf-8"),
    );
    version = pkg.version;
  } catch {
    // proceed with fallback to main
  }

  if (template === "default") {
    // Use the bundled default template
    const templateDir = path.join(packageRoot, "src/templates/default");

    if (!fs.existsSync(templateDir)) {
      console.error(
        `Template directory not found at ${templateDir}. Is the package installed correctly?`,
      );
      process.exit(1);
    }

    console.log(`Creating ${name}...`);
    copyDir(templateDir, targetDir);
  } else {
    // Download the requested template from GitHub
    const availableTemplates = await fetchAvailableTemplates(version);
    if (!availableTemplates.includes(template)) {
      console.error(
        `Unknown template "${template}". Available templates: ${availableTemplates.join(", ")}`,
      );
      process.exit(1);
    }

    console.log(`Creating ${name} from "${template}" template...`);
    await downloadAndExtractTemplate(
      template,
      version,
      targetDir,
      availableTemplates,
    );
  }

  // Rewrite workspace:* protocol references so the project installs outside the monorepo
  await rewriteWorkspaceDeps(targetDir);

  // Replace {{APP_NAME}} and {{APP_TITLE}} placeholders in all text files
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
 * Download the GitHub source tarball for the given version (falling back to
 * main), extract it to a temp directory, and copy the template subdirectory
 * into targetDir.
 */
async function downloadAndExtractTemplate(
  template: string,
  version: string,
  targetDir: string,
  availableTemplates: string[],
): Promise<void> {
  const urls = [
    `https://codeload.github.com/${GITHUB_REPO}/tar.gz/refs/tags/v${version}`,
    `https://codeload.github.com/${GITHUB_REPO}/tar.gz/refs/heads/main`,
  ];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-"));
  const tarPath = path.join(tmpDir, "repo.tar.gz");
  const extractDir = path.join(tmpDir, "extract");
  fs.mkdirSync(extractDir);

  try {
    // Attempt download — try versioned tag first, then main
    let downloaded = false;
    for (const url of urls) {
      try {
        console.log(`Downloading from ${url}...`);
        await downloadFile(url, tarPath);
        downloaded = true;
        break;
      } catch {
        // try next URL
      }
    }

    if (!downloaded) {
      console.error(
        "Failed to download template tarball from GitHub. Check your internet connection.",
      );
      process.exit(1);
    }

    // Extract the full tarball
    execSync(`tar -xzf "${tarPath}" -C "${extractDir}"`, { stdio: "pipe" });

    // The tarball root is BuilderIO-agent-native-<sha>/ — find it
    const [repoDir] = fs.readdirSync(extractDir);
    if (!repoDir) {
      console.error("Tarball appears empty.");
      process.exit(1);
    }

    const templateSrc = path.join(extractDir, repoDir, "templates", template);
    if (!fs.existsSync(templateSrc)) {
      console.error(
        `Template "${template}" was not found in the repository. Available templates: ${availableTemplates.join(", ")}`,
      );
      process.exit(1);
    }

    copyDir(templateSrc, targetDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Fetch a URL and parse the response body as JSON.
 */
function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "agent-native-cli",
            Accept: "application/vnd.github+json",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`Invalid JSON from ${url}`));
            }
          });
        },
      )
      .on("error", reject);
  });
}

/**
 * Download a URL to a local file path, following redirects.
 */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    function get(u: string): void {
      https
        .get(u, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const location = res.headers.location;
            if (!location) {
              reject(new Error("Redirect with no Location header"));
              return;
            }
            get(location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${u}`));
            return;
          }
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve()));
        })
        .on("error", reject);
    }

    get(url);
  });
}

/**
 * Rewrite workspace:* protocol references in package.json to real semver ranges
 * so the scaffolded project can be installed outside the monorepo.
 * Queries the npm registry for the actual latest published version of each package.
 */
async function rewriteWorkspaceDeps(dir: string): Promise<void> {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    return;
  }

  // Collect unique package names that need resolving
  const workspacePkgs = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const section = pkg[field] as Record<string, string> | undefined;
    if (!section) continue;
    for (const [name, val] of Object.entries(section)) {
      if (val === "workspace:*") workspacePkgs.add(name);
    }
  }
  if (workspacePkgs.size === 0) return;

  // Resolve each package's latest published version from npm
  const resolved = new Map<string, string>();
  await Promise.all(
    [...workspacePkgs].map(async (name) => {
      const ver = await fetchLatestNpmVersion(name);
      resolved.set(name, ver ? `^${ver}` : "*");
    }),
  );

  let changed = false;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const section = pkg[field] as Record<string, string> | undefined;
    if (!section) continue;
    for (const [name, val] of Object.entries(section)) {
      if (val === "workspace:*") {
        section[name] = resolved.get(name)!;
        changed = true;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }
}

/**
 * Fetch all dist-tags for a package and return the version with the highest
 * major.minor.patch, regardless of prerelease suffix. This ensures dev/next
 * tags are preferred over an older stable release when they represent newer work.
 * Returns null on any failure.
 */
function fetchLatestNpmVersion(pkgName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const encoded = pkgName.replace(/\//g, "%2F");
    https
      .get(
        `https://registry.npmjs.org/-/package/${encoded}/dist-tags`,
        { headers: { Accept: "application/json" } },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const tags: Record<string, string> = JSON.parse(data);
              const versions = Object.values(tags);
              if (!versions.length) return resolve(null);
              // Pick the version with the highest major.minor.patch
              versions.sort((a, b) => {
                const [aMaj, aMin, aPat] = a
                  .split("-")[0]
                  .split(".")
                  .map(Number);
                const [bMaj, bMin, bPat] = b
                  .split("-")[0]
                  .split(".")
                  .map(Number);
                return bMaj - aMaj || bMin - aMin || bPat - aPat;
              });
              resolve(versions[0]);
            } catch {
              resolve(null);
            }
          });
        },
      )
      .on("error", () => resolve(null));
  });
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
