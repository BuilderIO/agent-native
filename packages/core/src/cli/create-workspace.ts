/**
 * `agent-native create-workspace <name>` — scaffolds an enterprise monorepo
 * containing a private workspace core package and one sample app.
 *
 * The layout mirrors what the three-layer inheritance model expects:
 *
 *   <name>/
 *     package.json                           (has agent-native.workspaceCore)
 *     pnpm-workspace.yaml                    (declares packages/* and apps/*)
 *     .env.example                           (shared env template)
 *     tsconfig.base.json                     (app tsconfigs extend this)
 *     packages/
 *       core-module/                         (the private mid-layer)
 *     apps/
 *       example/                             (minimal sample app)
 *
 * After scaffolding, running `agent-native create <name>` from inside the
 * workspace will detect the context and drop the new app under `apps/<name>`
 * with an automatic `workspace:*` dep on the core module.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CreateWorkspaceOptions {
  /** Workspace root directory name. Must be a valid lowercase package name. */
  name?: string;
  /** Don't run `pnpm install` at the end (useful for tests). */
  noInstall?: boolean;
  /** Override the example app name. Defaults to "example". */
  exampleAppName?: string;
}

/**
 * Run the workspace scaffolder. Prompts for a name if not given.
 */
export async function createWorkspace(
  opts: CreateWorkspaceOptions = {},
): Promise<void> {
  const clack = await import("@clack/prompts");
  clack.intro("Create a new agent-native workspace");

  let name = opts.name;
  if (!name) {
    const nameResult = await clack.text({
      message: "What is your workspace name?",
      placeholder: "my-company-platform",
      validate(value) {
        if (!value) return "Workspace name is required";
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
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      clack.cancel(
        `Invalid workspace name "${name}". Use lowercase letters, numbers, and hyphens.`,
      );
      process.exit(1);
    }
    if (fs.existsSync(path.resolve(process.cwd(), name))) {
      clack.cancel(`Directory "${name}" already exists.`);
      process.exit(1);
    }
  }

  const targetDir = path.resolve(process.cwd(), name);
  const exampleAppName = opts.exampleAppName ?? "example";
  const title = titleCase(name);
  const exampleTitle = titleCase(exampleAppName);

  const s = clack.spinner();
  s.start("Scaffolding workspace...");

  try {
    const packageRoot = path.resolve(__dirname, "../..");
    const rootTemplate = path.join(packageRoot, "src/templates/workspace-root");
    const coreTemplate = path.join(packageRoot, "src/templates/workspace-core");
    const appTemplate = path.join(packageRoot, "src/templates/workspace-app");

    // 1) Scaffold the monorepo root.
    copyDir(rootTemplate, targetDir);
    replacePlaceholders(targetDir, name, title);
    renameGitignore(targetDir);

    // 2) Scaffold packages/core-module/.
    const corePackageDir = path.join(targetDir, "packages", "core-module");
    fs.mkdirSync(path.join(targetDir, "packages"), { recursive: true });
    copyDir(coreTemplate, corePackageDir);
    replacePlaceholders(corePackageDir, name, title);

    // 3) Scaffold apps/<exampleAppName>/.
    const appDir = path.join(targetDir, "apps", exampleAppName);
    fs.mkdirSync(path.join(targetDir, "apps"), { recursive: true });
    copyDir(appTemplate, appDir);
    replaceAppPlaceholders(appDir, exampleAppName, exampleTitle, name);
    renameGitignore(appDir);

    // 4) Fix the example app's package.json name field.
    const appPkgPath = path.join(appDir, "package.json");
    if (fs.existsSync(appPkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(appPkgPath, "utf-8"));
      pkg.name = exampleAppName;
      fs.writeFileSync(appPkgPath, JSON.stringify(pkg, null, 2) + "\n");
    }

    s.stop("Workspace scaffolded.");
  } catch (err) {
    s.stop("Failed to scaffold workspace.");
    throw err;
  }

  const nextSteps = [
    `cd ${name}`,
    "cp .env.example .env   # fill in DATABASE_URL, BETTER_AUTH_SECRET, ANTHROPIC_API_KEY",
    "pnpm install",
    `pnpm --filter ${exampleAppName} dev`,
  ];
  clack.outro(
    `Done! Next steps:\n\n  ${nextSteps.join("\n  ")}\n\nAdd another app with:\n  cd ${name}/apps && pnpm exec agent-native create my-app`,
  );
}

// ── helpers ─────────────────────────────────────────────────────────────

function titleCase(name: string): string {
  return name
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Replace {{APP_NAME}} and {{APP_TITLE}} in every text file under `dir`.
 * Used for the workspace root and the core-module scaffold, where those
 * placeholders refer to the WORKSPACE (not the individual app).
 */
function replacePlaceholders(
  dir: string,
  appName: string,
  appTitle: string,
): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      replacePlaceholders(p, appName, appTitle);
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(p, "utf-8");
    } catch {
      continue;
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

/**
 * Replace {{APP_NAME}}, {{APP_TITLE}}, and {{WORKSPACE_NAME}} in every text
 * file under `dir`. The extra slot is used by the workspace-app scaffold so
 * its files can point at the parent workspace's core-module package
 * (`@<workspace>/core-module`) without the regular APP_NAME substitution
 * clobbering the workspace reference.
 */
function replaceAppPlaceholders(
  dir: string,
  appName: string,
  appTitle: string,
  workspaceName: string,
): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      replaceAppPlaceholders(p, appName, appTitle, workspaceName);
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(p, "utf-8");
    } catch {
      continue;
    }
    if (
      !content.includes("{{APP_NAME}}") &&
      !content.includes("{{APP_TITLE}}") &&
      !content.includes("{{WORKSPACE_NAME}}")
    ) {
      continue;
    }
    fs.writeFileSync(
      p,
      content
        .replace(/\{\{WORKSPACE_NAME\}\}/g, workspaceName)
        .replace(/\{\{APP_NAME\}\}/g, appName)
        .replace(/\{\{APP_TITLE\}\}/g, appTitle),
    );
  }
}

function renameGitignore(dir: string): void {
  const src = path.join(dir, "_gitignore");
  const dst = path.join(dir, ".gitignore");
  if (fs.existsSync(src)) fs.renameSync(src, dst);
}

function copyDir(src: string, dest: string, root?: string): void {
  const resolvedRoot = root ?? path.resolve(src);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(srcPath);
      const resolvedTarget = path.resolve(path.dirname(srcPath), target);
      if (resolvedTarget.startsWith(resolvedRoot)) {
        fs.symlinkSync(target, destPath);
      } else if (fs.statSync(srcPath).isDirectory()) {
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
