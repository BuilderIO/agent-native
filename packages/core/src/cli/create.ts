import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { execFileSync } from "child_process";
import { setupAgentSymlinks } from "./setup-agents.js";
import { workspacifyApp, parseWorkspaceScope } from "./workspacify.js";
import {
  DISPATCH_WORKSPACE_ROOT_REDIRECTS,
  getWorkspaceAppIdValidationError,
} from "../shared/workspace-app-id.js";
import {
  coreTemplates,
  getTemplate,
  allTemplateNames,
  type TemplateMeta,
} from "./templates-meta.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO = "BuilderIO/agent-native";
const TEMPLATES_DIR = "templates";
const POSTGRES_DEPENDENCY_VERSION = "^3.4.9";

/**
 * Move "starter" to the top of the list so it lines up with clack's default
 * highlight on the first option — otherwise users have to scroll to see that
 * Starter is pre-selected.
 */
function starterFirst(templates: TemplateMeta[]): TemplateMeta[] {
  const starter = templates.find((t) => t.name === "starter");
  if (!starter) return templates;
  return [starter, ...templates.filter((t) => t.name !== "starter")];
}

/** Blank scaffold option appended to every picker. */
const BLANK_OPTION = {
  name: "blank",
  label: "Blank",
  hint: "Empty starter — build from scratch",
};

export interface CreateAppOptions {
  /** Pre-select these templates in the picker. Comma-separated string or array. */
  template?: string;
  /** Scaffold a single standalone app (old behavior). Skips workspace creation. */
  standalone?: boolean;
  /** Internal: skip pnpm install at the end (for tests). */
  noInstall?: boolean;
}

/**
 * Main entry for `agent-native create [name]`.
 *
 * Default behavior: scaffold a workspace at <name>/ with a multi-select
 * template picker. Use --standalone for the single-app standalone flow.
 *
 * If run *inside* an existing workspace, falls through to the add-app
 * flow that scaffolds one new app under apps/<name>/.
 */
export async function createApp(
  name?: string,
  opts?: CreateAppOptions,
): Promise<void> {
  const clack = await import("@clack/prompts");

  // If we're already inside a workspace, the meaning of `create <name>` is
  // "add a new app to this workspace". Delegate to add-app.
  const workspace = detectWorkspace(process.cwd());
  if (workspace) {
    await addAppToWorkspace(name, opts);
    return;
  }

  // Standalone escape hatch — behaves like the old single-app flow.
  if (opts?.standalone) {
    await createStandaloneApp(name, opts, clack);
    return;
  }

  // When exactly one template is specified explicitly, treat it as a
  // standalone scaffold (script-friendly, matches historic behavior).
  // Use `--template a,b` or pass no --template to opt into the workspace
  // flow with the multi-select picker.
  const parsed = parseTemplateList(opts?.template);
  if (parsed.length === 1) {
    await createStandaloneApp(name, opts, clack);
    return;
  }

  // Default: create a workspace.
  await createWorkspaceInteractive(name, opts, clack);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Workspace creation (new default)
 * ───────────────────────────────────────────────────────────────────────── */

async function createWorkspaceInteractive(
  name: string | undefined,
  opts: CreateAppOptions | undefined,
  clack: typeof import("@clack/prompts"),
): Promise<void> {
  clack.intro("Create a new agent-native workspace");

  name = await promptNameIfMissing(name, clack, "workspace", "my-platform");

  clack.note(
    [
      "A workspace is a monorepo that holds one or more apps sharing auth,",
      "database, and the agent chat. Pick as many as you want — you can add",
      "more later with `agent-native add-app`. Starter is a minimal scaffold,",
      "useful as a blank app to build from scratch alongside the others.",
    ].join("\n"),
    "About workspaces",
  );

  // If templates were explicitly passed via --template, use them directly.
  // Otherwise show the multi-select picker.
  const preselected = parseTemplateList(opts?.template);
  const templates =
    preselected.length > 0
      ? preselected
      : await promptTemplatePicker(preselected, clack, {
          defaultTemplates: ["starter", "dispatch"],
        });
  if (templates.length === 0) {
    clack.cancel("No apps selected. Cancelled.");
    process.exit(0);
  }

  const targetDir = path.resolve(process.cwd(), name);
  if (fs.existsSync(targetDir)) {
    clack.cancel(`Directory "${name}" already exists.`);
    process.exit(1);
  }

  const s = clack.spinner();
  s.start(`Scaffolding workspace with ${templates.length} app(s)...`);

  const firstApp = templates[0];

  try {
    await scaffoldWorkspaceRoot(targetDir, name);
    const workspaceCoreName = `@${name}/shared`;

    for (const t of templates) {
      const appDir = path.join(targetDir, "apps", t);
      await scaffoldAppTemplate(appDir, t);
      replacePlaceholders(appDir, t, titleCase(t), name);
      rewriteTrackingAppId(appDir, t, t);
      workspacifyApp({
        appDir,
        appName: t,
        templateName: t,
        workspaceRoot: targetDir,
        workspaceCoreName,
        coreDependencyVersion: getCoreDependencyVersion(),
      });
      fixPackageJsonName(appDir, t);
      rewriteNetlifyToml(appDir, t, "workspace");
      renameGitignore(appDir);
      // Each app owns its own .claude / .agents symlinks.
      setupAgentSymlinks(appDir);
    }

    await scaffoldRequiredPackages(templates, targetDir);

    s.stop("Workspace scaffolded.");
  } catch (err: any) {
    s.stop("Failed to scaffold workspace.");
    clack.cancel(err?.message ?? String(err));
    process.exit(1);
  }

  tryGitInit(targetDir);

  clack.outro(
    [
      `Done! Next steps:`,
      ``,
      `  cd ${name}`,
      `  pnpm install`,
      `  pnpm dev`,
      ``,
      `Add another app later:  agent-native add-app`,
      `Deploy the whole workspace:  agent-native deploy`,
    ].join("\n"),
  );
}

async function scaffoldWorkspaceRoot(
  targetDir: string,
  name: string,
): Promise<void> {
  const packageRoot = path.resolve(__dirname, "../..");
  const rootTemplate = path.join(packageRoot, "src/templates/workspace-root");
  const coreTemplate = path.join(packageRoot, "src/templates/workspace-core");

  copyDir(rootTemplate, targetDir);
  replacePlaceholders(targetDir, name, titleCase(name));
  rewriteCoreDependencyVersions(targetDir);
  renameGitignore(targetDir);

  // Inject the catalog from this repo's pnpm-workspace.yaml so templates'
  // `catalog:` version references resolve in the scaffolded workspace.
  const catalog = loadCatalog();
  if (Object.keys(catalog).length > 0) {
    const wsPath = path.join(targetDir, "pnpm-workspace.yaml");
    const existing = fs.existsSync(wsPath)
      ? fs.readFileSync(wsPath, "utf-8")
      : "";
    if (!existing.includes("catalog:")) {
      const catalogYaml = Object.entries(catalog)
        .map(([k, v]) => `  "${k}": "${v}"`)
        .join("\n");
      fs.writeFileSync(
        wsPath,
        existing.trimEnd() + "\ncatalog:\n" + catalogYaml + "\n",
      );
    }
  }

  const corePackageDir = path.join(targetDir, "packages", "shared");
  fs.mkdirSync(path.join(targetDir, "packages"), { recursive: true });
  copyDir(coreTemplate, corePackageDir);
  replacePlaceholders(corePackageDir, name, titleCase(name));
  rewriteCoreDependencyVersions(corePackageDir);

  // Ensure apps/ exists (even if empty).
  fs.mkdirSync(path.join(targetDir, "apps"), { recursive: true });
}

/* ─────────────────────────────────────────────────────────────────────────
 * Adding an app into an existing workspace
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Entry for `agent-native add-app [name]`. Called from inside a workspace.
 * Shows the multi-select picker (excluding already-installed apps) and
 * scaffolds each selected template under apps/<name>/.
 *
 * When `name` is provided with `--template foo`, scaffolds exactly one app
 * named <name> using template foo (non-interactive).
 */
export async function addAppToWorkspace(
  name?: string,
  opts?: CreateAppOptions,
): Promise<void> {
  const clack = await import("@clack/prompts");
  const workspace = detectWorkspace(process.cwd());
  if (!workspace) {
    clack.cancel(
      "Not inside a workspace. Run `agent-native create` to make one first, or use `--standalone`.",
    );
    process.exit(1);
  }

  clack.intro("Add an app to your workspace");

  const installed = listInstalledApps(workspace.workspaceRoot);

  // Non-interactive path: name + single --template
  const preselected = parseTemplateList(opts?.template);
  if (name && preselected.length === 1) {
    const tpl = preselected[0];
    await scaffoldOneAppIntoWorkspace(workspace, name, tpl, clack);
    return;
  }

  const templates = await promptTemplatePicker(preselected, clack, {
    excludeNames: installed,
    message: "Which apps do you want to add?",
  });
  if (templates.length === 0) {
    clack.cancel("No apps selected. Cancelled.");
    process.exit(0);
  }

  for (const t of templates) {
    await scaffoldOneAppIntoWorkspace(workspace, t, t, clack);
  }
}

async function scaffoldOneAppIntoWorkspace(
  workspace: { workspaceRoot: string; workspaceCoreName: string },
  appName: string,
  templateName: string,
  clack: typeof import("@clack/prompts"),
): Promise<void> {
  validateWorkspaceAppName(appName, clack);
  const appsDir = path.join(workspace.workspaceRoot, "apps");
  fs.mkdirSync(appsDir, { recursive: true });
  const appDir = path.join(appsDir, appName);

  if (fs.existsSync(appDir)) {
    clack.cancel(`Directory "apps/${appName}" already exists.`);
    process.exit(1);
  }

  const s = clack.spinner();
  s.start(`Scaffolding apps/${appName} from ${templateName}...`);

  try {
    await scaffoldAppTemplate(appDir, templateName);
    replacePlaceholders(
      appDir,
      appName,
      titleCase(appName),
      path.basename(workspace.workspaceRoot),
    );
    rewriteTrackingAppId(appDir, appName, templateName);
    workspacifyApp({
      appDir,
      appName,
      templateName,
      workspaceRoot: workspace.workspaceRoot,
      workspaceCoreName: workspace.workspaceCoreName,
      coreDependencyVersion: getCoreDependencyVersion(),
    });
    fixPackageJsonName(appDir, appName);
    rewriteNetlifyToml(appDir, appName, "workspace");
    renameGitignore(appDir);
    setupAgentSymlinks(appDir);
    await scaffoldRequiredPackages([templateName], workspace.workspaceRoot);
    s.stop(`Scaffolded apps/${appName}.`);
  } catch (err: any) {
    s.stop(`Failed to scaffold apps/${appName}.`);
    clack.cancel(err?.message ?? String(err));
    process.exit(1);
  }

  clack.outro(
    [
      `Done!`,
      ``,
      `  pnpm install`,
      `  pnpm dev`,
      ``,
      `The workspace gateway will detect apps/${appName} and serve it at /${appName}.`,
    ].join("\n"),
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Standalone creation (escape hatch)
 * ───────────────────────────────────────────────────────────────────────── */

async function createStandaloneApp(
  name: string | undefined,
  opts: CreateAppOptions | undefined,
  clack: typeof import("@clack/prompts"),
): Promise<void> {
  clack.intro("Create a new standalone agent-native app");

  name = await promptNameIfMissing(name, clack, "app", "my-app");

  const targetDir = path.resolve(process.cwd(), name);
  if (fs.existsSync(targetDir)) {
    clack.cancel(`Directory "${name}" already exists.`);
    process.exit(1);
  }

  // Standalone is single-select — pick one template.
  let template =
    opts?.template && !opts.template.includes(",") ? opts.template : undefined;
  if (!template) {
    const picked = await clack.select({
      message: "Which template would you like to use?",
      options: [
        ...starterFirst(coreTemplates()).map((t) => ({
          value: t.name,
          label: t.label,
          hint: t.hint,
        })),
        {
          value: BLANK_OPTION.name,
          label: BLANK_OPTION.label,
          hint: BLANK_OPTION.hint,
        },
      ],
    });
    if (clack.isCancel(picked)) {
      clack.cancel("Cancelled.");
      process.exit(0);
    }
    template = picked as string;
  }

  const s = clack.spinner();
  s.start("Scaffolding your app...");
  try {
    await scaffoldAppTemplate(targetDir, template);
    postProcessStandalone(name, targetDir, template);
    s.stop("App created!");
  } catch (err: any) {
    s.stop("Failed to create app.");
    clack.cancel(err?.message ?? String(err));
    process.exit(1);
  }

  tryGitInit(targetDir);

  clack.outro(`Done! Next steps:\n\n  cd ${name}\n  pnpm install\n  pnpm dev`);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shared scaffolding helpers
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Scaffold a single app template into `targetDir`. Resolves:
 *   - "blank" → bundled default template
 *   - "github:user/repo" → download the whole repo
 *   - first-party template name → download that subdir from BuilderIO/agent-native
 */
async function scaffoldAppTemplate(
  targetDir: string,
  template: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });

  if (template === "blank") {
    const packageRoot = path.resolve(__dirname, "../..");
    const defaultDir = path.join(packageRoot, "src/templates/default");
    if (!fs.existsSync(defaultDir)) {
      throw new Error(
        `Default template not found at ${defaultDir}. Is the package installed correctly?`,
      );
    }
    copyDir(defaultDir, targetDir);
    return;
  }

  // Normalize legacy alias
  let resolved = template === "video" ? "videos" : template;

  if (resolved.startsWith("github:")) {
    const repo = resolved.slice("github:".length);
    await downloadGitHubRepo(repo, targetDir);
    return;
  }

  if (!allTemplateNames().includes(resolved)) {
    throw new Error(
      `Unknown template "${template}". Known: ${allTemplateNames().join(", ")} — or use github:user/repo for community templates.`,
    );
  }

  // If running from the framework monorepo with a local templates/ dir, use
  // that. Otherwise download from GitHub. This keeps `agent-native create`
  // fast during framework development.
  const localTemplate = findLocalTemplate(resolved);
  if (localTemplate) {
    copyDir(localTemplate, targetDir);
  } else {
    await downloadGitHubSubdir(REPO, `${TEMPLATES_DIR}/${resolved}`, targetDir);
  }
}

/**
 * When developing the framework itself, prefer the sibling templates/<name>
 * directory. Returns undefined when running as a published package.
 */
function findLocalTemplate(name: string): string | undefined {
  let dir = path.resolve(__dirname);
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "templates", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Find a local packages/<name> directory (for framework development).
 * Returns undefined when running as a published npm package.
 */
function findLocalPackage(name: string): string | undefined {
  let dir = path.resolve(__dirname);
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "packages", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Scaffold internal workspace packages required by the selected templates.
 * Deduplicates so each package is only copied once even if multiple
 * templates need it.
 */
async function scaffoldRequiredPackages(
  templateNames: string[],
  workspaceRoot: string,
): Promise<void> {
  const needed = new Set<string>();
  for (const t of templateNames) {
    const meta = getTemplate(t);
    if (meta?.requiredPackages) {
      for (const p of meta.requiredPackages) needed.add(p);
    }
  }

  for (const pkgName of needed) {
    const targetDir = path.join(workspaceRoot, "packages", pkgName);
    if (fs.existsSync(targetDir)) continue;

    fs.mkdirSync(path.join(workspaceRoot, "packages"), { recursive: true });

    const localPkg = findLocalPackage(pkgName);
    if (localPkg) {
      copyDir(localPkg, targetDir);
    } else {
      await downloadGitHubSubdir(REPO, `packages/${pkgName}`, targetDir);
    }

    // The copied package may have @agent-native/core as a workspace:* dep.
    // Convert it to this CLI package's published range since
    // @agent-native/core is an npm package, not a workspace member.
    const pkgJsonPath = path.join(targetDir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        for (const depType of [
          "dependencies",
          "devDependencies",
          "peerDependencies",
        ] as const) {
          const deps = pkg[depType];
          if (!deps) continue;
          for (const [key, val] of Object.entries(deps)) {
            if (
              typeof val === "string" &&
              val.startsWith("workspace:") &&
              key === "@agent-native/core"
            ) {
              deps[key] = getCoreDependencyVersion();
            }
          }
        }
        fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");
      } catch {}
    }
  }

  // Add a postinstall script to build workspace packages so their dist/
  // directories exist even when downloaded from GitHub (where dist/ is
  // gitignored).
  if (needed.size > 0) {
    const rootPkgPath = path.join(workspaceRoot, "package.json");
    if (fs.existsSync(rootPkgPath)) {
      try {
        const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
        rootPkg.scripts = rootPkg.scripts ?? {};
        const builds = [...needed]
          .map((n) => `pnpm --filter ./packages/${n} build`)
          .join(" && ");
        const existing = rootPkg.scripts.postinstall;
        if (existing) {
          if (!existing.includes(builds)) {
            rootPkg.scripts.postinstall = `${existing} && ${builds}`;
          }
        } else {
          rootPkg.scripts.postinstall = builds;
        }
        fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n");
      } catch {}
    }
  }
}

/**
 * Post-process a standalone scaffold: replace placeholders, strip
 * workspace:* deps, set up agent symlinks, etc.
 */
function postProcessStandalone(
  name: string,
  targetDir: string,
  templateName?: string,
): void {
  const appTitle = titleCase(name);
  replacePlaceholders(targetDir, name, appTitle);
  rewriteTrackingAppId(targetDir, name, templateName);
  fixPackageJsonName(targetDir, name);
  rewriteNetlifyToml(targetDir, name, "standalone");

  for (const base of ["learnings"]) {
    const defaultsFile = path.join(targetDir, `${base}.defaults.md`);
    const targetFile = path.join(targetDir, `${base}.md`);
    if (fs.existsSync(defaultsFile) && !fs.existsSync(targetFile)) {
      fs.copyFileSync(defaultsFile, targetFile);
    }
  }

  renameGitignore(targetDir);

  // Drop monorepo-only files that standalone apps shouldn't ship.
  for (const f of ["DEVELOPING.md"]) {
    const p = path.join(targetDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // Resolve workspace:* and catalog: deps for standalone projects.
  // catalog: references only resolve inside a pnpm workspace with a catalog
  // defined in pnpm-workspace.yaml — standalone scaffolds don't have one.
  const catalog = loadCatalog();
  const pkgPath = path.join(targetDir, "package.json");
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
          if (key === "@agent-native/core") {
            deps[key] = getCoreDependencyVersion();
          } else if (typeof val === "string" && val.startsWith("workspace:")) {
            deps[key] = "latest";
          } else if (typeof val === "string" && val === "catalog:") {
            deps[key] = catalog[key] ?? "latest";
          }
        }
      }
      // Ensure pnpm.onlyBuiltDependencies is set so native packages
      // (better-sqlite3, esbuild, node-pty) compile their postinstall scripts
      // under pnpm 10+ without prompting for `pnpm approve-builds`.
      pkg.dependencies = pkg.dependencies ?? {};
      pkg.dependencies.postgres ??= POSTGRES_DEPENDENCY_VERSION;

      const requiredBuilt = ["better-sqlite3", "esbuild", "node-pty"];
      if (!pkg.pnpm || typeof pkg.pnpm !== "object") {
        pkg.pnpm = {};
      }
      const existing = Array.isArray(pkg.pnpm.onlyBuiltDependencies)
        ? pkg.pnpm.onlyBuiltDependencies
        : [];
      pkg.pnpm.onlyBuiltDependencies = Array.from(
        new Set([...existing, ...requiredBuilt]),
      );
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    } catch {}
  }

  setupAgentSymlinks(targetDir);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Prompting helpers
 * ───────────────────────────────────────────────────────────────────────── */

async function promptNameIfMissing(
  name: string | undefined,
  clack: typeof import("@clack/prompts"),
  kind: "workspace" | "app",
  placeholder: string,
): Promise<string> {
  if (name) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      clack.cancel(
        `Invalid ${kind} name "${name}". Use lowercase letters, numbers, and hyphens.`,
      );
      process.exit(1);
    }
    return name;
  }
  const result = await clack.text({
    message: `What is your ${kind} name?`,
    placeholder,
    validate(value) {
      if (!value)
        return `${kind[0].toUpperCase() + kind.slice(1)} name is required`;
      if (!/^[a-z][a-z0-9-]*$/.test(value)) {
        return "Use lowercase letters, numbers, and hyphens (must start with a letter)";
      }
      if (fs.existsSync(path.resolve(process.cwd(), value))) {
        return `Directory "${value}" already exists`;
      }
    },
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }
  return result as string;
}

async function promptTemplatePicker(
  preselected: string[],
  clack: typeof import("@clack/prompts"),
  opts?: {
    defaultTemplates?: string[];
    excludeNames?: string[];
    message?: string;
  },
): Promise<string[]> {
  const excluded = new Set(opts?.excludeNames ?? []);
  const options = starterFirst(coreTemplates())
    .filter((t) => !excluded.has(t.name))
    .map((t) => ({
      value: t.name,
      label: t.label,
      hint: t.hint,
    }));

  // If there's nothing left to pick, the caller gets an empty selection —
  // they decide how to handle it.
  if (options.length === 0) return [];

  // Default pre-selection: what the user passed via --template, falling
  // back to "starter" when that's available and nothing else is pre-picked.
  const defaults =
    preselected.length > 0
      ? preselected.filter((p) => options.some((o) => o.value === p))
      : opts?.defaultTemplates
        ? opts.defaultTemplates.filter((p) =>
            options.some((o) => o.value === p),
          )
        : options.some((o) => o.value === "starter")
          ? ["starter"]
          : [];

  const baseMessage = opts?.message ?? "Which apps would you like to include?";
  const result = await clack.multiselect({
    message: `${baseMessage}\n  (↑/↓ move · space to toggle · enter to confirm)`,
    options,
    initialValues: defaults,
    required: false,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }
  return result as string[];
}

function parseTemplateList(input?: string): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function listInstalledApps(workspaceRoot: string): string[] {
  const appsDir = path.join(workspaceRoot, "apps");
  if (!fs.existsSync(appsDir)) return [];
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Workspace detection
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Walk up from startDir looking for a package.json with
 * `agent-native.workspaceCore` set. Returns the workspace root and core
 * package name, or null if not inside a workspace.
 */
export function detectWorkspace(
  startDir: string,
): { workspaceRoot: string; workspaceCoreName: string } | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const wsCore = pkg?.["agent-native"]?.workspaceCore;
        if (typeof wsCore === "string" && wsCore.length > 0) {
          return { workspaceRoot: dir, workspaceCoreName: wsCore };
        }
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export { parseWorkspaceScope };

/** @internal — exported for E2E tests */
export {
  scaffoldWorkspaceRoot as _scaffoldWorkspaceRoot,
  scaffoldAppTemplate as _scaffoldAppTemplate,
  scaffoldRequiredPackages as _scaffoldRequiredPackages,
  postProcessStandalone as _postProcessStandalone,
  loadCatalog as _loadCatalog,
  fixPackageJsonName as _fixPackageJsonName,
  renameGitignore as _renameGitignore,
  rewriteNetlifyToml as _rewriteNetlifyToml,
  getCoreDependencyVersion as _getCoreDependencyVersion,
  getGitHubTemplateRef as _getGitHubTemplateRef,
  shouldSkipScaffoldEntry as _shouldSkipScaffoldEntry,
};

/* ─────────────────────────────────────────────────────────────────────────
 * Download / copy helpers
 * ───────────────────────────────────────────────────────────────────────── */

function validateRepoName(repo: string): void {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
    throw new Error(
      `Invalid repository name "${repo}". Expected format: user/repo`,
    );
  }
}

function downloadAndExtract(url: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const tarball = execFileSync("curl", ["-sL", url], {
    maxBuffer: 100 * 1024 * 1024,
  });
  const tarPath = path.join(destDir, ".download.tar.gz");
  fs.writeFileSync(tarPath, tarball);
  try {
    execFileSync(
      "tar",
      ["xzf", tarPath, "--strip-components=1", "-C", destDir],
      { stdio: "pipe" },
    );
  } finally {
    fs.unlinkSync(tarPath);
  }
}

async function downloadGitHubSubdir(
  repo: string,
  subdir: string,
  targetDir: string,
): Promise<void> {
  validateRepoName(repo);
  const ref = getGitHubTemplateRef();
  const tarUrl = `https://api.github.com/repos/${repo}/tarball/${encodeURIComponent(ref)}`;
  const tmpDir = path.join(targetDir, "..", `.agent-native-tmp-${Date.now()}`);
  try {
    downloadAndExtract(tarUrl, tmpDir);
    const srcDir = path.join(tmpDir, subdir);
    if (!fs.existsSync(srcDir)) {
      throw new Error(`Template directory "${subdir}" not found in ${repo}.`);
    }
    copyDir(srcDir, targetDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function downloadGitHubRepo(
  repo: string,
  targetDir: string,
): Promise<void> {
  validateRepoName(repo);
  const tarUrl = `https://api.github.com/repos/${repo}/tarball/main`;
  downloadAndExtract(tarUrl, targetDir);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Text / filesystem helpers
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Load the pnpm workspace catalog.
 * First tries the build-time snapshot at dist/catalog.json (works when
 * running as a published npm package). Falls back to parsing the monorepo
 * pnpm-workspace.yaml (works during local framework development).
 */
function loadCatalog(): Record<string, string> {
  try {
    // Build-time snapshot generated by finalize-build.mjs
    const snapshotPath = path.resolve(__dirname, "../catalog.json");
    if (fs.existsSync(snapshotPath)) {
      return JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
    }

    // Fallback: parse pnpm-workspace.yaml from the monorepo root
    // From dist/cli/ or src/cli/: 4 levels up → packages/core → packages → repo root
    const repoRoot = path.resolve(__dirname, "../../../..");
    const wsPath = path.join(repoRoot, "pnpm-workspace.yaml");
    if (!fs.existsSync(wsPath)) return {};
    const content = fs.readFileSync(wsPath, "utf-8");
    const result: Record<string, string> = {};
    let inCatalog = false;
    for (const line of content.split("\n")) {
      if (/^catalog:\s*$/.test(line)) {
        inCatalog = true;
        continue;
      }
      if (inCatalog) {
        if (/^\S/.test(line)) break;
        const match = line.match(/^\s+"?([^":]+)"?\s*:\s*"?([^"]+)"?\s*$/);
        if (match) result[match[1]] = match[2];
      }
    }
    return result;
  } catch {
    return {};
  }
}

function titleCase(name: string): string {
  return name
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function fixPackageJsonName(appDir: string, name: string): void {
  const pkgPath = path.join(appDir, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    pkg.name = name;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  } catch {}
}

function getCoreDependencyVersion(): string {
  if (process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE === "1") {
    const localCore = findLocalPackage("core");
    if (localCore) return pathToFileURL(localCore).href;
  }

  // Generated apps must install before the current package version is
  // published. The dist-tag resolves to the newest released core today and to
  // this package version once the release goes live. Local file deps are
  // intentionally opt-in so scaffolded repos remain portable by default.
  return "latest";
}

function getCorePackageVersion(): string | undefined {
  try {
    const packageRoot = path.resolve(__dirname, "../..");
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8"),
    );
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

function getGitHubTemplateRef(): string {
  const version = getCorePackageVersion();
  if (version && /^\d+\.\d+\.\d+(?:-.+)?$/.test(version)) {
    return `v${version}`;
  }
  return "main";
}

function rewriteCoreDependencyVersions(projectDir: string): void {
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    for (const depType of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
    ] as const) {
      const deps = pkg[depType];
      if (deps?.["@agent-native/core"]) {
        deps["@agent-native/core"] = getCoreDependencyVersion();
      }
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  } catch {}
}

function validateWorkspaceAppName(
  appName: string,
  clack: typeof import("@clack/prompts"),
): void {
  const error = getWorkspaceAppIdValidationError(appName);
  if (error) {
    clack.cancel(error);
    process.exit(1);
  }
}

function upsertTomlBuildEnvironment(
  content: string,
  vars: Record<string, string>,
): string {
  const lines = content.split("\n");
  const sectionIndex = lines.findIndex(
    (line) => line.trim() === "[build.environment]",
  );
  if (sectionIndex === -1) {
    const envLines = ["", "[build.environment]"].concat(
      Object.entries(vars).map(([key, value]) => `  ${key} = "${value}"`),
    );
    return content.trimEnd() + "\n" + envLines.join("\n") + "\n";
  }

  let nextSectionIndex = lines.findIndex(
    (line, index) => index > sectionIndex && /^\s*\[/.test(line),
  );
  if (nextSectionIndex === -1) nextSectionIndex = lines.length;

  for (const [key, value] of Object.entries(vars)) {
    const existingIndex = lines.findIndex(
      (line, index) =>
        index > sectionIndex &&
        index < nextSectionIndex &&
        new RegExp(`^\\s*${key}\\s*=`).test(line),
    );
    const nextLine = `  ${key} = "${value}"`;
    if (existingIndex === -1) {
      lines.splice(nextSectionIndex, 0, nextLine);
      nextSectionIndex += 1;
    } else {
      lines[existingIndex] = nextLine;
    }
  }

  return lines.join("\n");
}

function ensureRedirect(
  content: string,
  from: string,
  to: string,
  status: number,
): string {
  const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const redirectPattern = new RegExp(
    `\\n?\\[\\[redirects\\]\\]\\s+from\\s*=\\s*"${escapedFrom}"\\s+to\\s*=\\s*"[^"]*"\\s+status\\s*=\\s*\\d+(?:\\s+force\\s*=\\s*(?:true|false))?`,
    "m",
  );
  const block = [
    "",
    "[[redirects]]",
    `  from = "${from}"`,
    `  to = "${to}"`,
    `  status = ${status}`,
  ].join("\n");
  if (redirectPattern.test(content)) {
    return content.replace(redirectPattern, block);
  }
  return content.trimEnd() + "\n" + block + "\n";
}

function removeRedirect(content: string, from: string): string {
  const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const redirectPattern = new RegExp(
    `\\n?\\[\\[redirects\\]\\]\\s+from\\s*=\\s*"${escapedFrom}"\\s+to\\s*=\\s*"[^"]*"\\s+status\\s*=\\s*\\d+(?:\\s+force\\s*=\\s*(?:true|false))?`,
    "gm",
  );
  return content.replace(redirectPattern, "").replace(/\n{3,}/g, "\n\n");
}

function addWorkspaceMountNetlifyConfig(
  content: string,
  appName: string,
): string {
  const basePath = `/${appName}`;
  let next = upsertTomlBuildEnvironment(content, {
    APP_BASE_PATH: basePath,
    VITE_APP_BASE_PATH: basePath,
    NITRO_PRESET: "netlify",
    NPM_CONFIG_PRODUCTION: "false",
  });

  if (appName === "dispatch") {
    next = ensureRedirect(next, "/", "/dispatch/overview", 302);
    next = ensureRedirect(next, "/dispatch", "/dispatch/overview", 302);
    for (const [from, to] of DISPATCH_WORKSPACE_ROOT_REDIRECTS) {
      next = ensureRedirect(next, `/${from}`, `/dispatch/${to}`, 302);
    }
    next = removeRedirect(next, "/dispatch/*");
  }

  return next;
}

function rewriteNetlifyToml(
  appDir: string,
  appName: string,
  mode: "standalone" | "workspace",
): void {
  const netlifyPath = path.join(appDir, "netlify.toml");
  if (!fs.existsSync(netlifyPath)) return;

  try {
    let content = fs.readFileSync(netlifyPath, "utf-8");
    const originalCommand = content.match(/^  command = "([^"]*)"$/m)?.[1];
    const usesUnpooledDatabase =
      originalCommand?.includes("NETLIFY_DATABASE_URL_UNPOOLED") ?? false;
    const buildCommand =
      mode === "workspace"
        ? `APP_BASE_PATH=/${appName} VITE_APP_BASE_PATH=/${appName} NITRO_PRESET=netlify pnpm --filter ${appName} build`
        : "NITRO_PRESET=netlify pnpm build";
    const databaseSetup =
      'export DATABASE_URL=\\"${NETLIFY_DATABASE_URL:-$DATABASE_URL}\\"';
    const buildDatabasePrefix = usesUnpooledDatabase
      ? 'DATABASE_URL=\\"${NETLIFY_DATABASE_URL_UNPOOLED:-$DATABASE_URL}\\" '
      : "";
    const command = `${databaseSetup} && ${buildDatabasePrefix}${buildCommand}`;
    const publishPath = mode === "workspace" ? `apps/${appName}/dist` : "dist";
    const functionsPath =
      mode === "workspace"
        ? `apps/${appName}/.netlify/functions-internal`
        : ".netlify/functions-internal";

    content = content
      .replace(/^  command = ".*"$/m, `  command = "${command}"`)
      .replace(
        /publish = "templates\/[^"]+\/dist"/g,
        `publish = "${publishPath}"`,
      )
      .replace(
        /functions = "templates\/[^"]+\/\.netlify\/functions-internal"/g,
        `functions = "${functionsPath}"`,
      );

    if (mode === "workspace") {
      content = addWorkspaceMountNetlifyConfig(content, appName);
    }

    fs.writeFileSync(netlifyPath, content);
  } catch {}
}

function rewriteTrackingAppId(
  appDir: string,
  appName: string,
  templateName?: string,
): void {
  const rootPath = path.join(appDir, "app", "root.tsx");
  if (!fs.existsSync(rootPath)) return;

  try {
    const content = fs.readFileSync(rootPath, "utf-8");
    const pattern =
      /(^\s*app:\s*)(["'])(?:agent-native-[^"']+|\{\{APP_NAME\}\})\2(\s*,?)/m;
    if (!pattern.test(content)) return;

    let next = content.replace(
      pattern,
      (_match, prefix: string, quote: string, suffix: string) =>
        `${prefix}${quote}${appName}${quote}${suffix}`,
    );

    if (
      templateName &&
      templateName !== appName &&
      !hasTrackingTemplate(next)
    ) {
      next = next.replace(
        /(^\s*app:\s*["'][^"']+["'],?\s*$)/m,
        (line) => `${line}\n    template: ${JSON.stringify(templateName)},`,
      );
    }

    if (next !== content) {
      fs.writeFileSync(rootPath, next);
    }
  } catch {}
}

function hasTrackingTemplate(content: string): boolean {
  const match = content.match(/configureTracking\(\{[\s\S]*?\}\);/);
  return !!match && /^\s*template\s*:/m.test(match[0]);
}

function tryGitInit(dir: string): boolean {
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "pipe" });
    execFileSync(
      "git",
      ["commit", "-m", "Initial commit from agent-native create"],
      {
        cwd: dir,
        stdio: "pipe",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "agent-native",
          GIT_AUTHOR_EMAIL: "noreply@agent-native.com",
          GIT_COMMITTER_NAME: "agent-native",
          GIT_COMMITTER_EMAIL: "noreply@agent-native.com",
        },
      },
    );
    return true;
  } catch {
    return false;
  }
}

function renameGitignore(dir: string): void {
  const src = path.join(dir, "_gitignore");
  const dst = path.join(dir, ".gitignore");
  if (fs.existsSync(src)) fs.renameSync(src, dst);
}

function replacePlaceholders(
  dir: string,
  appName: string,
  appTitle: string,
  workspaceName?: string,
): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      replacePlaceholders(p, appName, appTitle, workspaceName);
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(p, "utf-8");
    } catch {
      continue;
    }
    const hasWs =
      workspaceName !== undefined && content.includes("{{WORKSPACE_NAME}}");
    if (
      !content.includes("{{APP_NAME}}") &&
      !content.includes("{{APP_TITLE}}") &&
      !hasWs
    ) {
      continue;
    }
    let next = content;
    if (workspaceName !== undefined) {
      next = next.replace(/\{\{WORKSPACE_NAME\}\}/g, workspaceName);
    }
    next = next
      .replace(/\{\{APP_NAME\}\}/g, appName)
      .replace(/\{\{APP_TITLE\}\}/g, appTitle);
    fs.writeFileSync(p, next);
  }
}

function copyDir(src: string, dest: string, root?: string): void {
  const resolvedRoot = root ?? path.resolve(src);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    if (shouldSkipScaffoldEntry(entry.name, srcPath)) continue;
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(srcPath);
      const resolvedTarget = path.resolve(path.dirname(srcPath), target);
      if (resolvedTarget.startsWith(resolvedRoot)) {
        fs.symlinkSync(target, destPath);
      } else {
        try {
          const stat = fs.statSync(srcPath);
          if (stat.isDirectory()) {
            copyDir(srcPath, destPath, resolvedRoot);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        } catch {
          // Broken symlink — skip silently
        }
      }
    } else if (entry.isDirectory()) {
      copyDir(srcPath, destPath, resolvedRoot);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function shouldSkipScaffoldEntry(name: string, srcPath?: string): boolean {
  if (
    name === "settings.json" &&
    srcPath?.split(path.sep).includes(".claude")
  ) {
    return true;
  }
  if (
    name === "node_modules" ||
    name === ".agent-native" ||
    name === ".env" ||
    name === ".env.local" ||
    name === ".netlify" ||
    name === ".vercel" ||
    name === ".generated" ||
    name === ".react-router" ||
    name === ".output" ||
    name === "build" ||
    name === "dist" ||
    name === ".DS_Store"
  ) {
    return true;
  }
  return (
    /^qa-.*\.db(?:-shm|-wal)?$/.test(name) || /\.db-(?:shm|wal)$/.test(name)
  );
}
