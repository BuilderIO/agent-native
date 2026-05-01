/**
 * Transform a standalone template directory into a workspace app in place.
 *
 * Called after copying any template under `apps/<name>/` inside an enterprise
 * workspace. The transform:
 *
 *   1. Rewrites package.json:
 *      - @agent-native/core stays as a regular npm dep
 *      - Adds @<workspace-scope>/core-module as a workspace:* dep so the app
 *        inherits shared plugins/skills/AGENTS.md via the three-layer model.
 *   2. Removes files that only make sense in standalone apps
 *      (`learnings.defaults.md`, etc.).
 *   3. Removes starter's stock auth/chat wrappers so the workspace core can
 *      own those inherited plugin slots.
 *   4. Leaves app source code untouched. The three-layer framework
 *      auto-discovers workspace-core via `agent-native.workspaceCore` in the
 *      workspace root package.json — no per-app wiring needed.
 *
 * This means any first-party template under templates/* is usable as a
 * workspace app without maintaining a parallel copy.
 */
import fs from "fs";
import path from "path";

export interface WorkspacifyOptions {
  /** Target app directory (already populated with the copied template) */
  appDir: string;
  /** App name (e.g. "mail") */
  appName: string;
  /** Source template name (e.g. "starter" when appName is "crm") */
  templateName?: string;
  /** Workspace root directory */
  workspaceRoot: string;
  /** Core module package name (e.g. "@my-company/core-module") */
  workspaceCoreName: string;
  /** Version range to use for the published @agent-native/core package */
  coreDependencyVersion?: string;
}

export function workspacifyApp(opts: WorkspacifyOptions): void {
  const { appDir, workspaceCoreName } = opts;
  const coreDependencyVersion = opts.coreDependencyVersion ?? "latest";

  // 1) Rewrite package.json to add the workspace core dep and resolve
  //    @agent-native/core workspace:* refs to the CLI package's published
  //    range (it's an npm package, not a workspace member). Other workspace:* deps (e.g.
  //    @agent-native/scheduling) stay as-is — they resolve within the workspace
  //    because the required package is scaffolded alongside the app.
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
          if (
            typeof val === "string" &&
            val.startsWith("workspace:") &&
            key === "@agent-native/core"
          ) {
            deps[key] = coreDependencyVersion;
          }
        }
      }
      // Ensure the dependency on the workspace core module is present.
      pkg.dependencies = pkg.dependencies ?? {};
      pkg.dependencies[workspaceCoreName] = "workspace:*";
      // pnpm build-script approvals belong at the workspace root. Leaving the
      // template's per-app setting in place makes pnpm warn on every install.
      if (pkg.pnpm && typeof pkg.pnpm === "object") {
        delete pkg.pnpm.onlyBuiltDependencies;
        if (Object.keys(pkg.pnpm).length === 0) {
          delete pkg.pnpm;
        }
      }
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    } catch {
      // Non-fatal: leave package.json unchanged.
    }
  }

  // 2) Remove standalone-only files that would confuse the workspace layout.
  for (const f of [
    "learnings.defaults.md",
    // If the template shipped its own workspace marker / stray monorepo
    // files, strip them here too.
  ]) {
    const p = path.join(appDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
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

  if ((opts.templateName ?? opts.appName) === "starter") {
    for (const plugin of ["auth.ts", "agent-chat.ts"]) {
      const pluginPath = path.join(appDir, "server", "plugins", plugin);
      if (fs.existsSync(pluginPath)) fs.unlinkSync(pluginPath);
    }
  }
}

/**
 * Parse a workspace core package name into its npm scope.
 *   "@my-company/core-module" → "my-company"
 *   "core-module"             → ""  (no scope — shouldn't happen)
 */
export function parseWorkspaceScope(workspaceCoreName: string): string {
  const m = workspaceCoreName.match(/^@([^/]+)\//);
  return m ? m[1] : "";
}
