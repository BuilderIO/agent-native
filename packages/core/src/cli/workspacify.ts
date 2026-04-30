/**
 * Transform a standalone template directory into a workspace app in place.
 *
 * Called after copying any template under `apps/<name>/` inside an enterprise
 * workspace. The transform:
 *
 *   1. Rewrites package.json:
 *      - @agent-native/core stays as a regular npm dep (`latest`)
 *      - Adds @<workspace-scope>/core-module as a workspace:* dep so the app
 *        inherits shared plugins/skills/AGENTS.md via the three-layer model.
 *   2. Removes files that only make sense in standalone apps
 *      (`learnings.defaults.md`, etc.).
 *   3. Leaves app source code untouched. The three-layer framework
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
  //    @agent-native/core workspace:* refs to `latest` (it's an npm package,
  //    not a workspace member). Other workspace:* deps (e.g.
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
