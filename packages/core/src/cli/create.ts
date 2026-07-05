import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import {
  DISPATCH_WORKSPACE_ROOT_REDIRECTS,
  getWorkspaceAppIdValidationError,
} from "../shared/workspace-app-id.js";
import { setupAgentSymlinks } from "./setup-agents.js";
import {
  coreTemplates,
  getTemplate,
  allTemplateNames,
  type TemplateMeta,
} from "./templates-meta.js";
import { workspacifyApp, parseWorkspaceScope } from "./workspacify.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO = "BuilderIO/agent-native";
const TEMPLATES_DIR = "templates";
const POSTGRES_DEPENDENCY_VERSION = "^3.4.9";
const STANDALONE_EXACT_DEPENDENCY_OVERRIDES: Record<string, string> = {
  "@react-router/dev": "8.1.0",
  "@react-router/fs-routes": "8.1.0",
  "react-router": "8.1.0",
};
const SENTRY_MINIMUM_RELEASE_AGE_EXCLUDES = ['"@sentry/*"'];
const FIRST_PARTY_TARBALL_SYMLINK_EXCLUDES = [
  "*/CLAUDE.md",
  "*/.claude/skills",
];

/**
 * Tagged error for input that fails CLI-level validation (repo names, app
 * names, etc.). The Sentry `beforeSend` hook in cli/index.ts drops events
 * whose top-level exception type is `ValidationError` so we don't pollute
 * Sentry with expected user-input rejections.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Move the primitive-first and chat on-ramps to the top of the list so they
 * line up with clack's default highlight.
 */
function onRampFirst(templates: TemplateMeta[]): TemplateMeta[] {
  return moveTemplatesToFront(templates, ["headless", "chat"]);
}

function moveTemplatesToFront(
  templates: TemplateMeta[],
  preferredNames: string[],
): TemplateMeta[] {
  const preferred = preferredNames
    .map((name) => templates.find((t) => t.name === name))
    .filter((template): template is TemplateMeta => Boolean(template));
  if (preferred.length === 0) return templates;
  const preferredSet = new Set(preferred.map((t) => t.name));
  return [...preferred, ...templates.filter((t) => !preferredSet.has(t.name))];
}

/** Primitive-first scaffold option appended to standalone pickers. */
const HEADLESS_OPTION = {
  name: "headless",
  label: "Headless",
  hint: "Action-first app with one hello primitive and no UI shell",
};

export interface CreateAppOptions {
  /** Pre-select these templates in the picker. Comma-separated string or array. */
  template?: string;
  /** Scaffold a single standalone app (old behavior). Skips workspace creation. */
  standalone?: boolean;
  /** Internal: skip pnpm install at the end (for tests). */
  noInstall?: boolean;
  /**
   * Internal: always scaffold a workspace and skip the start-shape prompt.
   * Used by the deprecated `create-workspace` alias, whose contract is an
   * unconditional workspace scaffold.
   */
  forceWorkspace?: boolean;
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

  // Reject an invalid provided name before any interactive prompt so bad input
  // fails fast instead of blocking on the start-shape picker below.
  if (name !== undefined) {
    assertValidProjectName(name, clack);
  }

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
  // Headless can't live in a workspace, so reject it when more than one
  // template is requested or when workspace semantics are forced.
  if (
    parsed.includes("headless") &&
    (parsed.length > 1 || opts?.forceWorkspace)
  ) {
    clack.cancel(
      "The headless scaffold is standalone-only. Use `agent-native create my-app --headless`, or use the Chat template when adding a UI app to a workspace.",
    );
    process.exit(1);
  }
  // A single explicit template scaffolds a standalone app, unless the caller
  // forces workspace semantics (the deprecated `create-workspace` alias), in
  // which case the template is preselected in the workspace picker below.
  if (parsed.length === 1 && !opts?.forceWorkspace) {
    await createStandaloneApp(name, opts, clack);
    return;
  }

  // No template specified: ask what shape to start from before diving into
  // "which templates?". The on-ramp choice implies the project structure, so
  // we don't ask a separate "workspace or standalone?" question — Chat and
  // Headless scaffold a single standalone app (the lightest starts; headless
  // cannot live in a workspace), while Template continues into the workspace
  // multi-select.
  if (parsed.length === 0) {
    // The deprecated `create-workspace` alias forces workspace semantics, so
    // it must skip the start-shape prompt and scaffold a workspace directly.
    if (opts?.forceWorkspace) {
      await createWorkspaceInteractive(name, opts, clack);
      return;
    }
    const shape = await promptStartShape(clack);
    if (shape === "headless" || shape === "chat") {
      await createStandaloneApp(name, { ...opts, template: shape }, clack);
      return;
    }
    // shape === "template" → full app(s) in a workspace.
    await createWorkspaceInteractive(name, opts, clack);
    return;
  }

  // Multiple explicit templates: create a workspace with them.
  await createWorkspaceInteractive(name, opts, clack);
}

/**
 * Top-level on-ramp shown by the bare `create <name>` command (no flags). The
 * choice made here implies the project structure, so we deliberately avoid a
 * separate "workspace or standalone?" question:
 *   - "template" → full app(s) in a workspace (the multi-select picker)
 *   - "chat"     → a single standalone chat UI app
 *   - "headless" → a single standalone action-first app with no UI shell
 * Chat and headless are standalone on purpose: a monorepo is unnecessary
 * ceremony for the lightest on-ramps, and headless cannot be a workspace
 * member. Either can grow into a workspace later via `add-app`.
 */
async function promptStartShape(
  clack: typeof import("@clack/prompts"),
): Promise<"template" | "chat" | "headless"> {
  const choice = await clack.select({
    message: "How do you want to start?",
    options: [
      {
        value: "template",
        label: "Full template(s)",
        hint: "Clone complete apps (Mail, Calendar, Slides, ...) into a workspace",
      },
      {
        value: "chat",
        label: "Chat",
        hint: "A single app with a minimal chat UI and the browser shell wired up",
      },
      {
        value: "headless",
        label: "Headless",
        hint: "A single action-first app with one primitive and no UI shell",
      },
    ],
  });
  if (clack.isCancel(choice)) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }
  return choice as "template" | "chat" | "headless";
}

/**
 * Validate a project name supplied on the command line. Mirrors the rule in
 * `promptNameIfMissing` so an invalid name is rejected before any interactive
 * prompt runs (the sub-flows re-validate, which is a harmless no-op).
 */
function assertValidProjectName(
  name: string,
  clack: typeof import("@clack/prompts"),
): void {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    clack.cancel(
      `Invalid name "${name}". Use lowercase letters, numbers, and hyphens (must start with a letter).`,
    );
    process.exit(1);
  }
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
  const preselected = parseTemplateList(opts?.template);

  clack.note(
    [
      `You're creating a workspace named "${name}". A workspace is a monorepo`,
      "container — it isn't an app itself. Inside it you pick one or more apps",
      "(below), and each app gets its own route, agent, and UI. Apps in the",
      "same workspace share auth, database, and the agent chat. Add more apps",
      "later with `npx @agent-native/core@latest add-app`. Chat is the UI on-ramp",
      "for a minimal chat-first app with the browser shell already wired.",
      "Dispatch is always included as the workspace control plane —",
      "it owns shared secrets, messaging, approvals, and cross-app routing.",
    ].join("\n"),
    "About workspaces",
  );

  // Dispatch is the workspace control plane (shared secrets, messaging,
  // approvals, cross-app routing) and is always scaffolded — the picker
  // only shows the optional apps. If the user explicitly passed
  // `--template=...`, those entries get unioned with dispatch.
  const optionalPicks =
    preselected.length > 0
      ? preselected.filter((t) => t !== "dispatch")
      : await promptTemplatePicker(preselected, clack, {
          defaultTemplates: ["chat"],
          preferredFirst: ["chat"],
          excludeNames: ["dispatch"],
        });
  const templates = ["dispatch", ...optionalPicks];

  const targetDir = path.resolve(process.cwd(), name);
  if (fs.existsSync(targetDir)) {
    clack.cancel(`Directory "${name}" already exists.`);
    process.exit(1);
  }

  const s = clack.spinner();
  s.start(`Scaffolding workspace "${name}"...`);
  const appNames = new Set<string>();
  const scaffoldedApps: string[] = [];

  try {
    await scaffoldWorkspaceRoot(targetDir, name);
    const workspaceCoreName = `@${name}/shared`;

    for (let i = 0; i < templates.length; i++) {
      const templateName = templates[i];
      const appName = workspaceAppNameForTemplateSelection(templateName);
      validateWorkspaceAppName(appName, clack, {
        allowDispatch: appName === "dispatch" && templateName === "dispatch",
      });
      if (appNames.has(appName)) {
        clack.cancel(
          `Workspace app "${appName}" is selected more than once. Choose unique app templates or app names.`,
        );
        process.exit(1);
      }
      appNames.add(appName);
      scaffoldedApps.push(appName);
      // Distinguish download vs local copy in the spinner so a multi-second
      // GitHub fetch doesn't look like a frozen "Scaffolding..." message.
      // Mirrors the local-vs-remote decision inside scaffoldAppTemplate.
      const willDownload =
        templateName !== "headless" && templateName.startsWith("github:")
          ? true
          : !findLocalTemplate(normalizeTemplateName(templateName));
      s.message(
        willDownload
          ? `Downloading ${titleCase(appName)} template (${i + 1}/${templates.length})...`
          : `Scaffolding ${titleCase(appName)} (${i + 1}/${templates.length})...`,
      );
      const appDir = path.join(targetDir, "apps", appName);
      await scaffoldAppTemplate(appDir, templateName);
      s.message(
        `Configuring ${titleCase(appName)} (${i + 1}/${templates.length})...`,
      );
      replacePlaceholders(appDir, appName, appTitleForScaffold(appName), name);
      rewriteTrackingAppId(appDir, appName, templateName);
      workspacifyApp({
        appDir,
        appName,
        templateName,
        workspaceRoot: targetDir,
        workspaceCoreName,
        coreDependencyVersion: getCoreDependencyVersion(),
        dispatchDependencyVersion: getDispatchDependencyVersion(),
        toolkitDependencyVersion: getToolkitDependencyVersion(),
      });
      fixPackageJsonName(appDir, appName, templateName);
      fixWebManifestName(appDir, appName, templateName);
      rewriteNetlifyToml(appDir, appName, "workspace");
      renameGitignore(appDir);
      // Each app owns its own .claude / .agents symlinks.
      setupAgentSymlinks(appDir);
    }

    s.message("Adding shared packages...");
    await scaffoldRequiredPackages(templates, targetDir);

    s.stop(
      `Workspace scaffolded with ${templates.length} app${templates.length === 1 ? "" : "s"}.`,
    );
  } catch (err: any) {
    s.stop("Failed to scaffold workspace.");
    // Remove the partially-scaffolded workspace so a retry of `agent-native
    // create <name>` doesn't trip the "Directory already exists" guard.
    cleanupOnFailure(targetDir);
    clack.cancel(err?.message ?? String(err));
    process.exit(1);
  }

  tryGitInit(targetDir);

  // Show the user the tree we just built so the workspace/app distinction is
  // visible, not just described. First-time users routinely expect their
  // workspace name to be the app — seeing apps/<template>/ subdirectories
  // makes the structure concrete.
  const treeLines = [
    `  ${name}/                    ← your workspace`,
    ...scaffoldedApps.map(
      (appName, i) =>
        `  ${i === scaffoldedApps.length - 1 ? "└─" : "├─"} apps/${appName}/`.padEnd(
          30,
        ) + `   ← app`,
    ),
  ];
  const dispatchNextStep = [
    `Once running, open Dispatch — you'll see "Workspace: ${titleCase(name)}"`,
    `at the top, with all your apps listed under it.`,
  ];

  const installSteps = hasPnpm()
    ? [
        `  pnpm install`,
        `  pnpm dev          # starts Dispatch on http://localhost:8092`,
      ]
    : [
        `  # pnpm is required but wasn't found on your PATH. Install it first:`,
        `  npm install -g pnpm`,
        ``,
        `  pnpm install`,
        `  pnpm dev          # starts Dispatch on http://localhost:8092`,
      ];

  clack.outro(
    [
      `Created workspace "${name}" with ${templates.length} app${templates.length === 1 ? "" : "s"}:`,
      ``,
      ...treeLines,
      ``,
      `Next steps:`,
      ``,
      `  cd ${name}`,
      ...installSteps,
      ``,
      ...dispatchNextStep,
      ``,
      `Add another app later:        npx @agent-native/core@latest add-app`,
      `Deploy the whole workspace:   pnpm exec agent-native deploy`,
    ].join("\n"),
  );
}

function workspaceAppNameForTemplateSelection(templateName: string): string {
  const normalized = normalizeTemplateName(templateName);
  if (!normalized.startsWith("github:")) return templateName;
  const repo = normalized.slice("github:".length).trim();
  const repoName = repo.split("/").filter(Boolean).pop() ?? "app";
  let appName = repoName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!appName) appName = "app";
  if (!/^[a-z]/.test(appName)) appName = `app-${appName}`;
  return appName;
}

/**
 * Detect whether pnpm is on PATH. End-user machines often have npm/yarn but
 * not pnpm; the workspace scaffold uses pnpm workspaces, so we surface a
 * specific install hint in the outro when it's missing rather than letting
 * the user hit `zsh: command not found: pnpm`.
 */
function hasPnpm(): boolean {
  try {
    execFileSync("pnpm", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
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

  const localToolkit = localToolkitOverride();
  if (localToolkit) {
    const wsPath = path.join(targetDir, "pnpm-workspace.yaml");
    const existing = fs.existsSync(wsPath)
      ? fs.readFileSync(wsPath, "utf-8")
      : "";
    const updated = mergeWorkspaceYamlSections(existing, {
      overrides: {
        '"@agent-native/toolkit"': JSON.stringify(localToolkit),
      },
    });
    if (updated !== existing) {
      fs.writeFileSync(wsPath, updated);
    }
  }

  const corePackageDir = path.join(targetDir, "packages", "shared");
  fs.mkdirSync(path.join(targetDir, "packages"), { recursive: true });
  copyDir(coreTemplate, corePackageDir);
  replacePlaceholders(corePackageDir, name, titleCase(name));
  rewriteCoreDependencyVersions(corePackageDir);
  setupAgentSymlinks(corePackageDir);

  // Ensure apps/ exists (even if empty).
  fs.mkdirSync(path.join(targetDir, "apps"), { recursive: true });

  // Root-level agent instructions apply before an agent descends into an app.
  linkWorkspaceRootSkills(targetDir);
  setupAgentSymlinks(targetDir);
}

function linkWorkspaceRootSkills(targetDir: string): void {
  const sharedSkillsDir = path.join(
    targetDir,
    "packages",
    "shared",
    ".agents",
    "skills",
  );
  if (!fs.existsSync(sharedSkillsDir)) return;

  const agentsDir = path.join(targetDir, ".agents");
  const linkPath = path.join(agentsDir, "skills");
  const target = "../packages/shared/.agents/skills";

  fs.mkdirSync(agentsDir, { recursive: true });

  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      if (fs.readlinkSync(linkPath) === target) return;
      fs.unlinkSync(linkPath);
    } else {
      return;
    }
  } catch {
    // Missing link; create below.
  }

  try {
    fs.symlinkSync(
      target,
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch {
    try {
      copyDir(sharedSkillsDir, linkPath);
    } catch {
      // Best-effort fallback for environments that disallow symlinks.
    }
  }
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
  if (preselected.includes("headless")) {
    clack.cancel(
      "The headless scaffold is standalone-only. Use `agent-native create my-app --headless` outside a workspace, or use the Chat template when adding a UI app to a workspace.",
    );
    process.exit(1);
  }
  if (name && preselected.length === 1) {
    const tpl = preselected[0];
    await scaffoldOneAppIntoWorkspace(workspace, name, tpl, clack);
    return;
  }

  const hasDispatch = installed.includes("dispatch");
  const templates = await promptTemplatePicker(preselected, clack, {
    excludeNames: installed,
    message: "Which apps do you want to add?",
    defaultTemplates: hasDispatch ? undefined : ["dispatch"],
    preferredFirst: hasDispatch ? ["chat"] : ["dispatch", "chat"],
    recommendedNames: hasDispatch ? [] : ["dispatch"],
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
  // Dispatch is the one reserved-route exception: the canonical workspace
  // control-plane app intentionally owns /dispatch.
  validateWorkspaceAppName(appName, clack, {
    allowDispatch: appName === "dispatch" && templateName === "dispatch",
  });
  const appsDir = path.join(workspace.workspaceRoot, "apps");
  fs.mkdirSync(appsDir, { recursive: true });
  const appDir = path.join(appsDir, appName);

  if (fs.existsSync(appDir)) {
    clack.cancel(`Directory "apps/${appName}" already exists.`);
    process.exit(1);
  }

  const s = clack.spinner();
  s.start(
    `Working... no action needed. Scaffolding apps/${appName} from ${templateName}.`,
  );

  try {
    await scaffoldAppTemplate(appDir, templateName);
    replacePlaceholders(
      appDir,
      appName,
      appTitleForScaffold(appName),
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
      dispatchDependencyVersion: getDispatchDependencyVersion(),
      toolkitDependencyVersion: getToolkitDependencyVersion(),
    });
    fixPackageJsonName(appDir, appName, templateName);
    fixWebManifestName(appDir, appName, templateName);
    rewriteNetlifyToml(appDir, appName, "workspace");
    renameGitignore(appDir);
    setupAgentSymlinks(appDir);
    await scaffoldRequiredPackages([templateName], workspace.workspaceRoot);
    s.stop(`Scaffolded apps/${appName}.`);
  } catch (err: any) {
    s.stop(`Failed to scaffold apps/${appName}.`);
    cleanupOnFailure(appDir);
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
        {
          value: HEADLESS_OPTION.name,
          label: HEADLESS_OPTION.label,
          hint: HEADLESS_OPTION.hint,
        },
        ...onRampFirst(coreTemplates())
          .filter((t) => t.name !== HEADLESS_OPTION.name)
          .map((t) => ({
            value: t.name,
            label: t.label,
            hint: t.hint,
          })),
      ],
    });
    if (clack.isCancel(picked)) {
      clack.cancel("Cancelled.");
      process.exit(0);
    }
    template = picked as string;
  }
  template = normalizeTemplateName(template);

  const s = clack.spinner();
  s.start(
    template === "headless"
      ? "Scaffolding the headless agent app..."
      : `Downloading the ${template} template from GitHub...`,
  );
  try {
    await scaffoldAppTemplate(targetDir, template);
    s.message(`Setting up ${name}…`);
    postProcessStandalone(name, targetDir, template);
    s.stop("App created!");
  } catch (err: any) {
    s.stop("Failed to create app.");
    cleanupOnFailure(targetDir);
    clack.cancel(err?.message ?? String(err));
    process.exit(1);
  }

  tryGitInit(targetDir);

  if (template === "headless") {
    clack.outro(
      [
        "Done! Next steps:",
        "",
        `  cd ${name}`,
        "  pnpm install",
        "  pnpm action hello --name Builder",
        `  pnpm agent "Call hello for Builder"`,
        "",
        "Add a UI later by starting from the Chat template; `agent-native add` is reserved for integration blueprints.",
      ].join("\n"),
    );
  } else {
    clack.outro(
      `Done! Next steps:\n\n  cd ${name}\n  pnpm install\n  pnpm dev`,
    );
  }
}

/**
 * Remove a partially-scaffolded target directory after a scaffold failure so a
 * retry doesn't hit the "Directory already exists" guard. Best-effort — the
 * underlying failure is what we want surfaced, so we swallow rm errors and
 * skip if the directory is somehow already gone.
 */
function cleanupOnFailure(targetDir: string): void {
  try {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore — original error is more useful than a cleanup failure.
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shared scaffolding helpers
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Scaffold a single app template into `targetDir`. Resolves:
 *   - "headless" / legacy "blank" → bundled action-first template
 *   - "github:user/repo" → download the whole repo
 *   - first-party template name → download that subdir from BuilderIO/agent-native
 */
async function scaffoldAppTemplate(
  targetDir: string,
  template: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });

  // Normalize legacy / renamed aliases.
  let resolved = normalizeTemplateName(template);

  if (resolved === "headless") {
    const packageRoot = path.resolve(__dirname, "../..");
    const headlessDir = path.join(packageRoot, "src/templates/headless");
    if (!fs.existsSync(headlessDir)) {
      throw new Error(
        `Headless template not found at ${headlessDir}. Is the package installed correctly?`,
      );
    }
    copyDir(headlessDir, targetDir);
    return;
  }

  if (resolved.startsWith("github:")) {
    const repo = resolved.slice("github:".length);
    await downloadGitHubRepo(repo, targetDir);
    return;
  }

  if (!getTemplate(resolved)) {
    throw new Error(
      `Unknown template "${template}". Known: ${allTemplateNames().join(", ")} — or use github:user/repo for community templates.`,
    );
  }

  // If running from the framework monorepo with a local templates/ dir, use
  // that. Otherwise download from GitHub. This keeps `agent-native create`
  // fast during framework development.
  const sourceTemplate = templateSourceName(resolved);
  const localTemplate = findLocalTemplate(sourceTemplate);
  if (localTemplate) {
    copyDir(localTemplate, targetDir);
  } else {
    await downloadGitHubSubdir(
      REPO,
      `${TEMPLATES_DIR}/${sourceTemplate}`,
      targetDir,
    );
  }
}

function templateSourceName(name: string): string {
  if (name === "starter") return "chat";
  return name;
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

function normalizeTemplateName(template: string): string {
  if (template === "blank") return "headless";
  if (template === "image" || template === "images" || template === "asset") {
    return "assets";
  }
  return template;
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

    // The copied package may have published framework packages as workspace:*
    // deps. Convert them to published ranges because these package-backed
    // modules are npm dependencies, not scaffolded workspace members.
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
            if (
              typeof val === "string" &&
              val.startsWith("workspace:") &&
              key === "@agent-native/toolkit"
            ) {
              deps[key] = getToolkitDependencyVersion();
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
  const appTitle = appTitleForScaffold(name);
  replacePlaceholders(targetDir, name, appTitle);
  rewriteTrackingAppId(targetDir, name, templateName);
  rewriteAgentChatAppId(targetDir, name, templateName);
  fixPackageJsonName(targetDir, name, templateName);
  fixWebManifestName(targetDir, name, templateName);
  rewriteNetlifyToml(targetDir, name, "standalone");

  for (const base of ["learnings"]) {
    const defaultsFile = path.join(targetDir, `${base}.defaults.md`);
    const targetFile = path.join(targetDir, `${base}.md`);
    if (fs.existsSync(defaultsFile) && !fs.existsSync(targetFile)) {
      fs.copyFileSync(defaultsFile, targetFile);
    }
  }

  renameGitignore(targetDir);

  // No monorepo-only files to drop for standalone scaffolds.
  // DEVELOPING.md is intentionally kept: it documents local run commands,
  // DATABASE_URL defaults, and other local-run instructions that are equally
  // valid for standalone apps.

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
          const exactOverride = STANDALONE_EXACT_DEPENDENCY_OVERRIDES[key];
          if (exactOverride) {
            deps[key] = exactOverride;
          } else if (key === "@agent-native/core") {
            deps[key] = getCoreDependencyVersion();
          } else if (key === "@agent-native/toolkit") {
            deps[key] = getToolkitDependencyVersion();
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

  // Write pnpm-workspace.yaml for pnpm v11 compatibility. pnpm v11 no longer
  // reads the pnpm field in package.json, so allowBuilds and overrides must
  // live here. Merge into any existing file (e.g. from the default template)
  // without creating duplicate section headers.
  const wsPath = path.join(targetDir, "pnpm-workspace.yaml");
  try {
    const existing = fs.existsSync(wsPath)
      ? fs.readFileSync(wsPath, "utf-8")
      : "";
    const sections: Record<string, Record<string, string>> = {
      allowBuilds: {
        "better-sqlite3": "true",
        esbuild: "true",
        "node-pty": "true",
      },
    };
    if (templateName !== "headless") {
      sections.overrides = {
        '"@assistant-ui/store"': '">=0.2.9 <0.2.14"',
        '"@assistant-ui/tap"': '"^0.5.14"',
        nf3: '"0.3.17"',
      };
    }
    const localToolkit = localToolkitOverride();
    if (localToolkit) {
      sections.overrides ??= {};
      sections.overrides['"@agent-native/toolkit"'] =
        JSON.stringify(localToolkit);
    }
    let updated = mergeWorkspaceYamlSections(existing, sections);
    updated = mergeWorkspaceYamlListItems(
      updated,
      "minimumReleaseAgeExclude",
      SENTRY_MINIMUM_RELEASE_AGE_EXCLUDES,
    );
    if (updated !== existing) {
      fs.writeFileSync(wsPath, updated);
    }
  } catch {}

  fixStandaloneTsconfig(targetDir, templateName);

  setupAgentSymlinks(targetDir);
}

function fixStandaloneTsconfig(targetDir: string, templateName?: string): void {
  const tsconfigPath = path.join(targetDir, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return;
  try {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8")) as {
      compilerOptions?: Record<string, unknown>;
    };
    tsconfig.compilerOptions ??= {};
    const hasUiApp =
      templateName !== "headless" && fs.existsSync(path.join(targetDir, "app"));
    const paths = {
      ...((tsconfig.compilerOptions.paths as Record<string, string[]>) ?? {}),
    };
    paths["*"] ??= ["./*"];
    if (hasUiApp) {
      paths["@/*"] ??= ["./app/*"];
      paths["@shared/*"] ??= ["./shared/*"];
    }
    // baseUrl is deprecated/errors in TS 6 (TS5101/TS5102) and removed in TS 7
    // (tsgo, which CI runs). paths already resolve relative to this tsconfig,
    // and the "*": ["./*"] entry replaces baseUrl's bare-specifier resolution,
    // so never emit baseUrl into scaffolds.
    delete tsconfig.compilerOptions.baseUrl;
    tsconfig.compilerOptions.paths = paths;
    fs.writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
  } catch {}
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
    preferredFirst?: string[];
    recommendedNames?: string[];
  },
): Promise<string[]> {
  const excluded = new Set(opts?.excludeNames ?? []);
  const orderedTemplates = opts?.preferredFirst
    ? moveTemplatesToFront(coreTemplates(), opts.preferredFirst)
    : onRampFirst(coreTemplates());
  const recommendedNames = new Set(opts?.recommendedNames ?? []);
  const options = orderedTemplates
    .filter((t) => !excluded.has(t.name))
    .map((t) => ({
      value: t.name,
      label: recommendedNames.has(t.name)
        ? `${t.label} (recommended)`
        : t.label,
      hint:
        recommendedNames.has(t.name) && t.name === "dispatch"
          ? "Recommended workspace control plane: secrets, messaging, approvals, and A2A delegation"
          : t.hint,
    }));

  // If there's nothing left to pick, the caller gets an empty selection —
  // they decide how to handle it.
  if (options.length === 0) return [];

  // Default pre-selection: what the user passed via --template, falling
  // back to caller defaults, then to "chat" when available.
  const defaults =
    preselected.length > 0
      ? preselected.filter((p) => options.some((o) => o.value === p))
      : opts?.defaultTemplates
        ? opts.defaultTemplates.filter((p) =>
            options.some((o) => o.value === p),
          )
        : options.some((o) => o.value === "chat")
          ? ["chat"]
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
    .map((s) => normalizeTemplateName(s.trim()))
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
  getDispatchDependencyVersion as _getDispatchDependencyVersion,
  getToolkitDependencyVersion as _getToolkitDependencyVersion,
  getGitHubTemplateRef as _getGitHubTemplateRef,
  getGitHubTemplateRefCandidates as _getGitHubTemplateRefCandidates,
  workspaceAppNameForTemplateSelection as _workspaceAppNameForTemplateSelection,
  shouldSkipScaffoldEntry as _shouldSkipScaffoldEntry,
  tarExtractArgs as _tarExtractArgs,
};

/* ─────────────────────────────────────────────────────────────────────────
 * Download / copy helpers
 * ───────────────────────────────────────────────────────────────────────── */

function validateRepoName(repo: string): void {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
    throw new ValidationError(
      `Invalid repository name "${repo}". Expected format: user/repo`,
    );
  }
}

function tarExtractArgs(
  tarPath: string,
  destDir: string,
  options: { skipAgentSymlinks?: boolean } = {},
): string[] {
  const excludes = options.skipAgentSymlinks
    ? FIRST_PARTY_TARBALL_SYMLINK_EXCLUDES.flatMap((pattern) => [
        "--exclude",
        pattern,
      ])
    : [];
  return ["xzf", tarPath, "--strip-components=1", ...excludes, "-C", destDir];
}

function downloadAndExtract(
  url: string,
  destDir: string,
  options: { skipAgentSymlinks?: boolean } = {},
): void {
  fs.mkdirSync(destDir, { recursive: true });
  // --fail-with-body so curl exits non-zero on HTTP 4xx/5xx instead of writing
  // the error body (HTML/JSON) to disk where tar then fails with the opaque
  // "Unrecognized archive format" message.
  const tarball = execFileSync("curl", ["--fail-with-body", "-sL", url], {
    maxBuffer: 100 * 1024 * 1024,
  });
  const tarPath = path.join(destDir, ".download.tar.gz");
  fs.writeFileSync(tarPath, tarball);
  try {
    execFileSync("tar", tarExtractArgs(tarPath, destDir, options), {
      stdio: "pipe",
    });
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
  const refs = getGitHubTemplateRefCandidates();
  const errors: string[] = [];
  for (const ref of refs) {
    const tarUrl = `https://api.github.com/repos/${repo}/tarball/${encodeURIComponent(ref)}`;
    const tmpDir = path.join(
      targetDir,
      "..",
      `.agent-native-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    try {
      downloadAndExtract(tarUrl, tmpDir, { skipAgentSymlinks: repo === REPO });
      const srcDir = path.join(tmpDir, subdir);
      if (!fs.existsSync(srcDir)) {
        throw new Error(
          `Template directory "${subdir}" not found at ref "${ref}".`,
        );
      }
      copyDir(srcDir, targetDir);
      return;
    } catch (err) {
      errors.push(
        `  ${ref}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
  throw new Error(
    `Failed to download templates from ${repo}. Tried refs:\n${errors.join("\n")}`,
  );
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
 * Merge key-value entries into named sections of a pnpm-workspace.yaml string
 * without creating duplicate section headers. For each section:
 *   - If the section already exists, new entries are injected after its header.
 *   - If the section is absent, a new block is appended at the end.
 * Entries already present (by key) are skipped.
 */
function mergeWorkspaceYamlSections(
  yaml: string,
  sections: Record<string, Record<string, string>>,
): string {
  let result = yaml;
  for (const [section, entries] of Object.entries(sections)) {
    for (const [key, value] of Object.entries(entries)) {
      if (result.includes(key)) continue;
      const sectionHeader = new RegExp(`^${section}:\\s*$`, "m");
      const match = sectionHeader.exec(result);
      if (match) {
        const insertAt = match.index + match[0].length;
        result =
          result.slice(0, insertAt) +
          `\n  ${key}: ${value}` +
          result.slice(insertAt);
      } else {
        result =
          result.trimEnd() +
          (result ? "\n" : "") +
          `\n${section}:\n  ${key}: ${value}\n`;
      }
    }
  }
  return result;
}

function mergeWorkspaceYamlListItems(
  yaml: string,
  section: string,
  items: string[],
): string {
  let result = yaml;
  for (const item of items) {
    const rendered = `  - ${item}`;
    if (result.includes(rendered)) continue;
    const sectionHeader = new RegExp(`^${section}:\\s*$`, "m");
    const match = sectionHeader.exec(result);
    if (match) {
      const insertAt = match.index + match[0].length;
      result =
        result.slice(0, insertAt) + `\n${rendered}` + result.slice(insertAt);
    } else {
      result =
        result.trimEnd() +
        (result ? "\n" : "") +
        `\n${section}:\n${rendered}\n`;
    }
  }
  return result;
}

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

function appTitleForScaffold(appName: string): string {
  return titleCase(appName);
}

function isChatOnRampTemplate(templateName: string | undefined): boolean {
  return templateName === "chat" || templateName === "starter";
}

function trackingTemplateName(
  templateName: string | undefined,
): string | undefined {
  return templateName === "starter" ? "chat" : templateName;
}

function defaultPackageDescriptionForScaffold(appName: string): string {
  const appTitle = appTitleForScaffold(appName);
  return `Workspace app for ${appTitle}.`;
}

function shouldReplaceScaffoldDescription(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return true;
  return /\b(starter|new app|blank\b.*\bapp)\b/i.test(value);
}

function fixPackageJsonName(
  appDir: string,
  name: string,
  templateName?: string,
): void {
  const pkgPath = path.join(appDir, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    pkg.name = name;
    const appTitle = appTitleForScaffold(name);
    // When the user picked a custom name (e.g. `add-app todo --template=chat`)
    // the template's displayName would otherwise leak into the workspace apps
    // grid as the new app's label. Overwrite it so the app shows up as "Todo"
    // instead of the source template's branding.
    if (templateName && name !== templateName) {
      pkg.displayName = appTitle;
    }
    if (
      shouldReplaceScaffoldDescription(pkg.description) ||
      (isChatOnRampTemplate(templateName) && name !== templateName)
    ) {
      pkg.description = defaultPackageDescriptionForScaffold(name);
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  } catch {}
}

function fixWebManifestName(
  appDir: string,
  name: string,
  templateName?: string,
): void {
  if (!isChatOnRampTemplate(templateName) || name === templateName) return;
  const manifestPath = path.join(appDir, "public", "manifest.json");
  if (!fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const appTitle = titleCase(name);
    manifest.name = appTitle;
    manifest.short_name = appTitle;
    if (
      typeof manifest.description !== "string" ||
      /\b(blank app|starter|chat-first)\b/i.test(manifest.description)
    ) {
      manifest.description = defaultPackageDescriptionForScaffold(name);
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
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

function getDispatchDependencyVersion(): string {
  if (process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE === "1") {
    const localDispatch = findLocalPackage("dispatch");
    if (localDispatch) return pathToFileURL(localDispatch).href;
  }

  return "latest";
}

function getToolkitDependencyVersion(): string {
  if (process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE === "1") {
    const localToolkit = findLocalPackage("toolkit");
    if (localToolkit) return pathToFileURL(localToolkit).href;
  }

  return "latest";
}

function localToolkitOverride(): string | null {
  if (process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE !== "1") return null;
  const localToolkit = findLocalPackage("toolkit");
  return localToolkit ? pathToFileURL(localToolkit).href : null;
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

/**
 * Git refs to try, in priority order, when downloading templates from the
 * framework repo. The release tag scheme has shifted over time:
 *
 *   - ≤ 0.7.83: single repo-wide tag `v<version>` (legacy).
 *   - ≥ 0.8.0:  changesets per-package tags
 *               `@agent-native/core@<version>` (current).
 *
 * `main` is the final fallback so dev builds and brand-new releases (where
 * the tag has not propagated yet) still work — at the cost of pulling
 * potentially newer template code than the running CLI was built against.
 */
function getGitHubTemplateRefCandidates(): string[] {
  const version = getCorePackageVersion();
  const candidates: string[] = [];
  if (version && /^\d+\.\d+\.\d+(?:-.+)?$/.test(version)) {
    candidates.push(`@agent-native/core@${version}`);
    candidates.push(`v${version}`);
  }
  candidates.push("main");
  return candidates;
}

/** @deprecated Kept for backward-compatible test imports. Returns the
 *  highest-priority candidate; callers that need the full fallback list
 *  should use `getGitHubTemplateRefCandidates()`. */
function getGitHubTemplateRef(): string {
  return getGitHubTemplateRefCandidates()[0]!;
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
      if (deps?.["@agent-native/toolkit"]) {
        deps["@agent-native/toolkit"] = getToolkitDependencyVersion();
      }
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  } catch {}
}

function validateWorkspaceAppName(
  appName: string,
  clack: typeof import("@clack/prompts"),
  opts?: { allowDispatch?: boolean },
): void {
  const error =
    opts?.allowDispatch && appName === "dispatch"
      ? null
      : getWorkspaceAppIdValidationError(appName);
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
    const originalCommand = content.match(/^\s*command = "([^"]*)"$/m)?.[1];
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
      .replace(/^(\s*)command = ".*"$/m, `$1command = "${command}"`)
      .replace(
        /publish = "templates\/[^"]+\/dist"/g,
        `publish = "${publishPath}"`,
      )
      .replace(
        /functions = "templates\/[^"]+\/\.netlify\/functions-internal"/g,
        `functions = "${functionsPath}"`,
      )
      // Strip the `ignore` script line: it references a monorepo script path
      // (scripts/netlify-ignore-build.mjs) that doesn't exist in scaffolds, so
      // skip-unchanged would never work and every deploy logs a not-found error.
      .replace(/^\s*ignore\s*=\s*"[^"]*"\s*\n/m, "");

    if (mode === "workspace") {
      content = addWorkspaceMountNetlifyConfig(content, appName);
    }

    fs.writeFileSync(netlifyPath, content);
  } catch {}
}

function rewriteAgentChatAppId(
  appDir: string,
  appName: string,
  templateName?: string,
): void {
  const pluginPath = path.join(appDir, "server", "plugins", "agent-chat.ts");
  if (!fs.existsSync(pluginPath)) return;

  try {
    const content = fs.readFileSync(pluginPath, "utf-8");
    const sourceAppIds = ["chat", "starter"];
    if (templateName && templateName !== appName) {
      sourceAppIds.push(templateName);
    }
    const pattern = new RegExp(
      `(appId:\\s*)(["'])(${sourceAppIds.map(escapeRegExp).join("|")})\\2`,
    );
    if (!pattern.test(content)) return;

    const next = content.replace(
      pattern,
      (_match, prefix: string, quote: string) =>
        `${prefix}${quote}${appName}${quote}`,
    );
    if (next !== content) {
      fs.writeFileSync(pluginPath, next);
    }
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
    const trackedTemplateName = trackingTemplateName(templateName);
    const sourceAppIds = ["agent-native-[^\"']+", "\\{\\{APP_NAME\\}\\}"];
    if (templateName && templateName !== appName) {
      sourceAppIds.push(escapeRegExp(templateName));
    }
    if (isChatOnRampTemplate(templateName)) {
      sourceAppIds.push("starter", "chat");
    }
    const pattern = new RegExp(
      `(^\\s*app:\\s*)(["'])(?:${sourceAppIds.join("|")})\\2(\\s*,?)`,
      "m",
    );
    if (!pattern.test(content)) return;

    let next = content.replace(
      pattern,
      (_match, prefix: string, quote: string, suffix: string) =>
        `${prefix}${quote}${appName}${quote}${suffix}`,
    );

    if (
      trackedTemplateName &&
      trackedTemplateName !== appName &&
      !hasTrackingTemplate(next)
    ) {
      next = next.replace(
        /(^\s*app:\s*["'][^"']+["'],?\s*$)/m,
        (line) =>
          `${line}\n    template: ${JSON.stringify(trackedTemplateName)},`,
      );
    }

    if (next !== content) {
      fs.writeFileSync(rootPath, next);
    }
  } catch {}
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    /^settings(?:\..*)?\.json$/.test(name) &&
    srcPath?.split(path.sep).includes(".claude")
  ) {
    return true;
  }
  if (
    name === "node_modules" ||
    name === ".agent-native" ||
    name === ".env" ||
    name === ".env.local" ||
    name === "pnpm-lock.yaml" ||
    name === ".netlify" ||
    name === ".vercel" ||
    name === ".generated" ||
    name === ".react-router" ||
    name === ".output" ||
    name === "build" ||
    name === "dist" ||
    name === "test-results" ||
    name === "playwright-report" ||
    name === ".DS_Store"
  ) {
    return true;
  }
  return (
    name.endsWith(".tmp.json") ||
    /^qa-.*\.db(?:-shm|-wal)?$/.test(name) ||
    /\.db-(?:shm|wal)$/.test(name)
  );
}
