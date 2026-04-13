/**
 * `agent-native deploy` — build and deploy every app in a workspace to a
 * single origin. Each app is served from `/<app-name>/*`, so:
 *
 *   https://your-agents.com/mail/*       → apps/mail
 *   https://your-agents.com/calendar/*   → apps/calendar
 *
 * Benefits of same-origin deploy:
 *   - Shared auth cookie → log in once, every app is signed in
 *   - Cross-app A2A is a same-origin fetch (no CORS, no JWT for siblings)
 *   - One DNS record, one TLS cert, one CDN cache
 *
 * Per-app independent deploy is still supported — just cd into the app and
 * run `agent-native build` as before. This orchestrator is for teams that
 * want the whole workspace behind one domain.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { findWorkspaceRoot } from "../scripts/utils.js";

export interface WorkspaceDeployOptions {
  args?: string[];
  /** Override the workspace root (defaults to walking up from cwd). */
  workspaceRoot?: string;
  /** Only build — don't invoke the deploy platform CLI. */
  buildOnly?: boolean;
  /** Target preset. Defaults to `cloudflare_pages`. */
  preset?: "cloudflare_pages";
}

export async function runWorkspaceDeploy(
  opts: WorkspaceDeployOptions = {},
): Promise<void> {
  const workspaceRoot =
    opts.workspaceRoot ?? findWorkspaceRoot(process.cwd()) ?? process.cwd();
  const appsDir = path.join(workspaceRoot, "apps");
  if (!fs.existsSync(appsDir)) {
    throw new Error(
      `No apps/ directory found at ${workspaceRoot}. Run this inside an agent-native workspace.`,
    );
  }

  const args = new Set(opts.args ?? []);
  const buildOnly = opts.buildOnly ?? args.has("--build-only");

  const apps = fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => fs.existsSync(path.join(appsDir, n, "package.json")));

  if (apps.length === 0) {
    throw new Error(
      `Workspace has no apps. Run \`agent-native add-app\` to add one.`,
    );
  }

  const preset = opts.preset ?? "cloudflare_pages";
  const distDir = path.join(workspaceRoot, "dist");
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  console.log(
    `[workspace-deploy] Building ${apps.length} app(s) for preset=${preset}`,
  );

  for (const app of apps) {
    buildOneApp(workspaceRoot, app, preset);
    moveAppBuildIntoDist(workspaceRoot, app, distDir);
  }

  writeWorkspaceRoutingManifest(distDir, apps);

  if (buildOnly) {
    console.log(
      `\n[workspace-deploy] Build complete at ${distDir}. Skipping publish (--build-only).`,
    );
    return;
  }

  console.log(`\n[workspace-deploy] Build complete. Publish with:\n`);
  console.log(`  cd ${path.relative(process.cwd(), workspaceRoot) || "."}`);
  console.log(`  wrangler pages deploy dist\n`);
  console.log(
    `All apps live at https://<origin>/<app-name>/*. Log in once on any app\nand the session is shared across the workspace.`,
  );
}

function buildOneApp(workspaceRoot: string, app: string, preset: string): void {
  const env = {
    ...process.env,
    NITRO_PRESET: preset,
    APP_BASE_PATH: `/${app}`,
    VITE_APP_BASE_PATH: `/${app}`,
  };

  console.log(
    `[workspace-deploy] Building ${app} (base=/${app}, preset=${preset})`,
  );

  execFileSync("pnpm", ["--filter", app, "build"], {
    cwd: workspaceRoot,
    env,
    stdio: "inherit",
  });
}

function moveAppBuildIntoDist(
  workspaceRoot: string,
  app: string,
  distDir: string,
): void {
  const appDir = path.join(workspaceRoot, "apps", app);
  // Resolve the per-app build output: prefer dist/ (standard), fall back to
  // .output/ (Nitro's default). The Cloudflare preset emits into dist/
  // containing the worker + assets.
  const candidates = ["dist", ".output"];
  const src = candidates
    .map((c) => path.join(appDir, c))
    .find((p) => fs.existsSync(p));
  if (!src) {
    throw new Error(
      `Expected ${candidates.join(" or ")} under ${appDir} but none existed. Check the app's build script.`,
    );
  }
  const target = path.join(distDir, app);
  fs.mkdirSync(target, { recursive: true });
  copyDir(src, target);
}

/**
 * Write the Cloudflare Pages `_routes.json` and a dispatcher `_worker.js` at
 * the workspace dist root so each app is reachable under /<app>/*.
 */
function writeWorkspaceRoutingManifest(distDir: string, apps: string[]): void {
  // _routes.json tells Cloudflare which paths are dynamic (Functions) vs
  // static. Mark /<app>/* as include so every app's worker handles its
  // subtree.
  const routes = {
    version: 1,
    include: apps.map((a) => `/${a}/*`).concat(["/"]),
    exclude: [],
  };
  fs.writeFileSync(
    path.join(distDir, "_routes.json"),
    JSON.stringify(routes, null, 2) + "\n",
  );

  // Dispatcher worker: inspects the path and forwards to the matching
  // per-app worker.
  const imports = apps
    .map((a) => `import ${moduleIdent(a)} from "./${a}/_worker.js";`)
    .join("\n");
  const dispatch = apps
    .map(
      (a) =>
        `  if (pathname === "/${a}" || pathname.startsWith("/${a}/")) return ${moduleIdent(a)}.fetch(request, env, ctx);`,
    )
    .join("\n");

  const worker = `${imports}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
${dispatch}
    if (pathname === "/") {
      return Response.redirect(new URL("/${apps[0]}/", request.url).toString(), 302);
    }
    return new Response("Not found", { status: 404 });
  },
};
`;
  fs.writeFileSync(path.join(distDir, "_worker.js"), worker);
}

function moduleIdent(app: string): string {
  return "app_" + app.replace(/[^a-zA-Z0-9_]/g, "_");
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        const target = fs.readlinkSync(s);
        fs.symlinkSync(target, d);
      } catch {
        fs.copyFileSync(s, d);
      }
    } else if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
