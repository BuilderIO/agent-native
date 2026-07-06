/**
 * Transform a standalone template directory into a workspace app in place.
 *
 * Called after copying any template under `apps/<name>/` inside an enterprise
 * workspace. The transform:
 *
 *   1. Rewrites package.json:
 *      - Published framework packages stay as regular npm deps
 *      - Adds @<workspace-scope>/shared as a workspace:* dep so the app
 *        inherits shared plugins/skills/AGENTS.md via the three-layer model.
 *   2. Removes files that only make sense in standalone apps
 *      (`learnings.defaults.md`, etc.).
 *   3. Replaces chat's stock auth/chat wrappers with inherited wrappers so
 *      the workspace core can own those plugin slots while framework defaults
 *      still mount when the workspace core is empty.
 *   4. Leaves app source code untouched. The three-layer framework
 *      auto-discovers workspace-core via `agent-native.workspaceCore` in the
 *      workspace root package.json — no per-app wiring needed.
 *
 * This means any first-party template under templates/* is usable as a
 * workspace app without maintaining a parallel copy.
 */
import fs from "fs";
import path from "path";

const POSTGRES_DEPENDENCY_VERSION = "^3.4.9";

export interface WorkspacifyOptions {
  /** Target app directory (already populated with the copied template) */
  appDir: string;
  /** App name (e.g. "mail") */
  appName: string;
  /** Source template name (e.g. "chat" when appName is "crm") */
  templateName?: string;
  /** Workspace root directory */
  workspaceRoot: string;
  /** Shared workspace package name (e.g. "@my-company/shared") */
  workspaceCoreName: string;
  /** Version range to use for the published @agent-native/core package */
  coreDependencyVersion?: string;
  /** Version range to use for the package-backed Dispatch app */
  dispatchDependencyVersion?: string;
  /** Version range to use for the published @agent-native/toolkit package */
  toolkitDependencyVersion?: string;
}

export function workspacifyApp(opts: WorkspacifyOptions): void {
  const { appDir, workspaceCoreName } = opts;
  const coreDependencyVersion = opts.coreDependencyVersion ?? "latest";
  const dispatchDependencyVersion = opts.dispatchDependencyVersion ?? "latest";
  const toolkitDependencyVersion = opts.toolkitDependencyVersion ?? "latest";

  // 1) Rewrite package.json to add the workspace core dep and resolve
  //    published framework-package workspace:* refs to package ranges.
  //    Other workspace:* deps (e.g. @agent-native/scheduling) stay as-is —
  //    they resolve within the
  //    workspace because the required package is scaffolded alongside the app.
  const pkgPath = path.join(appDir, "package.json");
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
            if (key === "@agent-native/core") {
              deps[key] = coreDependencyVersion;
            }
            if (key === "@agent-native/dispatch") {
              deps[key] = dispatchDependencyVersion;
            }
            if (key === "@agent-native/toolkit") {
              deps[key] = toolkitDependencyVersion;
            }
          }
        }
      }
      // Ensure the dependency on the workspace shared package is present.
      pkg.dependencies = pkg.dependencies ?? {};
      pkg.dependencies[workspaceCoreName] = "workspace:*";
      // Core loads postgres-js lazily when DATABASE_URL points at Postgres.
      // Add the runtime package to workspace apps so production bundles do
      // not fail only after a hosted Postgres database is configured.
      pkg.dependencies.postgres ??= POSTGRES_DEPENDENCY_VERSION;
      // pnpm build-script approvals belong at the workspace root. Leaving the
      // template's per-app setting in place makes pnpm warn on every install.
      if (pkg.pnpm && typeof pkg.pnpm === "object") {
        delete pkg.pnpm.onlyBuiltDependencies;
        if (Object.keys(pkg.pnpm).length === 0) {
          delete pkg.pnpm;
        }
      }
      // Pin @assistant-ui/store and @assistant-ui/tap so pre-existing workspaces
      // whose root pnpm-workspace.yaml pre-dates this fix are still protected.
      // The constraints exclude the breaking store@0.2.14/tap@0.6.0 combination
      // that causes Vite pre-bundling failures via a missing ./react-shim export.
      pkg.devDependencies = pkg.devDependencies ?? {};
      pkg.devDependencies["@assistant-ui/store"] ??= ">=0.2.9 <0.2.14";
      pkg.devDependencies["@assistant-ui/tap"] ??= "^0.5.14";
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    } catch {
      // Non-fatal: leave package.json unchanged.
    }
  }

  // 2) Remove standalone-only files that would confuse the workspace layout.
  for (const f of [
    "learnings.defaults.md",
    // pnpm-workspace.yaml marks a directory as a pnpm workspace root.
    // Leaving it in an app directory nested under a parent workspace causes
    // ERR_PNPM_WORKSPACE_PKG_NOT_FOUND when the app depends on workspace:*
    // packages (e.g. @<scope>/shared). Overrides belong at the workspace root.
    "pnpm-workspace.yaml",
  ]) {
    const p = path.join(appDir, f);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // Non-fatal: leave the file in place.
    }
  }

  // 3) Templates document action commands from the framework repo layout.
  //    Workspace apps live under apps/<name>, so point every agent at the
  //    generated app directory instead.
  const agentsPath = path.join(appDir, "AGENTS.md");
  if (fs.existsSync(agentsPath)) {
    try {
      let content = fs.readFileSync(agentsPath, "utf-8");
      content = content
        .replace(
          "The terminal cwd is the framework root. Always `cd` to this template's root before running any action:",
          `The terminal cwd is the workspace root. Always \`cd\` to this app's root before running any action:`,
        )
        .replace(
          /cd templates\/[^ \n]+ && pnpm action/g,
          `cd apps/${opts.appName} && pnpm action`,
        );
      fs.writeFileSync(agentsPath, content);
    } catch {
      // Non-fatal: leave AGENTS.md unchanged.
    }
  }

  if (["starter", "chat"].includes(opts.templateName ?? opts.appName)) {
    writeInheritedChatPlugin(appDir, workspaceCoreName, {
      fileName: "auth.ts",
      exportName: "defaultAuthPlugin",
    });
    writeInheritedChatAgentChatPlugin(appDir, workspaceCoreName, opts.appName);
  }
}

function writeInheritedChatPlugin(
  appDir: string,
  workspaceCoreName: string,
  opts: { fileName: string; exportName: string },
): void {
  const pluginsDir = path.join(appDir, "server", "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });
  const pluginPath = path.join(pluginsDir, opts.fileName);
  fs.writeFileSync(
    pluginPath,
    [
      `import { ${opts.exportName} as frameworkDefault } from "@agent-native/core/server";`,
      `import * as workspaceServer from ${JSON.stringify(`${workspaceCoreName}/server`)};`,
      "",
      `const workspacePlugin = (workspaceServer as Record<string, unknown>).${opts.exportName};`,
      "",
      'export default typeof workspacePlugin === "function"',
      "  ? workspacePlugin",
      "  : frameworkDefault;",
      "",
    ].join("\n"),
  );
}

function writeInheritedChatAgentChatPlugin(
  appDir: string,
  workspaceCoreName: string,
  appId: string,
): void {
  const pluginsDir = path.join(appDir, "server", "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });
  const pluginPath = path.join(pluginsDir, "agent-chat.ts");
  fs.writeFileSync(
    pluginPath,
    [
      `import {`,
      `  createAgentChatPlugin,`,
      `  loadActionsFromStaticRegistry,`,
      `  type AgentChatPluginOptions,`,
      `} from "@agent-native/core/server";`,
      `import * as workspaceServer from ${JSON.stringify(`${workspaceCoreName}/server`)};`,
      `import actionsRegistry from "../../.generated/actions-registry.js";`,
      "",
      `const createWorkspaceAgentChatPlugin = (workspaceServer as Record<string, unknown>).createWorkspaceAgentChatPlugin;`,
      `const options = {`,
      `  appId: ${JSON.stringify(appId)},`,
      `  actions: loadActionsFromStaticRegistry(actionsRegistry),`,
      `} satisfies AgentChatPluginOptions;`,
      "",
      `export default typeof createWorkspaceAgentChatPlugin === "function"`,
      `  ? (createWorkspaceAgentChatPlugin as (options: AgentChatPluginOptions) => unknown)(options)`,
      `  : createAgentChatPlugin(options);`,
      "",
    ].join("\n"),
  );
}

/**
 * Parse a workspace core package name into its npm scope.
 *   "@my-company/shared" → "my-company"
 *   "shared"             → ""  (no scope — shouldn't happen)
 */
export function parseWorkspaceScope(workspaceCoreName: string): string {
  const m = workspaceCoreName.match(/^@([^/]+)\//);
  return m ? m[1] : "";
}
